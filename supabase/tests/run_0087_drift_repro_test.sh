#!/usr/bin/env bash
# 0087「本番ドリフトのfix-forward」専用のワンコマンドランナー。
#
# supabase/tests/run.sh は0001〜最新の全マイグレーションを、最初から正しい順序で
# 適用してから*.test.sqlを実行する構造のため、「0001〜0086までは正しく適用された後、
# 0012/0014/0058/0062/0064の一部だけが本番で未反映のまま後から状態がズレた」という、
# 工程A-R2で実際に本番から検出したドリフトそのものは再現できない。このスクリプトは
# 専用に、
#   1. 使い捨てDBを作成
#   2. シム(auth スキーマ・ロール・標準権限)を適用
#   3. supabase_realtime publicationを作成
#   4. supabase/migrations/の0001〜0086を番号順に適用（0087は含まない）
#   5. 【期待値の固定】この時点（正常な0001〜0086直後）のpublic schema内
#      全関数について、完全シグネチャ・PUBLIC/anon/authenticatedの有効EXECUTE
#      権限をスナップショットとして保存する。これを「正解」として固定する
#      （0087適用後のDB同士を比較するのではなく、ドリフトが一切無い状態を
#      正解にする）。あわせて、この時点で新規関数がPUBLIC実行可にならない
#      （0062/0063が正しく効いている）ことをビヘイビアでも確認する。
#   6. A-R2で確認した6件のドリフトを、SQLで明示的に再現する
#      （scores_update_own_as_playerの復元＋UPDATE再grant、
#      sns_comments_insert_ownの復元、旧answers indexの復元、
#      recompute_answering_cue_for_turnを0063時点のロジックへ差し替え、
#      log_share_click/set_live_schedule_role/current_legal_document_versions/
#      handle_profile_pre_deletionをPUBLIC実行可に戻す、default privileges
#      （global・public schema固有の両方）をPUBLIC許可の状態へ戻す）
#   7. ドリフトが実際に機能面でも再現されていることを確認する（default
#      privilegesドリフトは、この時点で新規に作る関数が実際にPUBLIC実行可に
#      なることで確認する）
#   8. supabase/migrations/0087_fix_forward_production_drift.sql を適用
#   9. 適用後、6件すべてが期待状態に収束していることを機能面で確認する
#      （default privilegesは、この時点で新規に作る関数が実際にPUBLIC実行可に
#      ならないことで確認する）
#  10. public schema内の全関数のACLを再取得し、手順5で固定した期待値と
#      完全一致することを機械的に検証する（authenticatedの正しい権限が
#      1件も失われていないこと、anonの正規許可がis_host/sns_author_names/
#      sns_result_participant_user_idsの3件だけであること、log_share_clickが
#      anon不可であることを個別にも明示する）
#  11. pg_default_aclを、0087を実行したcurrent_userのOIDに限定し、
#      global（defaclnamespace=0）・public schema固有の両方について、
#      aclitem文字列の先頭一致ではなくaclexplode()でPUBLICのEXECUTEが
#      含まれないことを確認する
#  12. 0087をもう一度適用し、再実行しても例外なく完走すること、及び再適用後も
#      scoresのUPDATE不可・default privileges・全関数ACLの期待値完全一致が保たれる
#      ことを確認する（0089以降の正規権限を剥がさないよう、再実行確認はこの
#      0087までの独立DBだけで行う）
# を行う。安全対策はsupabase/tests/run.shと同じ考え方を踏襲する。
# 本番のSupabaseプロジェクトに対しては絶対に実行しないこと。
#
# 使い方：
#   supabase/tests/run_0087_drift_repro_test.sh
#   supabase/tests/run_0087_drift_repro_test.sh postgresql://user:pass@localhost:5432/postgres

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
SHIM_FILE="$SCRIPT_DIR/fixtures/local_supabase_shim.sql"
MIGRATION_0087="$MIGRATIONS_DIR/0087_fix_forward_production_drift.sql"

CONN="${1:-${SUPABASE_TEST_DB_URL:-}}"
DB_NAME="ogiridojo_0087drifttest_$$"

