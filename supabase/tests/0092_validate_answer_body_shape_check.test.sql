-- 0092（answers_body_shape_checkのVALIDATE）の回帰テスト。
-- 実行方法はsupabase/tests/run.sh参照。
--
-- 方針：
--   - 本体（テスト1〜3）は1トランザクションで実行し、最後にrollbackする（試験データを一切残さない）。
--     ロックの確認（テスト4）は、本体で取ったロックと混ざらないよう別トランザクションで行い、
--     そちらもrollbackする。
--   - VALIDATEはテスト側で同じ文を書き写さず、マイグレーション本体を\irでそのまま実行する
--     （マイグレーションの内容が変われば、このテストの結果も変わる）。
--   - 回答本文そのものはログ・例外メッセージへ出さない（ケース名・SQLSTATE・件数だけ）。
--     回答の指紋はmd5で比較し、値は表示しない。

\set ON_ERROR_STOP on

begin;

-- 他のテストが残したライブを閉じる（rollbackで元に戻る）。
update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous) values
  ('e0920000-0000-0000-0000-00000000000f', false), -- admin
  ('e0920000-0000-0000-0000-000000000001', false), -- player
  ('e0920000-0000-0000-0000-000000000002', false), -- player
  ('e0920000-0000-0000-0000-000000000003', false), -- player
  ('e0920000-0000-0000-0000-000000000004', false), -- player
  ('e0920000-0000-0000-0000-000000000005', false), -- player
  ('e0920000-0000-0000-0000-000000000006', false); -- player
update public.profiles set role = 'admin' where id = 'e0920000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('e0922000-0000-0000-0000-000000000001', '0092テスト用お題(1組)', 'text', true),
  ('e0922000-0000-0000-0000-000000000002', '0092テスト用お題(2組)', 'text', true);

-- ライブ準備〜開始（adminとして、正規RPC経由）。回答のturn・participantを正規に用意するため。
do $$
declare
  v_r record;
  v_live uuid;
  v_uid uuid;
begin
  perform set_config('myapp.uid', 'e0920000-0000-0000-0000-00000000000f', true);
  select * into v_r from public.create_live_preparation(
    now(), '0092制約VALIDATEテスト', 20, 2,
    array['e0922000-0000-0000-0000-000000000001', 'e0922000-0000-0000-0000-000000000002']::uuid[]
  );
  if v_r.ok is not true then
    raise exception 'FAIL: 0092テスト用ライブの作成に失敗(reason=%)', v_r.reason;
  end if;
  v_live := v_r.live_id;
  update public.lives set current_phase = 'opening' where id = v_live;

  foreach v_uid in array array[
    'e0920000-0000-0000-0000-000000000001', 'e0920000-0000-0000-0000-000000000002',
    'e0920000-0000-0000-0000-000000000003', 'e0920000-0000-0000-0000-000000000004',
    'e0920000-0000-0000-0000-000000000005', 'e0920000-0000-0000-0000-000000000006'
  ]::uuid[] loop
    perform set_config('myapp.uid', v_uid::text, true);
    perform public.join_live(v_live, 'player', null);
  end loop;

  perform set_config('myapp.uid', 'e0920000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live);
  perform public.begin_game(v_live);
  perform set_config('myapp.uid', '', true);
end $$;

-- 回答を入れる先（登壇中ターンと、そのライブのplayer 3人）。
--   pids[1]：既存の適合行の持ち主
--   pids[2]：不適合な旧行（テスト用）の持ち主
--   pids[3]：VALIDATE後の新規INSERT・UPDATEの試験用
create temporary table _t0092_ctx as
select
  l.id as live_id,
  t.id as turn_id,
  (select array_agg(p.id order by p.id) from public.participants p
     where p.live_id = l.id and p.role = 'player') as pids
from public.lives l
join public.turns t on t.live_id = l.id and t.status = 'active'
where l.title = '0092制約VALIDATEテスト';

do $$
declare
  v_c record;
begin
  if (select count(*) from _t0092_ctx) <> 1 then
    raise exception 'FAIL: 0092テストの前提（登壇中ターン）が特定できない';
  end if;
  select * into v_c from _t0092_ctx;
  if coalesce(array_length(v_c.pids, 1), 0) < 3 then
    raise exception 'FAIL: 0092テストの前提（player 3人以上）が揃っていない';
  end if;

  -- 既存の適合行（0091適用前から存在し、制約に適合している回答の代理）。
  -- answers_one_unresolved_per_turnに掛からないよう確定済み(resolved=true)にする。
  insert into public.answers (turn_id, participant_id, seq, body, resolved) values
    (v_c.turn_id, v_c.pids[1], 1, '適合する既存回答その1', true),
    (v_c.turn_id, v_c.pids[1], 2, repeat('あ', 50), true),
    (v_c.turn_id, v_c.pids[1], 3, chr(32) || '前後に空白がある既存回答' || chr(12288), true);
end $$;

-- 補助：answers_body_shape_checkに適合しない行の件数（制約と同じ条件をテスト側で独立に書く）。
create function pg_temp.t0092_nonconforming_count() returns int
language sql as $$
  select count(*)::int from public.answers a
  where not (
    char_length(a.body) between 1 and 50
    and btrim(
      a.body,
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32)
        || chr(160) || chr(12288) || chr(65279)
    ) <> ''
  )
