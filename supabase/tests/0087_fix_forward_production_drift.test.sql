-- 0087（本番ドリフトのfix-forward）回帰テスト。実行方法はsupabase/tests/run.sh参照。
-- このファイルはsupabase/tests/run.shの通常フロー（0001〜最新を順に適用した「正常な」
-- DB）に対して実行されるため、「正常なDBへ0087を適用しても壊れない」こと、および
-- 「0087適用後に期待状態になっている」ことの両方を兼ねて確認する。
-- 「0087を再実行しても壊れない」ことは、このファイルの末尾で実際に0087自身を
-- 再適用して確認する。
-- 「5件のドリフト状態を再現したDBへ0087を適用すると期待状態になる」ことは、
-- 別の使い捨てDBが必要なため、専用スクリプト
-- supabase/tests/run_0087_drift_repro_test.sh で確認する（run.shから自動実行）。

\set ON_ERROR_STOP on

-- ============================================================
-- テスト1: scores。旧policy・UPDATE権限が存在しない。
-- ============================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_policies
    where tablename = 'scores' and policyname = 'scores_update_own_as_player';
  if v_count <> 0 then
    raise exception 'FAIL: scores_update_own_as_playerポリシーが残っている';
  end if;
  if has_table_privilege('authenticated', 'public.scores', 'UPDATE') then
    raise exception 'FAIL: authenticatedがscoresのUPDATE権限を持っている';
  end if;
  raise notice 'PASS: scoresは一発勝負（旧policy・UPDATE権限ともに無い）';
end $$;

-- ============================================================
-- テスト1b: 正規の採点INSERT（一発勝負の本来の経路）は引き続き成功し、
--           2回目のINSERTは一意制約違反で拒否される（0087がINSERTや
--           primary keyを壊していないことの確認）。
-- ============================================================
do $$
declare
  v_host_id uuid := gen_random_uuid();
  v_judge_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_live_id uuid := gen_random_uuid();
  v_group_id uuid := gen_random_uuid();
  v_judge_group_id uuid := gen_random_uuid();
  v_topic_id uuid := gen_random_uuid();
  v_turn_id uuid := gen_random_uuid();
  v_judge_participant_id uuid := gen_random_uuid();
  v_player_participant_id uuid := gen_random_uuid();
  v_answer_id uuid := gen_random_uuid();
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';

  insert into auth.users (id) values (v_host_id), (v_judge_id), (v_player_id);
  -- lives.current_turn_idはturns作成後にしか設定できない（循環外部キー）ため、
  -- 先にnullで作成し、turns作成後にUPDATEする（既存の0062テストと同じ作法）。
  insert into public.lives (id, scheduled_at, current_phase, sequence_number, planned_group_count, max_players)
    values (v_live_id, now(), 'answering', 8701, 2, 10);
  insert into public.groups (id, live_id, group_order) values
    (v_group_id, v_live_id, 1),
    (v_judge_group_id, v_live_id, 2);
  insert into public.topics (id, live_id, body, format) values (v_topic_id, v_live_id, '0087採点回帰確認お題', 'text');
  -- scores_insert_own_as_playerポリシーは「審査員は回答者と別の組」を要求するため、
  -- judgeはplayer/turnとは別の組(v_judge_group_id)に所属させる。
  insert into public.participants (id, live_id, user_id, group_id, role)
    values (v_judge_participant_id, v_live_id, v_judge_id, v_judge_group_id, 'player'),
           (v_player_participant_id, v_live_id, v_player_id, v_group_id, 'player');
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (v_turn_id, v_live_id, 1, v_group_id, v_topic_id, 'active', 1);
  update public.lives set current_turn_id = v_turn_id where id = v_live_id;
  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, resolved)
    values (v_answer_id, v_turn_id, v_player_participant_id, 1, '0087採点回帰確認の回答', now(), false);

  set local role authenticated;
  perform set_config('myapp.uid', v_judge_id::text, true);
  insert into public.scores (answer_id, judge_participant_id, points)
    values (v_answer_id, v_judge_participant_id, 3);

  begin
    update public.scores set points = 2
      where answer_id = v_answer_id and judge_participant_id = v_judge_participant_id;
    raise exception 'FAIL: 採点済みのscoresをUPDATEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 採点後のUPDATEは拒否される（一発勝負）';
  end;

  begin
    insert into public.scores (answer_id, judge_participant_id, points)
      values (v_answer_id, v_judge_participant_id, 1);
    raise exception 'FAIL: 同じ審査員が同じ回答へ二重に採点できてしまった';
  exception
    when unique_violation then
      raise notice 'PASS: 二重投票はprimary keyで拒否される（INSERT自体は引き続き正常）';
  end;
end $$;
reset role;