PSQL_ARGS=(-v ON_ERROR_STOP=1)
CREATEDB_ARGS=()
DROPDB_ARGS=()
if [ -n "$CONN" ]; then
  BASE_CONN="${CONN%/*}"
  PSQL_ARGS+=(-d "$BASE_CONN/$DB_NAME")
  CREATEDB_ARGS+=("$BASE_CONN/$DB_NAME")
  DROPDB_ARGS+=("$BASE_CONN/$DB_NAME")
else
  PSQL_ARGS+=(-d "$DB_NAME")
  CREATEDB_ARGS+=("$DB_NAME")
  DROPDB_ARGS+=("$DB_NAME")
fi

cleanup() {
  dropdb --if-exists "${DROPDB_ARGS[@]}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> 使い捨てDBを作成: $DB_NAME"
createdb "${CREATEDB_ARGS[@]}"

echo "==> シム(auth スキーマ・ロール・標準権限)を適用"
psql "${PSQL_ARGS[@]}" -f "$SHIM_FILE" >/dev/null

echo "==> supabase_realtime publicationを作成（0001以降が参照するため）"
psql "${PSQL_ARGS[@]}" -c "create publication supabase_realtime;" >/dev/null

echo "==> migrationsを0001〜0086まで番号順に適用（0087は含まない、${MIGRATIONS_DIR}）"
shopt -s nullglob
for f in "$MIGRATIONS_DIR"/0*.sql; do
  base="$(basename "$f")"
  num="${base%%_*}"
  if (( 10#$num > 86 )); then
    continue
  fi
  psql "${PSQL_ARGS[@]}" -f "$f" >/dev/null
done
shopt -u nullglob

echo "==> 【期待値の固定】0001〜0086直後のpublic schema内全関数のACLをスナップショット保存"
psql "${PSQL_ARGS[@]}" <<'SQL'
create table public._audit_fn_acl_expected as
select p.oid::regprocedure::text as sig,
       has_function_privilege('public', p.oid, 'EXECUTE') as pub,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public._audit_fn_acl_expected;
  raise notice 'INFO: 期待値スナップショットに%件の関数を記録した', v_count;
end $$;

-- ビヘイビア確認：この時点（0001〜0086直後、ドリフト注入前）で新規に作る関数は
-- PUBLIC実行可にならない（0062/0063が正しく効いている健全な状態であることの
-- 事前確認。ここが既に壊れていれば、以後の期待値スナップショット自体が無意味になる）。
create function public._driftcheck_new_fn_baseline() returns int language sql as $fn$ select 1 $fn$;
do $$
begin
  if has_function_privilege('public', 'public._driftcheck_new_fn_baseline()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: 0001〜0086直後なのに新規関数がPUBLIC実行可になっている（期待値スナップショット自体が汚染されている）';
  end if;
  raise notice 'PASS: 0001〜0086直後は新規関数がPUBLIC実行可にならない（期待値スナップショットの前提は健全）';
end $$;
drop function public._driftcheck_new_fn_baseline();
SQL

echo "==> A-R2で確認した6件のドリフトを再現"
psql "${PSQL_ARGS[@]}" <<'SQL' >/dev/null
-- 1) scores: 0012のdrop policy/revokeを取り消す
create policy "scores_update_own_as_player" on public.scores for update
  using (exists (select 1 from public.participants p where p.id = scores.judge_participant_id and p.user_id = auth.uid()));
grant update on public.scores to authenticated;

-- 2) sns_comments: 0058のdrop policyを取り消す
create policy "sns_comments_insert_own" on public.sns_comments for insert
  with check (auth.uid() = author_id);

-- 3) answers: 0014で消したはずの旧indexを復元
create unique index answers_one_active_per_turn
  on public.answers (turn_id)
  where revealed_at is not null and resolved = false;

-- 4) recompute_answering_cue_for_turn: 0063時点(0064以前)のロジックへ差し替え
create or replace function public.recompute_answering_cue_for_turn(p_turn_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $fn$
declare
  v_live_id uuid;
  v_current_turn_id uuid;
  v_pending uuid;
  v_busy boolean;
begin
  select t.live_id, l.current_turn_id into v_live_id, v_current_turn_id
    from public.turns t
    join public.lives l on l.id = t.live_id
    where t.id = p_turn_id;
  if v_live_id is null then
    return;
  end if;
  if v_current_turn_id is distinct from p_turn_id then
    return;
  end if;

  select participant_id into v_pending
    from public.answers
    where turn_id = p_turn_id and revealed_at is null
    order by created_at asc
    limit 1;

  v_busy := v_pending is not null;

  insert into public.answering_cues (live_id, turn_id, pending_participant_id, busy, updated_at)
  values (v_live_id, p_turn_id, v_pending, v_busy, now())
  on conflict (live_id) do update
    set turn_id = excluded.turn_id,
        pending_participant_id = excluded.pending_participant_id,
        busy = excluded.busy,
        revision = public.answering_cues.revision + 1,
        updated_at = now();
end;
$fn$;
grant execute on function public.recompute_answering_cue_for_turn(uuid) to public;

-- 5) function ACL: 4関数をPUBLIC実行可に戻す
grant execute on function public.log_share_click(text) to public;
grant execute on function public.set_live_schedule_role(uuid, text) to public;
grant execute on function public.current_legal_document_versions() to public;
grant execute on function public.handle_profile_pre_deletion() to public;