$$;

-- 補助：answersの件数と集約指紋。行の物理位置(ctid)・作成トランザクション(xmin)・行全体を
-- 含めるため、UPDATE（同じ値への更新も含む）・DELETE・INSERTのいずれがあっても変わる。
-- 値はmd5でのみ比較し、本文は表示しない。
create function pg_temp.t0092_answers_fingerprint() returns text
language sql as $$
  select count(*)::text || ':' || coalesce(md5(string_agg(
           a.ctid::text || '|' || a.xmin::text || '|' || (a.*)::text, E'\n' order by a.id)), '-')
  from public.answers a
$$;

-- 補助：このトランザクション内のDML件数（一時表を除く全ユーザーテーブル）。
create function pg_temp.t0092_dml_counters() returns text
language sql as $$
  select coalesce(string_agg(
           relid::regclass::text || ':' || n_tup_ins || '/' || n_tup_upd || '/' || n_tup_del || '/' || n_tup_hot_upd,
           ',' order by relid), '-')
  from pg_stat_xact_user_tables
  where schemaname !~ '^pg_temp' and schemaname !~ '^pg_toast'
$$;

-- 補助：0092が変更してはならないカタログ（RLS policy・ACL・RLS有効化フラグ・trigger・関数定義・
-- answers_body_shape_check以外の制約・index・NOT NULL）の要約。
create function pg_temp.t0092_catalog_snapshot() returns text
language sql as $$
  select md5(string_agg(x, E'\n' order by x)) from (
    select 'policy|' || tablename || '|' || policyname || '|' || permissive || '|' || roles::text || '|' || cmd
           || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as x
      from pg_policies where schemaname = 'public'
    union all
    select 'relacl|' || c.oid::regclass::text || '|' || coalesce(c.relacl::text, '') || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity
      from pg_class c where c.relnamespace = 'public'::regnamespace
    union all
    select 'attacl|' || a.attrelid::regclass::text || '|' || a.attname || '|' || coalesce(a.attacl::text, '') || '|' || a.attnotnull
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
    union all
    select 'trigger|' || t.tgrelid::regclass::text || '|' || pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
    union all
    select 'function|' || p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|' || coalesce(p.proacl::text, '')
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
    union all
    select 'index|' || indexname || '|' || indexdef from pg_indexes where schemaname = 'public'
    union all
    select 'constraint|' || c.conrelid::regclass::text || '|' || c.conname || '|' || pg_get_constraintdef(c.oid) || '|' || c.convalidated
      from pg_constraint c
      where c.connamespace = 'public'::regnamespace and c.conname <> 'answers_body_shape_check'
  ) s
$$;