-- ============================================================
-- テスト2: sns_comments。直接INSERTの旧policyが存在しない。
-- ============================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_policies
    where tablename = 'sns_comments' and policyname = 'sns_comments_insert_own';
  if v_count <> 0 then
    raise exception 'FAIL: sns_comments_insert_ownポリシーが残っている';
  end if;
  raise notice 'PASS: sns_comments_insert_ownポリシーは存在しない';
end $$;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_topic_id uuid;
  v_answer_id uuid;
begin
  insert into auth.users (id) values (v_user_id);
  insert into public.sns_topics (author_id, body) values (v_user_id, '0087コメント回帰確認お題')
    returning id into v_topic_id;
  insert into public.sns_answers (topic_id, author_id, body) values (v_topic_id, v_user_id, '0087コメント回帰確認回答')
    returning id into v_answer_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_user_id::text, true);
  begin
    insert into public.sns_comments (answer_id, author_id, body) values (v_answer_id, v_user_id, '直接INSERTテスト');
    raise exception 'FAIL: sns_commentsへ直接INSERTできてしまった（寄合券消費を経由せず投稿できる）';
  exception
    when insufficient_privilege then
      raise notice 'PASS: sns_commentsへの直接INSERTは拒否される（submit_sns_comment RPC経由のみ）';
  end;
end $$;
reset role;

-- ============================================================
-- テスト3: answers。旧indexが存在せず、新indexのみ存在する。
-- ============================================================
do $$
declare
  v_old_count int;
  v_new_count int;
begin
  select count(*) into v_old_count from pg_indexes
    where tablename = 'answers' and indexname = 'answers_one_active_per_turn';
  select count(*) into v_new_count from pg_indexes
    where tablename = 'answers' and indexname = 'answers_one_unresolved_per_turn';
  if v_old_count <> 0 then
    raise exception 'FAIL: 旧indexのanswers_one_active_per_turnが残っている';
  end if;
  if v_new_count <> 1 then
    raise exception 'FAIL: 新indexのanswers_one_unresolved_per_turnが存在しない';
  end if;
  raise notice 'PASS: answersのindexは新indexのみ存在する';
end $$;

-- ============================================================
-- テスト4: recompute_answering_cue_for_turn。0064が意図した
--          resolved=false基準で動作する（revealed_at is null基準には戻らない）。
-- ============================================================
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
    values (v_live_id, now(), 'answering', 8702, 1, 10);
  insert into public.groups (id, live_id, group_order) values (v_group_id, v_live_id, 1);
  insert into public.topics (id, live_id, body, format) values (v_topic_id, v_live_id, '0087cue回帰確認お題', 'text');
  insert into public.participants (id, live_id, user_id, group_id, role)
    values (v_participant_id, v_live_id, v_player_id, v_group_id, 'player');
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (v_turn_id, v_live_id, 1, v_group_id, v_topic_id, 'active', 0);
  update public.lives set current_turn_id = v_turn_id where id = v_live_id;

  -- revealed_at設定済み・resolved=falseの回答(=審査中)。
  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, resolved)
    values (v_answer_id, v_turn_id, v_participant_id, 1, '0087cue回帰確認の回答', now(), false);

  perform public.recompute_answering_cue_for_turn(v_turn_id);

  select pending_participant_id, busy into v_pending, v_busy
    from public.answering_cues where live_id = v_live_id;

  -- 0063（旧ロジック、revealed_at is null基準）ならここでv_pendingはnullになる
  -- （既にrevealed_atが設定済みのため）。0064（resolved=false基準）が正しく
  -- 効いていれば、resolved=falseである限りpending_participant_idは維持される。
  if v_pending is distinct from v_participant_id or v_busy is distinct from true then
    raise exception 'FAIL: revealed_at設定後もresolved=falseの間はpending_participant_idが維持されるべきだが、pending=%, busy=%（0064以前の旧ロジックに戻っている疑い）', v_pending, v_busy;
  end if;
  raise notice 'PASS: reveal後もresolved=falseの間はpending_participant_idが維持される（0064の意図した挙動）';

  -- 採点確定(resolved=true)後は、pending_participant_idがnullに戻る。
  update public.answers set resolved = true where id = v_answer_id;
  perform public.recompute_answering_cue_for_turn(v_turn_id);
  select pending_participant_id, busy into v_pending, v_busy
    from public.answering_cues where live_id = v_live_id;
  if v_pending is not null or v_busy is distinct from false then
    raise exception 'FAIL: 採点確定後はpending_participant_idがnullになるべきだが、pending=%, busy=%', v_pending, v_busy;
  end if;
  raise notice 'PASS: 採点確定(resolved=true)後はpending_participant_idがnullに戻る';