-- 6) default privileges: global・public schema固有の両方を、PUBLICへ既定で
--    EXECUTEを付与する状態へ戻す（0062/0063のALTER DEFAULT PRIVILEGESを
--    実質的に取り消す）。これにより、この時点以降に新規作成される関数は
--    明示的なGRANT無しでもPUBLIC実行可になる（本番で現実に起きたと推定される
--    メカニズムそのものを再現する）。
alter default privileges in schema public grant execute on functions to public;
alter default privileges grant execute on functions to public;

-- 6)の再現が実際に「新規関数」へ効くことを直接証明する（ビヘイビア確認）。
-- このシミュレーション用関数は比較対象から外すため、確認後すぐに削除する。
create function public._driftcheck_new_fn_after_default_drift() returns int language sql as $fn$ select 1 $fn$;
do $$
begin
  if not has_function_privilege('public', 'public._driftcheck_new_fn_after_default_drift()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: default privilegesドリフトの再現手順が効いていない（新規関数がPUBLIC実行可にならない）';
  end if;
end $$;
drop function public._driftcheck_new_fn_after_default_drift();
SQL

echo "==> ドリフトが機能面でも再現されていることを確認"
psql "${PSQL_ARGS[@]}" <<'SQL'
do $$
begin
  if not has_table_privilege('authenticated', 'public.scores', 'UPDATE') then
    raise exception 'FAIL: ドリフト再現のはずなのにscoresのUPDATE権限が無い（再現手順自体の誤り）';
  end if;
  if not has_function_privilege('public', 'public.log_share_click(text)', 'EXECUTE') then
    raise exception 'FAIL: ドリフト再現のはずなのにlog_share_clickがPUBLIC実行不可（再現手順自体の誤り）';
  end if;
  raise notice 'PASS: 0087適用前のドリフト再現を確認（scores UPDATE・4関数のPUBLIC実行がいずれも開いている）';
end $$;

-- default privilegesドリフトの再確認（新規関数で直接証明）。
create function public._driftcheck_new_fn_predrift_recheck() returns int language sql as $fn$ select 1 $fn$;
do $$
begin
  if not has_function_privilege('public', 'public._driftcheck_new_fn_predrift_recheck()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: default privilegesドリフトが再現されていない（新規関数がPUBLIC実行可にならない）';
  end if;
  raise notice 'PASS: default privilegesドリフトを確認（この時点で新規関数は無条件にPUBLIC実行可になる）';
end $$;
drop function public._driftcheck_new_fn_predrift_recheck();
SQL

echo "==> 0087を適用（${MIGRATION_0087}）"
psql "${PSQL_ARGS[@]}" -f "$MIGRATION_0087" >/dev/null

echo "==> 0087適用後：6件すべてが期待状態に収束していることを機能面で確認"
psql "${PSQL_ARGS[@]}" <<'SQL'
-- 1) scores: UPDATE不可に収束
do $$
begin
  if has_table_privilege('authenticated', 'public.scores', 'UPDATE') then
    raise exception 'FAIL: 0087適用後もscoresのUPDATE権限が残っている';
  end if;
  raise notice 'PASS: scoresは0087適用後、UPDATE不可に収束した';
end $$;

-- 2) sns_comments: 直接INSERT不可に収束
do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_topic_id uuid;
  v_answer_id uuid;