-- 補助：superuserで回答をINSERT／UPDATEし、SQLSTATEと行数・指紋の変化を検証する。
--   受理を期待する場合は行数+1を確認して直後に削除し、件数を元に戻す。
--   本文はどのメッセージにも出さない。
create function pg_temp.t0092_try_write(
  p_case text,
  p_kind text,          -- 'insert' または 'update'
  p_participant uuid,
  p_seq int,
  p_body text,
  p_expect_state text
) returns void
language plpgsql as $$
declare
  v_turn uuid;
  v_before_n int;
  v_before_fp text;
  v_state text;
  v_constraint text;
begin
  select turn_id into v_turn from _t0092_ctx;
  select count(*) into v_before_n from public.answers;
  v_before_fp := pg_temp.t0092_answers_fingerprint();
  begin
    if p_kind = 'insert' then
      insert into public.answers (turn_id, participant_id, seq, body, resolved)
        values (v_turn, p_participant, p_seq, p_body, true);
    else
      update public.answers set body = p_body
        where turn_id = v_turn and participant_id = p_participant and seq = p_seq;
      if not found then
        raise exception 'FAIL[%]: UPDATE対象の行が無い（試験の前提崩れ）', p_case;
      end if;
    end if;
    v_state := '00000';
    v_constraint := null;
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
  end;

  if v_state <> p_expect_state then
    raise exception 'FAIL[%]: SQLSTATEが期待と違う(期待=%, 実際=%, 制約=%)',
      p_case, p_expect_state, v_state, coalesce(nullif(v_constraint, ''), '-');
  end if;
  if p_expect_state = '23514' then
    if v_constraint is distinct from 'answers_body_shape_check' then
      raise exception 'FAIL[%]: 拒否した制約が期待と違う(実際=%)', p_case, coalesce(nullif(v_constraint, ''), '-');
    end if;
    if pg_temp.t0092_answers_fingerprint() <> v_before_fp then
      raise exception 'FAIL[%]: 拒否なのに回答の件数・指紋が変化した', p_case;
    end if;
    raise notice 'PASS[%]: 拒否（SQLSTATE=23514、制約=answers_body_shape_check、件数・指紋不変）', p_case;
  else
    if p_kind = 'insert' then
      if (select count(*) from public.answers) <> v_before_n + 1 then
        raise exception 'FAIL[%]: 受理なのに行数が+1になっていない', p_case;
      end if;
      delete from public.answers where turn_id = v_turn and participant_id = p_participant and seq = p_seq;
      if (select count(*) from public.answers) <> v_before_n then
        raise exception 'FAIL[%]: 後片付け後の件数が元に戻らない', p_case;
      end if;
    end if;
    raise notice 'PASS[%]: 受理（SQLSTATE=00000、件数 %）', p_case, v_before_n;
  end if;
end $$;

create temporary table _t0092_kv (k text primary key, v text);