end $$;

-- ============================================================
-- テスト5: function ACL。個別に見つかった4関数がPUBLIC/anonから
--          実行できない（is_host・sns_author_names・
--          sns_result_participant_user_idsの意図的な例外は影響を受けない）。
-- ============================================================
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
      raise exception 'FAIL: PUBLICが%のEXECUTEを持っている', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'FAIL: anonが%のEXECUTEを持っている', v_fn;
    end if;
  end loop;
  raise notice 'PASS: A-R2で見つかった4関数はいずれもPUBLIC/anonからEXECUTEできない';
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', gen_random_uuid()::text, true);
  perform public.is_host();
  set local role anon;
  perform public.is_host();
  perform public.sns_author_names(array[gen_random_uuid()]);
  perform public.sns_result_participant_user_ids(array[gen_random_uuid()]);
  raise notice 'PASS: is_host/sns_author_names/sns_result_participant_user_idsの意図的な例外は引き続き呼べる';
end $$;
reset role;

-- ============================================================
-- テスト6: pg_default_acl。今後publicスキーマに作成される関数が、
--          デフォルトでPUBLIC実行可にならない（schema付き・global両方の形）。
--          current_userのOIDに限定し、aclitem文字列の曖昧な先頭一致には
--          依存せずaclexplode()で判定する。
-- ============================================================
do $$
declare
  v_role oid := current_user::regrole;
  v_public_ns oid := (select oid from pg_namespace where nspname = 'public');
  v_global_row_exists boolean;
  v_global_public_execute boolean;
  v_schema_public_execute boolean;
begin
  select exists (
    select 1 from pg_default_acl d
    where d.defaclobjtype = 'f' and d.defaclnamespace = 0 and d.defaclrole = v_role
  ) into v_global_row_exists;
  if not v_global_row_exists then
    raise exception 'FAIL: current_user(oid=%)のglobal default privileges(defaclnamespace=0)のoverride行が存在しない（0062/0063/0087が効いていない）', v_role;
  end if;

  select exists (
    select 1 from pg_default_acl d, aclexplode(d.defaclacl) x
    where d.defaclobjtype = 'f' and d.defaclnamespace = 0 and d.defaclrole = v_role
      and x.grantee = 0 and x.privilege_type = 'EXECUTE'
  ) into v_global_public_execute;
  if v_global_public_execute then
    raise exception 'FAIL: current_user(oid=%)のglobal default privilegesにPUBLICのEXECUTEがaclexplode()で検出された', v_role;
  end if;

  -- public schema固有の形は、単独では行として残らない場合がある（0063の
  -- コード内コメント参照）。行が存在する場合に限りPUBLICのEXECUTEが
  -- 含まれないことを確認する（存在しないこと自体は失敗にしない）。
  select exists (
    select 1 from pg_default_acl d, aclexplode(d.defaclacl) x
    where d.defaclobjtype = 'f' and d.defaclnamespace = v_public_ns and d.defaclrole = v_role
      and x.grantee = 0 and x.privilege_type = 'EXECUTE'
  ) into v_schema_public_execute;
  if v_schema_public_execute then
    raise exception 'FAIL: current_user(oid=%)のpublic schema固有default privilegesにPUBLICのEXECUTEがaclexplode()で検出された', v_role;
  end if;

  raise notice 'PASS: pg_default_acl（current_userのglobal・public schema固有の両方）にPUBLICのEXECUTEは残っていない';
end $$;

-- ビヘイビアでも直接確認する：今この時点で新規に関数を作ってもPUBLIC実行可に
-- ならないことを確認し、確認後すぐに削除する。
create function public._driftcheck_normal_flow_new_fn() returns int language sql as $fn$ select 1 $fn$;
do $$
begin
  if has_function_privilege('public', 'public._driftcheck_normal_flow_new_fn()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL: 通常フローの0087適用後でも新規関数がPUBLIC実行可になっている';
  end if;
  raise notice 'PASS: 通常フローの0087適用後、新規関数は引き続きPUBLIC実行可にならない';
end $$;
drop function public._driftcheck_normal_flow_new_fn();

-- ============================================================
-- テスト7: 0087自身を再度適用しても例外なく完走する（再実行安全性）。
-- ============================================================
\echo '--- 0087を再適用（再実行安全性の確認） ---'
\ir ../migrations/0087_fix_forward_production_drift.sql

do $$
begin
  if has_table_privilege('authenticated', 'public.scores', 'UPDATE') then
    raise exception 'FAIL: 0087再適用後にscoresのUPDATE権限が復活している';
  end if;
  raise notice 'PASS: 0087を再適用しても期待状態が保たれる';
end $$;

select '0087 ALL TESTS PASSED' as result;