begin
  insert into auth.users (id) values (v_user_id);
  insert into public.sns_topics (author_id, body) values (v_user_id, 'ドリフト収束確認お題')
    returning id into v_topic_id;
  insert into public.sns_answers (topic_id, author_id, body) values (v_topic_id, v_user_id, 'ドリフト収束確認回答')
    returning id into v_answer_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_user_id::text, true);
  begin
    insert into public.sns_comments (answer_id, author_id, body) values (v_answer_id, v_user_id, '直接INSERTテスト');
    raise exception 'FAIL: 0087適用後もsns_commentsへ直接INSERTできる';
  exception
    when insufficient_privilege then
      raise notice 'PASS: sns_commentsは0087適用後、直接INSERT不可に収束した';
  end;
end $$;
reset role;

-- 3) answers: 旧indexが収束して消えている
do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_indexes
    where tablename = 'answers' and indexname = 'answers_one_active_per_turn';
  if v_count <> 0 then
    raise exception 'FAIL: 0087適用後も旧indexが残っている';
  end if;
  raise notice 'PASS: answersの旧indexは0087適用後、収束して消えた';
end $$;

-- 4) recompute_answering_cue_for_turn: resolved=false基準に収束
do $$
declare
  v_host_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_live_id uuid := gen_random_uuid();
  v_group_id uuid := gen_random_uuid();
  v_topic_id uuid := gen_random_uuid();
  v_turn_id uuid := gen_random_uuid();
  v_participant_id uuid := gen_random_uuid();
  v_answer_id uuid := gen_random_uuid();
  v_pending uuid;
  v_busy boolean;
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';

  insert into auth.users (id) values (v_host_id), (v_player_id);
  insert into public.lives (id, scheduled_at, current_phase, sequence_number, planned_group_count, max_players)
    values (v_live_id, now(), 'answering', 8703, 1, 10);
  insert into public.groups (id, live_id, group_order) values (v_group_id, v_live_id, 1);
  insert into public.topics (id, live_id, body, format) values (v_topic_id, v_live_id, 'ドリフト収束cue確認お題', 'text');
  insert into public.participants (id, live_id, user_id, group_id, role)
    values (v_participant_id, v_live_id, v_player_id, v_group_id, 'player');
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (v_turn_id, v_live_id, 1, v_group_id, v_topic_id, 'active', 0);
  update public.lives set current_turn_id = v_turn_id where id = v_live_id;

  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, resolved)
    values (v_answer_id, v_turn_id, v_participant_id, 1, 'ドリフト収束cue確認回答', now(), false);

  perform public.recompute_answering_cue_for_turn(v_turn_id);
  select pending_participant_id, busy into v_pending, v_busy
    from public.answering_cues where live_id = v_live_id;

  if v_pending is distinct from v_participant_id or v_busy is distinct from true then
    raise exception 'FAIL: 0087適用後もrecompute_answering_cue_for_turnが旧ロジック(revealed_at基準)のまま。pending=%, busy=%', v_pending, v_busy;
  end if;
  raise notice 'PASS: recompute_answering_cue_for_turnは0087適用後、resolved=false基準(0064の意図)に収束した';
end $$;

-- 5) function ACL: 4関数がPUBLIC実行不可に収束
do $$
declare
  v_fn text;
  v_fns text[] := array[
    'public.log_share_click(text)',
    'public.set_live_schedule_role(uuid,text)',
    'public.current_legal_document_versions()',
    'public.handle_profile_pre_deletion()'
  ];