-- ============================================================
-- テスト1：通常状態（run.shが0001〜0092を全件適用した直後の状態）
-- ============================================================
do $$
declare
  v_n int;
  v_con record;
  v_expected_def constant text :=
    'CHECK ((((char_length(body) >= 1) AND (char_length(body) <= 50)) AND (btrim(body, '
    || '((((((((chr(9) || chr(10)) || chr(11)) || chr(12)) || chr(13)) || chr(32)) || chr(160)) '
    || '|| chr(12288)) || chr(65279))) <> ''''::text)))';
begin
  select count(*) into v_n from pg_constraint where conname = 'answers_body_shape_check';
  if v_n <> 1 then
    raise exception 'FAIL: answers_body_shape_checkが1件だけではない(件数=%)', v_n;
  end if;
  select c.oid, c.conrelid, c.contype, c.convalidated, pg_get_constraintdef(c.oid) as def
    into v_con
    from pg_constraint c where c.conname = 'answers_body_shape_check';
  if v_con.conrelid <> 'public.answers'::regclass then
    raise exception 'FAIL: answers_body_shape_checkの対象がpublic.answersではない';
  end if;
  if v_con.contype <> 'c' then
    raise exception 'FAIL: answers_body_shape_checkがCHECK制約ではない(contype=%)', v_con.contype;
  end if;
  if v_con.convalidated is not true then
    raise exception 'FAIL: 通常状態のanswers_body_shape_checkがVALIDATE済みではない(convalidated=%)', v_con.convalidated;
  end if;
  if v_con.def <> v_expected_def then
    raise exception 'FAIL: answers_body_shape_checkの定義が期待と違う（NOT VALIDが付いていないはず）';
  end if;
  raise notice 'PASS: answers_body_shape_checkはpublic.answersのCHECK制約1件、convalidated=true、定義は期待どおり（NOT VALIDなし）';

  select count(*) into v_n from pg_constraint where conrelid = 'public.answers'::regclass and contype = 'c';
  if v_n <> 1 then
    raise exception 'FAIL: public.answersのCHECK制約が1件ではない(件数=%)', v_n;
  end if;

  if not (select attnotnull from pg_attribute where attrelid = 'public.answers'::regclass and attname = 'body') then
    raise exception 'FAIL: answers.bodyのNOT NULLが失われている';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'public.answers'::regclass and conname = 'answers_turn_id_participant_id_seq_key')
     is distinct from 'UNIQUE (turn_id, participant_id, seq)' then
    raise exception 'FAIL: answersの一意制約(turn_id, participant_id, seq)が変化している';
  end if;
  if (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'answers_one_unresolved_per_turn')
     is distinct from 'CREATE UNIQUE INDEX answers_one_unresolved_per_turn ON public.answers USING btree (turn_id) WHERE (resolved = false)' then
    raise exception 'FAIL: 部分unique index answers_one_unresolved_per_turnが変化している';
  end if;
  -- answersのindexは0091以前から存在する4件だけ（0092がindexを追加していない）。
  -- 「if not exists」付きのindex追加は再実行やカタログ差分では検出できないため、絶対的な一覧で確認する。
  if (select string_agg(indexname, ',' order by indexname) from pg_indexes
        where schemaname = 'public' and tablename = 'answers')
     is distinct from 'answers_live_id_idx,answers_one_unresolved_per_turn,answers_pkey,answers_turn_id_participant_id_seq_key' then
    raise exception 'FAIL: public.answersのindex一覧が期待（既存の4件）と違う';
  end if;
  raise notice 'PASS: body NOT NULL・一意制約(turn_id, participant_id, seq)・部分unique index(answers_one_unresolved_per_turn)は維持され、answersのindexは既存の4件だけ';

  v_n := pg_temp.t0092_nonconforming_count();
  if v_n <> 0 then
    raise exception 'FAIL: 通常状態で不適合行が0件ではない(件数=%)', v_n;
  end if;
  raise notice 'PASS: 通常状態の不適合行は0件（回答 % 件）', (select count(*) from public.answers);

  insert into _t0092_kv values
    ('constraint_oid', v_con.oid::text),
    ('def_validated', v_con.def),
    ('catalog', pg_temp.t0092_catalog_snapshot()),
    ('fingerprint', pg_temp.t0092_answers_fingerprint()),
    ('answers_count', (select count(*) from public.answers)::text),
    ('filenode', pg_relation_filenode('public.answers')::text),
    ('dml', pg_temp.t0092_dml_counters());
end $$;

-- 通常状態（VALIDATE済み）で0092をもう一度流しても、エラーにならず何も変わらない。
\ir ../migrations/0092_validate_answer_body_shape_check.sql

do $$
begin
  if (select convalidated from pg_constraint where conname = 'answers_body_shape_check') is not true
     or (select oid::text from pg_constraint where conname = 'answers_body_shape_check')
        <> (select v from _t0092_kv where k = 'constraint_oid') then
    raise exception 'FAIL: VALIDATE済みの状態で0092を流した後、制約の状態・OIDが変化した';
  end if;
  if pg_temp.t0092_catalog_snapshot() <> (select v from _t0092_kv where k = 'catalog') then
    raise exception 'FAIL: 0092の適用でRLS policy・ACL・trigger・関数定義・既存制約・indexのいずれかが変化した';
  end if;
  if pg_temp.t0092_answers_fingerprint() <> (select v from _t0092_kv where k = 'fingerprint')
     or (select count(*) from public.answers)::text <> (select v from _t0092_kv where k = 'answers_count')
     or pg_relation_filenode('public.answers')::text <> (select v from _t0092_kv where k = 'filenode')
     or pg_temp.t0092_dml_counters() <> (select v from _t0092_kv where k = 'dml') then
    raise exception 'FAIL: 0092の適用で回答の件数・指紋・filenode・DML件数のいずれかが変化した';
  end if;
  raise notice 'PASS: VALIDATE済みの状態で0092を流してもエラーにならず、制約・カタログ・回答件数・指紋・filenode・DML件数は不変';
end $$;

-- ============================================================
-- テスト2：不適合な旧行がある場合、0092のVALIDATEは23514で失敗する
--          （このトランザクション内だけで制約を外し、0091適用前の状態を再現する）
-- ============================================================
do $$
declare
  v_c record;
begin
  select * into v_c from _t0092_ctx;

  alter table public.answers drop constraint answers_body_shape_check;

  -- 0091適用前から存在した扱いの不適合な旧行（運営操作の代理、superuser実行）。
  insert into public.answers (turn_id, participant_id, seq, body, resolved) values
    (v_c.turn_id, v_c.pids[2], 1, '', true),                          -- 空文字
    (v_c.turn_id, v_c.pids[2], 2, chr(12288) || chr(160) || chr(9), true), -- 指定空白だけ
    (v_c.turn_id, v_c.pids[2], 3, repeat('a', 51), true);             -- 51コードポイント
  insert into _t0092_kv
    select 'legacy_ids', string_agg(id::text, ',' order by seq)
    from public.answers where participant_id = v_c.pids[2];
  if (select count(*) from public.answers where participant_id = v_c.pids[2]) <> 3
     or pg_temp.t0092_nonconforming_count() <> 3 then
    raise exception 'FAIL: 不適合な旧行(3件)を用意できない';
  end if;
  raise notice 'PASS(前提): 制約を外した状態で不適合な旧行3件（空文字・指定空白だけ・51コードポイント）を用意した';
end $$;

-- 0091を再適用する（不適合な旧行があってもNOT VALIDなので成功する）。
\ir ../migrations/0091_answer_body_shape_check.sql

do $$
begin
  if (select convalidated from pg_constraint where conname = 'answers_body_shape_check') is not false then
    raise exception 'FAIL: 0091再適用後のanswers_body_shape_checkがNOT VALIDでない';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'answers_body_shape_check')
     is distinct from (select v from _t0092_kv where k = 'def_validated') || ' NOT VALID' then
    raise exception 'FAIL: 0091再適用後の定義が「通常状態の定義＋NOT VALID」になっていない';
  end if;
  if pg_temp.t0092_catalog_snapshot() <> (select v from _t0092_kv where k = 'catalog') then
    raise exception 'FAIL: 0091再適用後のカタログが通常状態と一致しない';
  end if;
  insert into _t0092_kv values
    ('constraint_oid_notvalid', (select oid::text from pg_constraint where conname = 'answers_body_shape_check')),
    ('fingerprint_with_legacy', pg_temp.t0092_answers_fingerprint()),
    ('count_with_legacy', (select count(*) from public.answers)::text);
  raise notice 'PASS: 不適合な旧行3件があっても0091の再適用は成功し、convalidated=false（回答 % 件、うち不適合 % 件）',
    (select count(*) from public.answers), pg_temp.t0092_nonconforming_count();
end $$;

-- 0092本体を流す。不適合な旧行があるため失敗するはず（想定どおりのERROR出力が1行出る）。
-- 失敗をsavepointへのrollbackで回収し、SQLSTATEを後で検証する。
savepoint t0092_validate_fail;
\set ON_ERROR_STOP off
\echo '（想定どおりのERROR：不適合な旧行があるため0092のVALIDATEは失敗する）'
\ir ../migrations/0092_validate_answer_body_shape_check.sql
\set t0092_validate_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
rollback to savepoint t0092_validate_fail;
select set_config('t0092.validate_sqlstate', :'t0092_validate_sqlstate', true) \gset t0092_ignored_

do $$
declare
  v_legacy_ids uuid[];
begin
  select string_to_array(v, ',')::uuid[] into v_legacy_ids from _t0092_kv where k = 'legacy_ids';

  if current_setting('t0092.validate_sqlstate') <> '23514' then
    raise exception 'FAIL: 不適合な旧行がある状態で0092が23514で失敗しなかった(SQLSTATE=%)',
      current_setting('t0092.validate_sqlstate');
  end if;
  raise notice 'PASS: 不適合な旧行がある状態で0092のVALIDATEはSQLSTATE=23514で失敗した';

  if (select count(*) from pg_constraint where conname = 'answers_body_shape_check') <> 1
     or (select convalidated from pg_constraint where conname = 'answers_body_shape_check') is not false
     or (select oid::text from pg_constraint where conname = 'answers_body_shape_check')
        <> (select v from _t0092_kv where k = 'constraint_oid_notvalid') then
    raise exception 'FAIL: VALIDATE失敗後、制約がconvalidated=falseのまま同じ1件で残っていない';
  end if;
  raise notice 'PASS: VALIDATE失敗後も制約は同じ1件のまま、convalidated=false';

  if (select count(*) from public.answers where id = any(v_legacy_ids)) <> 3
     or not exists (select 1 from public.answers where id = v_legacy_ids[1] and body = '')
     or not exists (select 1 from public.answers where id = v_legacy_ids[2] and body = chr(12288) || chr(160) || chr(9))
     or not exists (select 1 from public.answers where id = v_legacy_ids[3] and body = repeat('a', 51)) then
    raise exception 'FAIL: VALIDATE失敗で不適合な旧行が削除・変更された';
  end if;
  if pg_temp.t0092_answers_fingerprint() <> (select v from _t0092_kv where k = 'fingerprint_with_legacy')
     or (select count(*) from public.answers)::text <> (select v from _t0092_kv where k = 'count_with_legacy') then
    raise exception 'FAIL: VALIDATE失敗の前後で回答の件数・指紋が変化した';
  end if;
  raise notice 'PASS: VALIDATE失敗の前後で不適合な旧行3件は不変、回答件数(%)・指紋も不変',
    (select count(*) from public.answers);
end $$;

-- ============================================================
-- テスト3：テスト用の不適合行だけを除くと、0092のVALIDATEは成功する
-- ============================================================
do $$
declare
  v_legacy_ids uuid[];
  v_n int;
begin
  select string_to_array(v, ',')::uuid[] into v_legacy_ids from _t0092_kv where k = 'legacy_ids';
  -- テスト用の不適合行（IDで特定した3件）だけを削除する。他の行には触れない。
  delete from public.answers where id = any(v_legacy_ids);
  get diagnostics v_n = row_count;
  if v_n <> 3 then
    raise exception 'FAIL: テスト用の不適合行の削除件数が3件ではない(件数=%)', v_n;
  end if;
  if pg_temp.t0092_nonconforming_count() <> 0 then
    raise exception 'FAIL: テスト用の不適合行を除いた後も不適合行が残っている';
  end if;
  -- 残った行は、テスト1時点の適合する既存行そのもの（件数・指紋が一致）。
  if pg_temp.t0092_answers_fingerprint() <> (select v from _t0092_kv where k = 'fingerprint') then
    raise exception 'FAIL: テスト用の不適合行を除いた後の回答がテスト1時点と一致しない';
  end if;
  raise notice 'PASS(前提): テスト用の不適合行3件だけを削除し、不適合行0件・適合する既存行はテスト1時点と一致';

  insert into _t0092_kv values
    ('dml_before_validate', pg_temp.t0092_dml_counters()),
    ('filenode_before_validate', pg_relation_filenode('public.answers')::text);
end $$;

-- 0092が実行するDDLを記録するイベントトリガー（このトランザクション内だけ、rollbackで消える）。
create temporary table _t0092_ddl (command_tag text, object_type text, object_identity text);
create function pg_temp.t0092_capture_ddl() returns event_trigger
language plpgsql as $$
begin
  insert into pg_temp._t0092_ddl
    select command_tag, object_type, object_identity from pg_event_trigger_ddl_commands();
end $$;
create event trigger t0092_capture_ddl on ddl_command_end execute function pg_temp.t0092_capture_ddl();

-- 0092本体を流す（ON_ERROR_STOP onなので、失敗すればここでテストが止まる）。
\ir ../migrations/0092_validate_answer_body_shape_check.sql

drop event trigger t0092_capture_ddl;

do $$
declare
  v_c record;
begin
  select * into v_c from _t0092_ctx;

  if (select count(*) from pg_constraint where conname = 'answers_body_shape_check') <> 1
     or (select convalidated from pg_constraint where conname = 'answers_body_shape_check') is not true then
    raise exception 'FAIL: 不適合行を除いた後の0092で、answers_body_shape_checkがconvalidated=trueにならない';
  end if;
  if (select oid::text from pg_constraint where conname = 'answers_body_shape_check')
       <> (select v from _t0092_kv where k = 'constraint_oid_notvalid')
     or (select pg_get_constraintdef(oid) from pg_constraint where conname = 'answers_body_shape_check')
       <> (select v from _t0092_kv where k = 'def_validated') then
    raise exception 'FAIL: 0092で制約が作り直された、または定義が通常状態と一致しない';
  end if;
  raise notice 'PASS: 不適合行を除くと0092のVALIDATEは成功し、同じ制約(OID不変)がconvalidated=true・定義は通常状態と一致';

  -- 0092が実行したDDLは「public.answersに対するALTER TABLE」1件だけ。
  if (select count(*) from _t0092_ddl) <> 1
     or not exists (select 1 from _t0092_ddl
                    where command_tag = 'ALTER TABLE' and object_type = 'table' and object_identity = 'public.answers') then
    raise exception 'FAIL: 0092が実行したDDLが「public.answersのALTER TABLE 1件」ではない(件数=%)',
      (select count(*) from _t0092_ddl);
  end if;
  raise notice 'PASS: 0092が実行したDDLはpublic.answersのALTER TABLE 1件だけ';

  -- VALIDATEの前後で、データ・カタログ・テーブル実体が変わっていない。
  if pg_temp.t0092_dml_counters() <> (select v from _t0092_kv where k = 'dml_before_validate') then
    raise exception 'FAIL: 0092の実行中に何らかのテーブルへのINSERT・UPDATE・DELETEが発生した';
  end if;
  if pg_relation_filenode('public.answers')::text <> (select v from _t0092_kv where k = 'filenode_before_validate') then
    raise exception 'FAIL: 0092でpublic.answersが書き換え（再作成）された';
  end if;
  if pg_temp.t0092_answers_fingerprint() <> (select v from _t0092_kv where k = 'fingerprint')
     or (select count(*) from public.answers)::text <> (select v from _t0092_kv where k = 'answers_count') then
    raise exception 'FAIL: 0092の前後で回答の件数・指紋が変化した';
  end if;
  if pg_temp.t0092_catalog_snapshot() <> (select v from _t0092_kv where k = 'catalog') then
    raise exception 'FAIL: 0092の前後でRLS policy・ACL・trigger・関数定義・既存制約・indexのいずれかが変化した';
  end if;
  raise notice 'PASS: 0092の前後で、全テーブルのDML件数0・answersのfilenode不変・回答件数(%)と指紋不変・RLS/ACL/trigger/関数/制約/indexは不変',
    (select count(*) from public.answers);

  -- VALIDATE後も、新規の不適合INSERT・UPDATEは拒否され、適合INSERTは受理される。
  perform pg_temp.t0092_try_write('VALIDATE後:空文字INSERT', 'insert', v_c.pids[3], 1, '', '23514');
  perform pg_temp.t0092_try_write('VALIDATE後:全角空白だけINSERT', 'insert', v_c.pids[3], 1, chr(12288), '23514');
  perform pg_temp.t0092_try_write('VALIDATE後:51コードポイントINSERT', 'insert', v_c.pids[3], 1, repeat('あ', 51), '23514');
  perform pg_temp.t0092_try_write('VALIDATE後:適合する本文をUPDATEで空白だけに', 'update', v_c.pids[1], 1, repeat(chr(32), 2), '23514');
  perform pg_temp.t0092_try_write('VALIDATE後:適合する本文をUPDATEで51コードポイントに', 'update', v_c.pids[1], 2, repeat('a', 51), '23514');
  perform pg_temp.t0092_try_write('VALIDATE後:適合INSERT', 'insert', v_c.pids[3], 1, '適合する新しい回答', '00000');
  perform pg_temp.t0092_try_write('VALIDATE後:適合INSERT(50コードポイント)', 'insert', v_c.pids[3], 1, repeat('a', 50), '00000');
end $$;

rollback;

-- ============================================================
-- テスト4：0092のロック（本体とは別トランザクションで、0092だけが取るロックを観測する）
-- ============================================================
begin;

-- 本体のpg_temp関数はrollbackで消えているため、DML件数の集計をこのトランザクション用に作り直す。
create function pg_temp.t0092_dml_counters() returns text
language sql as $$
  select coalesce(string_agg(
           relid::regclass::text || ':' || n_tup_ins || '/' || n_tup_upd || '/' || n_tup_del || '/' || n_tup_hot_upd,
           ',' order by relid), '-')
  from pg_stat_xact_user_tables
  where schemaname !~ '^pg_temp' and schemaname !~ '^pg_toast'
$$;

do $$
begin
  if exists (select 1 from pg_locks
             where pid = pg_backend_pid() and locktype = 'relation' and relation = 'public.answers'::regclass) then
    raise exception 'FAIL: 0092適用前からpublic.answersのロックを保持している（試験の前提崩れ）';
  end if;
end $$;
select set_config('t0092.dml_before', pg_temp.t0092_dml_counters(), true) \gset t0092_ignored_

\ir ../migrations/0092_validate_answer_body_shape_check.sql

do $$
declare
  v_modes text;
begin
  select string_agg(mode, ',' order by mode) into v_modes
    from pg_locks
    where pid = pg_backend_pid() and locktype = 'relation' and relation = 'public.answers'::regclass;
  if v_modes is distinct from 'ShareUpdateExclusiveLock' then
    raise exception 'FAIL: 0092がpublic.answersに取るロックがShareUpdateExclusiveLockだけではない(%)', coalesce(v_modes, '-');
  end if;
  if pg_temp.t0092_dml_counters() <> current_setting('t0092.dml_before') then
    raise exception 'FAIL: 0092の実行中に何らかのテーブルへのINSERT・UPDATE・DELETEが発生した';
  end if;
  raise notice 'PASS: 0092がpublic.answersに取るロックはShareUpdateExclusiveLockだけ（AccessExclusiveLockは取らない）、DML件数0';
end $$;

rollback;

-- ============================================================
-- テスト5：rollback後、試験データが残っておらず、制約は通常状態（convalidated=true）のまま
-- ============================================================
do $$
begin
  if exists (select 1 from auth.users where id::text like 'e0920000-%')
     or exists (select 1 from public.topic_bank where id::text like 'e0922000-%')
     or exists (select 1 from public.lives where title = '0092制約VALIDATEテスト') then
    raise exception 'FAIL: 0092テストの試験データが残っている';
  end if;
  if exists (select 1 from pg_event_trigger where evtname = 't0092_capture_ddl') then
    raise exception 'FAIL: 0092テストのイベントトリガーが残っている';
  end if;
  if (select count(*) from pg_constraint where conname = 'answers_body_shape_check') <> 1
     or (select count(*) from pg_constraint where conname = 'answers_body_shape_check' and convalidated = true) <> 1 then
    raise exception 'FAIL: rollback後、answers_body_shape_check(convalidated=true)が1件だけになっていない';
  end if;
  raise notice 'PASS: 試験データ・イベントトリガーは残っておらず、answers_body_shape_checkはconvalidated=trueで1件';
end $$;

select '0092 ALL TESTS PASSED' as result;