begin
  foreach v_fn in array v_fns loop
    if has_function_privilege('public', v_fn, 'EXECUTE') then
      raise exception 'FAIL: 0087適用後も%がPUBLIC実行可のまま', v_fn;
    end if;
  end loop;
  raise notice 'PASS: 4関数は0087適用後、いずれもPUBLIC実行不可に収束した';
end $$;

-- 6) default privileges: 新規関数がPUBLIC実行可にならない状態に収束（ビヘイビア確認）。
create function public._driftcheck_new_fn_after_0087() returns int language sql as $fn$ select 1 $fn$;
do $$
begin
  if has_function_privilege('public', 'public._driftcheck_new_fn_after_0087()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: 0087適用後も新規関数がPUBLIC実行可になってしまう（default privilegesが収束していない）';
  end if;
  raise notice 'PASS: 0087適用後は新規関数がPUBLIC実行可にならない（default privilegesが収束した）';
end $$;
drop function public._driftcheck_new_fn_after_0087();
SQL

echo "==> public schema内の全関数ACLを再取得し、0001〜0086直後の期待値と完全一致することを検証"
psql "${PSQL_ARGS[@]}" <<'SQL'
create table public._audit_fn_acl_actual as
select p.oid::regprocedure::text as sig,
       has_function_privilege('public', p.oid, 'EXECUTE') as pub,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';

-- 全件完全一致（4関数だけ・パターンだけの確認ではなく、public schema内の
-- 全関数×PUBLIC/anon/authenticatedの3ロール全部を対象にした対称差分チェック）。
-- 「A EXCEPT B UNION ALL B EXCEPT A」という括弧なしの式は、PostgreSQLでは
-- UNION/EXCEPTが同じ優先順位で左結合されるため「((A EXCEPT B) UNION ALL B)
-- EXCEPT A」と解釈され、真の対称差分にならない（expected側にだけ存在する行
-- ＝関数がactualから消失したケースを見逃す）。sigをキーにFULL OUTER JOIN
-- した上で、(a)expected側のsigがnull＝actualにしか存在しない、
-- (b)actual側のsigがnull＝expectedにしか存在しない（＝actualから消失）、
-- (c)pub/anon/authのいずれかがIS DISTINCT FROM、のいずれかを差分として
-- 数える方式に修正する。
do $$
declare
  v_diff_count int;
  v_diff_detail text;
begin
  select count(*), string_agg(
    format(
      'sig=%s  expected(pub=%s,anon=%s,auth=%s)  actual(pub=%s,anon=%s,auth=%s)',
      coalesce(e.sig, a.sig), e.pub, e.anon, e.auth, a.pub, a.anon, a.auth
    ),
    E'\n    '
  )
  into v_diff_count, v_diff_detail
  from public._audit_fn_acl_expected e
  full outer join public._audit_fn_acl_actual a on a.sig = e.sig
  where e.sig is null
     or a.sig is null
     or e.pub is distinct from a.pub
     or e.anon is distinct from a.anon
     or e.auth is distinct from a.auth;

  if v_diff_count <> 0 then
    raise exception 'FAIL: 0001〜0086直後の期待ACLと0087適用後の実際のACLが完全一致しない（%件、FULL OUTER JOINベースの対称差分）。欠落・追加・ACL差異の詳細:
    %', v_diff_count, v_diff_detail;
  end if;
  raise notice 'PASS: public schema内の全関数のACL(PUBLIC/anon/authenticated)が、0001〜0086直後の期待状態と完全一致（FULL OUTER JOINベースの対称差分0件。欠落・追加・ACL差異のいずれも無し）';
end $$;

-- 明示確認1: authenticatedの正しい権限が1件も失われていない。
-- INNER JOINでは、0087適用後にactual側から関数そのものが消失した場合に
-- 行自体が結果から落ちてしまい「損失」として検出できない。LEFT JOINにし、
-- actual側にsigが無い（関数が消えた）場合もcoalesceでfalse扱いにして
-- 損失として数える。
do $$
declare
  v_lost_auth int;
  v_lost_list text;
begin
  select count(*), string_agg(
    e.sig || case when a.sig is null then '（actualから関数自体が消失）' else '' end,
    ', '
  )
  into v_lost_auth, v_lost_list
  from public._audit_fn_acl_expected e
  left join public._audit_fn_acl_actual a on a.sig = e.sig
  where e.auth = true and coalesce(a.auth, false) = false;

  if v_lost_auth <> 0 then
    raise exception 'FAIL: 0087によってauthenticatedの正しい権限が%件失われた(%)', v_lost_auth, v_lost_list;
  end if;
  raise notice 'PASS: 0087によってauthenticatedの正しい権限は1件も失われていない（関数自体の消失も損失として判定済み）';
end $$;

-- 明示確認2: anonの正規許可はis_host/sns_author_names/sns_result_participant_user_idsの3件のみ。
do $$
declare
  v_anon_sigs text[];
begin
  select coalesce(array_agg(sig order by sig), array[]::text[]) into v_anon_sigs
    from public._audit_fn_acl_actual where anon = true;

  if v_anon_sigs is distinct from array['is_host()','sns_author_names(uuid[])','sns_result_participant_user_ids(uuid[])'] then
    raise exception 'FAIL: 0087適用後のanon実行可能関数の集合が想定(is_host/sns_author_names/sns_result_participant_user_ids)と異なる。実際=%', v_anon_sigs;
  end if;
  raise notice 'PASS: anonが実行できる関数はis_host/sns_author_names/sns_result_participant_user_idsの3件のみ';
end $$;

-- 明示確認3: log_share_clickは0046の意図どおりanon不可。
do $$
begin
  if exists (
    select 1 from public._audit_fn_acl_actual
    where sig = 'log_share_click(text)' and anon = true
  ) then
    raise exception 'FAIL: log_share_clickが0087適用後もanon実行可能になっている（0046の意図に反する）';
  end if;
  raise notice 'PASS: log_share_clickは0046の意図どおりanon実行不可';
end $$;
SQL

echo "==> pg_default_aclを、current_userのOID・global/public schema固有の両方でaclexplode()により確認"
psql "${PSQL_ARGS[@]}" <<'SQL'
do $$
declare
  v_role oid := current_user::regrole;
  v_public_ns oid := (select oid from pg_namespace where nspname = 'public');
  v_global_public_execute boolean;
  v_schema_public_execute boolean;
  v_global_row_exists boolean;
begin
  -- global（defaclnamespace=0）：行が存在しない場合、PostgreSQLの素の既定
  -- （関数はPUBLIC実行可）が適用されてしまうため、「行が存在し、かつ
  -- aclexplode()でgrantee=0(PUBLIC)のEXECUTEを含まない」ことを要求する。
  select exists (
    select 1 from pg_default_acl d
    where d.defaclobjtype = 'f' and d.defaclnamespace = 0 and d.defaclrole = v_role
  ) into v_global_row_exists;

  if not v_global_row_exists then
    raise exception 'FAIL: current_user(oid=%)のglobal default privileges(defaclnamespace=0, defaclobjtype=f)のoverride行が存在しない（0062/0063/0087のrevokeが効いていない）', v_role;
  end if;

  select exists (
    select 1 from pg_default_acl d, aclexplode(d.defaclacl) x
    where d.defaclobjtype = 'f' and d.defaclnamespace = 0 and d.defaclrole = v_role
      and x.grantee = 0 and x.privilege_type = 'EXECUTE'
  ) into v_global_public_execute;

  if v_global_public_execute then
    raise exception 'FAIL: current_user(oid=%)のglobal default privilegesにPUBLICのEXECUTEがaclexplode()で検出された', v_role;
  end if;

  -- public schema固有（defaclnamespace=public schemaのoid）：この形は0063の
  -- コード内コメントの通り、単独では行として残らない場合がある（実際の挙動は
  -- 新規関数での直接確認で別途証明済み）。行が存在する場合に限り、その内容に
  -- PUBLICのEXECUTEが含まれないことを確認する（存在しないことそのものは
  -- 失敗にしない）。
  select exists (
    select 1 from pg_default_acl d, aclexplode(d.defaclacl) x
    where d.defaclobjtype = 'f' and d.defaclnamespace = v_public_ns and d.defaclrole = v_role
      and x.grantee = 0 and x.privilege_type = 'EXECUTE'
  ) into v_schema_public_execute;

  if v_schema_public_execute then
    raise exception 'FAIL: current_user(oid=%)のpublic schema固有default privilegesにPUBLICのEXECUTEがaclexplode()で検出された', v_role;
  end if;

  raise notice 'PASS: pg_default_acl（current_user(oid=%)のglobal override行は存在しPUBLIC EXECUTEを含まない。public schema固有override行が存在する場合もPUBLIC EXECUTEは含まない）', v_role;
end $$;
SQL

echo "==> 0087をもう一度適用（再実行安全性の確認）"
psql "${PSQL_ARGS[@]}" -f "$MIGRATION_0087" >/dev/null

# 2026-10-12（0089対応）：再実行安全性の確認は、以前は通常フロー（0001〜最新を全適用
# したDB）の0087_fix_forward_production_drift.test.sql末尾でも行っていたが、0087の
# anon許可リストは0087時点のハードコードのため、後続マイグレーション（0089の
# get_client_policy_v1等）が正規に付与したanon EXECUTEまで剥がしてしまう。そのため
# 再実行確認は、0087までだけを適用したこの独立DBへ一本化し、「例外なく完走する」
# だけでなく、再適用後も期待状態（scoresのUPDATE不可・default privileges・
# public schema全関数ACLの0001〜0086直後スナップショットとの完全一致）が保たれる
# ことまで確認する（通常フロー側にあった確認より弱めない）。
echo "==> 0087再適用後も期待状態が保たれていることを確認"
psql "${PSQL_ARGS[@]}" <<'SQL'
do $$
begin
  if has_table_privilege('authenticated', 'public.scores', 'UPDATE') then
    raise exception 'FAIL: 0087再適用後にscoresのUPDATE権限が復活している';
  end if;
  raise notice 'PASS: 0087を再適用してもscoresはUPDATE不可のまま';
end $$;

create function public._driftcheck_new_fn_after_0087_rerun() returns int language sql as $fn$ select 1 $fn$;
do $$
begin
  if has_function_privilege('public', 'public._driftcheck_new_fn_after_0087_rerun()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: 0087再適用後に新規関数がPUBLIC実行可になっている';
  end if;
  raise notice 'PASS: 0087再適用後も新規関数はPUBLIC実行可にならない';
end $$;
drop function public._driftcheck_new_fn_after_0087_rerun();

create table public._audit_fn_acl_after_rerun as
select p.oid::regprocedure::text as sig,
       has_function_privilege('public', p.oid, 'EXECUTE') as pub,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';

do $$
declare
  v_diff_count int;
  v_diff_detail text;
begin
  select count(*), string_agg(
    format(
      'sig=%s  expected(pub=%s,anon=%s,auth=%s)  actual(pub=%s,anon=%s,auth=%s)',
      coalesce(e.sig, a.sig), e.pub, e.anon, e.auth, a.pub, a.anon, a.auth
    ),
    E'\n    '
  )
  into v_diff_count, v_diff_detail
  from public._audit_fn_acl_expected e
  full outer join public._audit_fn_acl_after_rerun a on a.sig = e.sig
  where e.sig is null
     or a.sig is null
     or e.pub is distinct from a.pub
     or e.anon is distinct from a.anon
     or e.auth is distinct from a.auth;

  if v_diff_count <> 0 then
    raise exception 'FAIL: 0087再適用後のACLが0001〜0086直後の期待ACLと完全一致しない（%件）:
    %', v_diff_count, v_diff_detail;
  end if;
  raise notice 'PASS: 0087再適用後も、public schema内の全関数ACLが0001〜0086直後の期待状態と完全一致';
end $$;
SQL
psql "${PSQL_ARGS[@]}" -c "select '0087 DRIFT REPRO TEST PASSED' as result;"

echo "==> 完了：0087がA-R2で検出した本番ドリフト（6件）を正しく収束させ、public schema内の全関数ACLが0001〜0086直後の期待状態と完全一致することを確認しました。"
