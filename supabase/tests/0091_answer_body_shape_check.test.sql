-- 0091（answers.bodyのDB側入力制約 answers_body_shape_check）の回帰テスト。
-- 実行方法はsupabase/tests/run.sh参照。
--
-- 方針：
--   - 全体を1トランザクションで実行し、最後にrollbackする（試験データを一切残さない）。
--     そのため、set local role / set_config(...,true)はトランザクション終了まで残る点に
--     注意し、ロールを切り替えた箇所は必ずreset roleで戻す。
--   - 回答は、実際のauthenticatedプレイヤーとして既存RLS（answers_insert_own_as_player）
--     を通る正規の live・turn・participant に対してINSERTする。RLSのWITH CHECKは
--     CHECK制約より先に評価されるため、RLSを通る状態での23514が制約による拒否の証拠になる。
--   - 回答本文そのものはログ・例外メッセージへ出さない（ケース名・SQLSTATE・件数だけ）。
--   - トランザクション内ではnow()が一定のため、締切・reveal_sequence_untilの境界を
--     ミリ秒単位で決定的に試験できる。
--   - run.shは全マイグレーション（0092のVALIDATEまで）を適用してからこのテストを流すため、
--     通常状態の制約はconvalidated=true（定義にNOT VALIDが付かない）を期待する。
--     0091自体がNOT VALIDで追加されることは、テスト6でトランザクション内だけ制約を外し、
--     不適合な旧行を作ってから0091本体を\irで再適用して確かめる（rollbackで0092適用済みの
--     convalidated=trueへ戻ることをテスト7で確認する）。

\set ON_ERROR_STOP on

begin;

-- 他のテストが残したライブを閉じる（rollbackで元に戻る）。
update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous) values
  ('e0910000-0000-0000-0000-00000000000f', false), -- admin
  ('e0910000-0000-0000-0000-000000000001', false), -- player
  ('e0910000-0000-0000-0000-000000000002', false), -- player
  ('e0910000-0000-0000-0000-000000000003', false), -- player
  ('e0910000-0000-0000-0000-000000000004', false), -- player
  ('e0910000-0000-0000-0000-000000000005', false), -- player
  ('e0910000-0000-0000-0000-000000000006', false), -- player
  ('e0910000-0000-0000-0000-00000000000a', false), -- 観客（Xユーザー）
  ('e0910000-0000-0000-0000-00000000000b', true);  -- ゲスト（匿名）
update public.profiles set role = 'admin' where id = 'e0910000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('e0912000-0000-0000-0000-000000000001', '0091テスト用お題(1組)', 'text', true),
  ('e0912000-0000-0000-0000-000000000002', '0091テスト用お題(2組)', 'text', true);

-- ライブ準備〜開始（adminとして、正規RPC経由）。
do $$
declare
  v_r record;
  v_live uuid;
  v_uid uuid;
begin
  perform set_config('myapp.uid', 'e0910000-0000-0000-0000-00000000000f', true);
  select * into v_r from public.create_live_preparation(
    now(), '0091回答本文制約テスト', 20, 2,
    array['e0912000-0000-0000-0000-000000000001', 'e0912000-0000-0000-0000-000000000002']::uuid[]
  );
  if v_r.ok is not true then
    raise exception 'FAIL: 0091テスト用ライブの作成に失敗(reason=%)', v_r.reason;
  end if;
  v_live := v_r.live_id;
  update public.lives set current_phase = 'opening' where id = v_live;

  foreach v_uid in array array[
    'e0910000-0000-0000-0000-000000000001', 'e0910000-0000-0000-0000-000000000002',
    'e0910000-0000-0000-0000-000000000003', 'e0910000-0000-0000-0000-000000000004',
    'e0910000-0000-0000-0000-000000000005', 'e0910000-0000-0000-0000-000000000006'
  ]::uuid[] loop
    perform set_config('myapp.uid', v_uid::text, true);
    perform public.join_live(v_live, 'player', null);
  end loop;
  perform set_config('myapp.uid', 'e0910000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live, 'audience', null);
  perform set_config('myapp.uid', 'e0910000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live, 'audience', null);

  perform set_config('myapp.uid', 'e0910000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live);
  perform public.begin_game(v_live);
  perform set_config('myapp.uid', '', true);
end $$;

-- 組分けはランダムなので、登壇組・非登壇組のplayerをDBから動的に特定する。
create temporary table _t0091_ctx as
select
  l.id as live_id,
  t.id as turn_id,
  (select array_agg(p.id order by p.id) from public.participants p
     where p.live_id = l.id and p.role = 'player' and p.group_id = t.group_id) as active_pids,
  (select array_agg(p.user_id order by p.id) from public.participants p
     where p.live_id = l.id and p.role = 'player' and p.group_id = t.group_id) as active_uids,
  (select array_agg(p.id order by p.id) from public.participants p
     where p.live_id = l.id and p.role = 'player' and p.group_id <> t.group_id) as other_pids,
  (select array_agg(p.user_id order by p.id) from public.participants p
     where p.live_id = l.id and p.role = 'player' and p.group_id <> t.group_id) as other_uids,
  (select p.id from public.participants p
     where p.live_id = l.id and p.user_id = 'e0910000-0000-0000-0000-00000000000a') as audience_pid,
  (select p.id from public.participants p
     where p.live_id = l.id and p.user_id = 'e0910000-0000-0000-0000-00000000000b') as guest_pid
from public.lives l
join public.turns t on t.live_id = l.id and t.status = 'active'
where l.title = '0091回答本文制約テスト';

do $$
declare
  v_c record;
  v_n int;
begin
  select count(*) into v_n from _t0091_ctx;
  if v_n <> 1 then
    raise exception 'FAIL: 0091テストの前提（登壇中ターン）が特定できない(件数=%)', v_n;
  end if;
  select * into v_c from _t0091_ctx;
  if coalesce(array_length(v_c.active_pids, 1), 0) < 2 or coalesce(array_length(v_c.other_pids, 1), 0) < 1
     or v_c.audience_pid is null or v_c.guest_pid is null then
    raise exception 'FAIL: 0091テストの前提（登壇組2人以上・非登壇組1人以上・観客・ゲスト）が揃っていない';
  end if;
  if (select role from public.participants where id = v_c.guest_pid) <> 'audience'
     or (select role from public.participants where id = v_c.audience_pid) <> 'audience' then
    raise exception 'FAIL: 0091テストの前提（観客・ゲストがaudience）が崩れている';
  end if;
end $$;

-- 補助：ライブを「回答受付中・正常」状態へ戻す（運営操作の代理、superuser実行）。
create function pg_temp.t0091_reset_state() returns void
language plpgsql as $$
declare
  v_c record;
begin
  select * into v_c from _t0091_ctx;
  update public.lives
    set current_phase = 'answering',
        current_turn_id = v_c.turn_id,
        answering_paused = false,
        phase_deadline = now() + interval '10 minutes',
        reveal_sequence_until = null
    where id = v_c.live_id;
  update public.participants set kicked_at = null where live_id = v_c.live_id;
end $$;

-- 補助：指定ユーザー（authenticated）として回答をINSERTし、結果を検証する。
--   p_expect_state = '00000' なら受理を期待：行数+1・保存本文が入力と完全一致。
--     p_keep=falseならsuperuserで直後に削除し、件数を元に戻す。
--   それ以外なら、そのSQLSTATEでの拒否を期待：総件数・当該turn×participantの件数とも不変。
--     p_expect_constraintが指定されていれば、制約名も一致すること。
--   本文はどのメッセージにも出さない。
create function pg_temp.t0091_try_insert(
  p_case text,
  p_uid uuid,
  p_participant uuid,
  p_seq int,
  p_body text,
  p_expect_state text,
  p_expect_constraint text default null,
  p_keep boolean default false
) returns uuid
language plpgsql as $$
declare
  v_turn uuid;
  v_total_before int;
  v_total_after int;
  v_own_before int;
  v_own_after int;
  v_state text;
  v_constraint text;
  v_id uuid;
  v_stored_matches boolean;
begin
  select turn_id into v_turn from _t0091_ctx;
  select count(*) into v_total_before from public.answers;
  select count(*) into v_own_before from public.answers where turn_id = v_turn and participant_id = p_participant;

  -- ブラウザ版（supabase-jsのinsert、returning無し）と同じく、RETURNINGを付けずに送る
  -- （RETURNINGを付けるとSELECT側のRLSも評価され、INSERT側の判定と混ざるため）。
  perform set_config('myapp.uid', p_uid::text, true);
  set local role authenticated;
  begin
    insert into public.answers (turn_id, participant_id, seq, body)
      values (v_turn, p_participant, p_seq, p_body);
    v_state := '00000';
    v_constraint := null;
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
  end;
  reset role;
  perform set_config('myapp.uid', '', true);
  -- (turn_id, participant_id, seq)は一意なので、受理時の行はsuperuserでこれで特定できる。
  v_id := null;
  if v_state = '00000' then
    select a.id into v_id from public.answers a
      where a.turn_id = v_turn and a.participant_id = p_participant and a.seq = p_seq;
  end if;

  select count(*) into v_total_after from public.answers;
  select count(*) into v_own_after from public.answers where turn_id = v_turn and participant_id = p_participant;

  if v_state <> p_expect_state then
    raise exception 'FAIL[%]: SQLSTATEが期待と違う(期待=%, 実際=%, 制約=%)',
      p_case, p_expect_state, v_state, coalesce(nullif(v_constraint, ''), '-');
  end if;

  if p_expect_state = '00000' then
    if v_total_after <> v_total_before + 1 or v_own_after <> v_own_before + 1 then
      raise exception 'FAIL[%]: 受理なのに行数が+1になっていない(総件数 %→%, 本人 %→%)',
        p_case, v_total_before, v_total_after, v_own_before, v_own_after;
    end if;
    select a.body = p_body into v_stored_matches from public.answers a where a.id = v_id;
    if v_stored_matches is not true then
      raise exception 'FAIL[%]: 保存された本文が入力と一致しない（DB側で改変された疑い）', p_case;
    end if;
    if not p_keep then
      delete from public.answers where id = v_id;
      if (select count(*) from public.answers) <> v_total_before then
        raise exception 'FAIL[%]: 後片付け後の件数が元に戻らない', p_case;
      end if;
    end if;
    raise notice 'PASS[%]: 受理（SQLSTATE=00000、行数 %→%）', p_case, v_total_before, v_total_after;
  else
    if v_total_after <> v_total_before or v_own_after <> v_own_before then
      raise exception 'FAIL[%]: 拒否なのに行数が変化した(総件数 %→%, 本人 %→%)',
        p_case, v_total_before, v_total_after, v_own_before, v_own_after;
    end if;
    if p_expect_constraint is not null and v_constraint is distinct from p_expect_constraint then
      raise exception 'FAIL[%]: 拒否した制約名が期待と違う(期待=%, 実際=%)',
        p_case, p_expect_constraint, coalesce(nullif(v_constraint, ''), '-');
    end if;
    raise notice 'PASS[%]: 拒否（SQLSTATE=%、制約=%、総件数 %→%、本人 %→%）', p_case, v_state,
      coalesce(nullif(v_constraint, ''), '-'), v_total_before, v_total_after, v_own_before, v_own_after;
  end if;
  return v_id;
end $$;

-- 補助：指定ユーザー（authenticated）から指定回答が何件見えるか。
create function pg_temp.t0091_visible_count(p_uid uuid, p_answer_id uuid) returns int
language plpgsql as $$
declare
  v_n int;
begin
  perform set_config('myapp.uid', p_uid::text, true);
  set local role authenticated;
  select count(*) into v_n from public.answers where id = p_answer_id;
  reset role;
  perform set_config('myapp.uid', '', true);
  return v_n;
end $$;

-- ============================================================
-- テスト1：受理するケース（登壇組の正規player、seq=1、毎回削除して元に戻す）
-- ============================================================
do $$
declare
  v_c record;
  v_uid uuid;
  v_pid uuid;
  v_emoji50 text := repeat(chr(128512), 50);
begin
  perform pg_temp.t0091_reset_state();
  select * into v_c from _t0091_ctx;
  v_uid := v_c.active_uids[1];
  v_pid := v_c.active_pids[1];

  -- 前提確認：絵文字50個は50コードポイント（ブラウザ版のUTF-16単位では100）。
  if char_length(v_emoji50) <> 50 or octet_length(convert_to(v_emoji50, 'UTF8')) <> 200 then
    raise exception 'FAIL: 絵文字50コードポイントの前提が崩れている';
  end if;

  perform pg_temp.t0091_try_insert('受理:1文字', v_uid, v_pid, 1, 'a', '00000');
  perform pg_temp.t0091_try_insert('受理:ASCII50文字', v_uid, v_pid, 1, repeat('a', 50), '00000');
  perform pg_temp.t0091_try_insert('受理:先頭末尾に空白・可視文字あり', v_uid, v_pid, 1,
    chr(32) || chr(12288) || '回答' || chr(160) || chr(9), '00000');
  perform pg_temp.t0091_try_insert('受理:内部に改行', v_uid, v_pid, 1, '一行目' || chr(10) || '二行目', '00000');
  perform pg_temp.t0091_try_insert('受理:絵文字50コードポイント', v_uid, v_pid, 1, v_emoji50, '00000');
  perform pg_temp.t0091_try_insert('受理:通常の日本語回答(trim済み)', v_uid, v_pid, 1,
    btrim('  布団が吹っ飛んだと思ったら、吹っ飛んだのは自分でした  '), '00000');
  -- 境界：日本語ちょうど50コードポイントも受理。
  perform pg_temp.t0091_try_insert('受理:日本語50コードポイント', v_uid, v_pid, 1, repeat('あ', 50), '00000');
end $$;

-- ============================================================
-- テスト2：SQLSTATE 23514（answers_body_shape_check）で拒否するケース
-- ============================================================
do $$
declare
  v_c record;
  v_uid uuid;
  v_pid uuid;
  v_ws_all text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32)
                   || chr(160) || chr(12288) || chr(65279);
begin
  perform pg_temp.t0091_reset_state();
  select * into v_c from _t0091_ctx;
  v_uid := v_c.active_uids[1];
  v_pid := v_c.active_pids[1];

  perform pg_temp.t0091_try_insert('拒否:空文字', v_uid, v_pid, 1, '', '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:ASCII空白だけ', v_uid, v_pid, 1, repeat(chr(32), 3), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:tabだけ', v_uid, v_pid, 1, chr(9), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:LFだけ', v_uid, v_pid, 1, chr(10), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:CRだけ', v_uid, v_pid, 1, chr(13), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:vertical tabだけ', v_uid, v_pid, 1, chr(11), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:form feedだけ', v_uid, v_pid, 1, chr(12), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:NBSPだけ', v_uid, v_pid, 1, chr(160), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:全角空白だけ', v_uid, v_pid, 1, chr(12288), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:BOMだけ', v_uid, v_pid, 1, chr(65279), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:空白文字の混合だけ', v_uid, v_pid, 1, v_ws_all || v_ws_all, '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:ASCII51文字', v_uid, v_pid, 1, repeat('a', 51), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:日本語51コードポイント', v_uid, v_pid, 1, repeat('あ', 51), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('拒否:絵文字51コードポイント', v_uid, v_pid, 1, repeat(chr(128512), 51), '23514', 'answers_body_shape_check');
  -- 可視文字＋前後空白でも、合計が51コードポイントなら長さで拒否（trimは行わない）。
  perform pg_temp.t0091_try_insert('拒否:可視50文字+末尾空白1(計51)', v_uid, v_pid, 1, repeat('a', 50) || chr(32), '23514', 'answers_body_shape_check');
end $$;

-- ============================================================
-- テスト3：既存RLS（answers_insert_own_as_player）の回帰確認。
--          いずれも制約に適合する本文で、RLSにより42501で拒否されること。
-- ============================================================
do $$
declare
  v_c record;
  v_uid uuid;
  v_pid uuid;
  v_ok_body constant text := '適合する回答';
  v_first uuid;
  v_i int;
begin
  perform pg_temp.t0091_reset_state();
  select * into v_c from _t0091_ctx;
  v_uid := v_c.active_uids[1];
  v_pid := v_c.active_pids[1];

  -- 観客・ゲスト・別の組のplayer（いずれも自分自身のparticipant_id）。
  perform pg_temp.t0091_try_insert('RLS:観客', 'e0910000-0000-0000-0000-00000000000a', v_c.audience_pid, 1, v_ok_body, '42501');
  perform pg_temp.t0091_try_insert('RLS:ゲスト', 'e0910000-0000-0000-0000-00000000000b', v_c.guest_pid, 1, v_ok_body, '42501');
  perform pg_temp.t0091_try_insert('RLS:別の組のplayer', v_c.other_uids[1], v_c.other_pids[1], 1, v_ok_body, '42501');

  -- paused中。
  update public.lives set answering_paused = true where id = v_c.live_id;
  perform pg_temp.t0091_try_insert('RLS:paused中', v_uid, v_pid, 1, v_ok_body, '42501');
  perform pg_temp.t0091_reset_state();

  -- 締切+500msの境界（now()はトランザクション内で一定）。
  update public.lives set phase_deadline = now() - interval '501 milliseconds' where id = v_c.live_id;
  perform pg_temp.t0091_try_insert('RLS:締切+501ms', v_uid, v_pid, 1, v_ok_body, '42501');
  update public.lives set phase_deadline = now() - interval '500 milliseconds' where id = v_c.live_id;
  perform pg_temp.t0091_try_insert('RLS境界:締切+500msちょうどは受理', v_uid, v_pid, 1, v_ok_body, '00000');
  perform pg_temp.t0091_reset_state();

  -- reveal_sequence_untilより前。
  update public.lives set reveal_sequence_until = now() + interval '1 millisecond' where id = v_c.live_id;
  perform pg_temp.t0091_try_insert('RLS:reveal_sequence_until前', v_uid, v_pid, 1, v_ok_body, '42501');
  update public.lives set reveal_sequence_until = now() where id = v_c.live_id;
  perform pg_temp.t0091_try_insert('RLS境界:reveal_sequence_untilちょうどは受理', v_uid, v_pid, 1, v_ok_body, '00000');
  perform pg_temp.t0091_reset_state();

  -- 退場済みplayer。
  update public.participants set kicked_at = now() where id = v_pid;
  perform pg_temp.t0091_try_insert('RLS:退場済みplayer', v_uid, v_pid, 1, v_ok_body, '42501');
  perform pg_temp.t0091_reset_state();

  -- 同じturn・participant・seqの再送：1件目を確定(resolved)させた後に同じseqで再送すると、
  -- RLSは通り（件数1<5、seq範囲内）、一意制約(turn_id, participant_id, seq)で23505。
  v_first := pg_temp.t0091_try_insert('再送:1件目(seq=1)', v_uid, v_pid, 1, v_ok_body, '00000', null, true);
  update public.answers set resolved = true where id = v_first;
  perform pg_temp.t0091_try_insert('再送:同じseq=1', v_uid, v_pid, 1, v_ok_body, '23505', 'answers_turn_id_participant_id_seq_key');
  if (select count(*) from public.answers where turn_id = v_c.turn_id and participant_id = v_pid and seq = 1) <> 1 then
    raise exception 'FAIL: 同じseqの再送後、turn×participant×seqの行数が1件でない';
  end if;
  raise notice 'PASS: 同じturn・participant・seqの再送は23505で、行数は1件のまま';

  -- 6件目：seq 2〜5を順に送って確定させ、本人5件にした後の6件目はRLSで拒否。
  for v_i in 2..5 loop
    v_first := pg_temp.t0091_try_insert('上限:' || v_i || '件目', v_uid, v_pid, v_i, v_ok_body, '00000', null, true);
    update public.answers set resolved = true where id = v_first;
  end loop;
  perform pg_temp.t0091_try_insert('RLS:6件目(seq=6)', v_uid, v_pid, 6, v_ok_body, '42501');
  -- seq範囲チェックに頼らず件数上限(answer_count_for_turn<5)だけでも拒否されること
  -- （RLSは一意制約より先に評価されるため、23505ではなく42501になる）。
  perform pg_temp.t0091_try_insert('RLS:6件目(seq=3の重複番号)', v_uid, v_pid, 3, v_ok_body, '42501');
  if (select count(*) from public.answers where turn_id = v_c.turn_id and participant_id = v_pid) <> 5 then
    raise exception 'FAIL: 6件目の拒否後、本人の回答が5件でない';
  end if;
  raise notice 'PASS: 本人5件の後の6件目は拒否され、行数は5件のまま';

  delete from public.answers where turn_id = v_c.turn_id;
end $$;

-- ============================================================
-- テスト4：未公開回答の可視範囲（本人には見え、他人には見えない）
-- ============================================================
do $$
declare
  v_c record;
  v_answer uuid;
begin
  perform pg_temp.t0091_reset_state();
  select * into v_c from _t0091_ctx;
  v_answer := pg_temp.t0091_try_insert('可視性:未公開回答を投稿', v_c.active_uids[1], v_c.active_pids[1], 1, '未公開の回答', '00000', null, true);
  if (select revealed_at from public.answers where id = v_answer) is not null then
    raise exception 'FAIL: 前提崩れ（投稿直後の回答がrevealed_at付き）';
  end if;

  if pg_temp.t0091_visible_count(v_c.active_uids[1], v_answer) <> 1 then
    raise exception 'FAIL: 本人が自分の未公開回答を取得できない';
  end if;
  raise notice 'PASS: 本人の未公開回答は本人に見える';

  if pg_temp.t0091_visible_count(v_c.active_uids[2], v_answer) <> 0
     or pg_temp.t0091_visible_count(v_c.other_uids[1], v_answer) <> 0
     or pg_temp.t0091_visible_count('e0910000-0000-0000-0000-00000000000a', v_answer) <> 0
     or pg_temp.t0091_visible_count('e0910000-0000-0000-0000-00000000000b', v_answer) <> 0 then
    raise exception 'FAIL: 他人（同じ組・別の組・観客・ゲスト）の取得結果に未公開回答が含まれる';
  end if;
  raise notice 'PASS: 他人（同じ組のplayer・別の組のplayer・観客・ゲスト）の取得結果に未公開回答は含まれない';

  delete from public.answers where id = v_answer;
end $$;

-- ============================================================
-- テスト5：カタログ上の制約状態（通常状態＝0092のVALIDATE適用済み）
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
  select c.conrelid, c.contype, c.convalidated, c.condeferrable, c.connoinherit,
         pg_get_constraintdef(c.oid) as def
    into v_con
    from pg_constraint c where c.conname = 'answers_body_shape_check';
  if v_con.conrelid <> 'public.answers'::regclass then
    raise exception 'FAIL: answers_body_shape_checkの対象がpublic.answersではない';
  end if;
  if v_con.contype <> 'c' then
    raise exception 'FAIL: answers_body_shape_checkがCHECK制約ではない(contype=%)', v_con.contype;
  end if;
  if v_con.convalidated is not true then
    raise exception 'FAIL: 通常状態（0092適用済み）のanswers_body_shape_checkがVALIDATE済みではない(convalidated=%)', v_con.convalidated;
  end if;
  if v_con.def <> v_expected_def then
    raise exception 'FAIL: answers_body_shape_checkの定義が期待と違う（通常状態ではNOT VALIDが付かないはず）';
  end if;
  raise notice 'PASS: answers_body_shape_checkはpublic.answersのCHECK制約1件、convalidated=true、定義は期待どおり（NOT VALIDなし）';

  -- answersのCHECK制約はこの1件だけ（他に紛れ込んでいない）。
  select count(*) into v_n from pg_constraint where conrelid = 'public.answers'::regclass and contype = 'c';
  if v_n <> 1 then
    raise exception 'FAIL: public.answersのCHECK制約が1件ではない(件数=%)', v_n;
  end if;

  -- 既存のNOT NULL・unique制約・部分unique indexが残っている。
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
  raise notice 'PASS: body NOT NULL・一意制約(turn_id, participant_id, seq)・部分unique index(answers_one_unresolved_per_turn)は維持されている';
end $$;

-- ============================================================
-- テスト6：NOT VALIDの検証（このトランザクション内だけで制約を外して旧状態を再現し、
--          マイグレーション本体を\irで再適用する。最後にrollbackで全て元に戻る）
-- ============================================================

-- 補助：0091が変更してはならないカタログ（RLS policy・ACL・trigger・関数定義・
-- answers_body_shape_check以外の制約・index・NOT NULL・RLS有効化フラグ）の要約。
create function pg_temp.t0091_catalog_snapshot() returns text
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

create temporary table _t0091_notvalid (k text primary key, v text);

do $$
declare
  v_c record;
begin
  select * into v_c from _t0091_ctx;
  insert into _t0091_notvalid values ('snapshot_with_0091', pg_temp.t0091_catalog_snapshot());
  -- 通常状態（0092適用済み）の定義。0091の再適用後は、これに" NOT VALID"が付いた形になるはず。
  insert into _t0091_notvalid
    select 'def_validated', pg_get_constraintdef(oid) from pg_constraint
    where conname = 'answers_body_shape_check' and convalidated;
  if not exists (select 1 from _t0091_notvalid where k = 'def_validated') then
    raise exception 'FAIL: テスト6の前提（通常状態でconvalidated=true）が崩れている';
  end if;

  -- 0091適用前の状態を再現する。
  alter table public.answers drop constraint answers_body_shape_check;
  insert into _t0091_notvalid values ('snapshot_before', pg_temp.t0091_catalog_snapshot());

  -- 0091適用前から存在した不適合な旧行（運営操作の代理、superuser実行）。
  -- answers_one_unresolved_per_turnに掛からないよう確定済み(resolved=true)にする。
  insert into public.answers (turn_id, participant_id, seq, body, resolved) values
    (v_c.turn_id, v_c.active_pids[2], 1, '', true),
    (v_c.turn_id, v_c.active_pids[2], 2, chr(12288) || chr(160), true),
    (v_c.turn_id, v_c.active_pids[2], 3, repeat('a', 51), true);
  insert into _t0091_notvalid
    select 'legacy_ids', string_agg(id::text, ',' order by seq)
    from public.answers where participant_id = v_c.active_pids[2];
  if (select count(*) from public.answers where participant_id = v_c.active_pids[2]) <> 3 then
    raise exception 'FAIL: 不適合な旧行(3件)を用意できない';
  end if;
end $$;

-- マイグレーション本体をそのまま適用する（不適合な旧行があってもNOT VALIDなので成功するはず。
-- 失敗すればON_ERROR_STOPでこのテストが止まる）。
\ir ../migrations/0091_answer_body_shape_check.sql

do $$
declare
  v_c record;
  v_legacy_ids uuid[];
  v_state text;
  v_constraint text;
  v_before int;
begin
  select * into v_c from _t0091_ctx;
  select string_to_array(v, ',')::uuid[] into v_legacy_ids from _t0091_notvalid where k = 'legacy_ids';

  -- ADD CONSTRAINT ... NOT VALID自体が成功し、旧行は走査・変更されていない。
  if (select convalidated from pg_constraint where conname = 'answers_body_shape_check') is not false then
    raise exception 'FAIL: 再適用後のanswers_body_shape_checkがNOT VALIDでない';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'answers_body_shape_check')
     is distinct from (select v from _t0091_notvalid where k = 'def_validated') || ' NOT VALID' then
    raise exception 'FAIL: 再適用後の定義が「通常状態の定義＋NOT VALID」になっていない';
  end if;
  raise notice 'PASS: 0091を単独で再適用するとconvalidated=false、定義は通常状態と同じ式にNOT VALIDが付いた形';
  if (select count(*) from public.answers where id = any(v_legacy_ids)) <> 3
     or not exists (select 1 from public.answers where id = v_legacy_ids[1] and body = '')
     or not exists (select 1 from public.answers where id = v_legacy_ids[2] and body = chr(12288) || chr(160))
     or not exists (select 1 from public.answers where id = v_legacy_ids[3] and body = repeat('a', 51)) then
    raise exception 'FAIL: 0091の適用で不適合な旧行が削除・変更された';
  end if;
  raise notice 'PASS: 不適合な旧行(3件)があっても0091のADD CONSTRAINT ... NOT VALIDは成功し、旧行は3件とも不変';

  -- 0091は制約1件の追加以外、RLS policy・ACL・trigger・関数定義・他の制約・index・NOT NULLを変えない。
  if pg_temp.t0091_catalog_snapshot() <> (select v from _t0091_notvalid where k = 'snapshot_before') then
    raise exception 'FAIL: 0091の適用でRLS policy・ACL・trigger・関数定義・既存制約・indexのいずれかが変化した';
  end if;
  if pg_temp.t0091_catalog_snapshot() <> (select v from _t0091_notvalid where k = 'snapshot_with_0091') then
    raise exception 'FAIL: 再適用後のカタログが通常フローの0091適用後と一致しない';
  end if;
  raise notice 'PASS: 0091の適用前後で、RLS policy・ACL・trigger・関数定義・既存の制約/index/NOT NULLは一切変化しない';

  -- 追加後の新規不適合行は拒否・新規適合行は受理（superuserでも、RLSを通るplayerでも）。
  select count(*) into v_before from public.answers;
  begin
    insert into public.answers (turn_id, participant_id, seq, body, resolved)
      values (v_c.turn_id, v_c.active_pids[2], 4, chr(65279), true);
    v_state := '00000';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
  end;
  if v_state <> '23514' or v_constraint is distinct from 'answers_body_shape_check'
     or (select count(*) from public.answers) <> v_before then
    raise exception 'FAIL: NOT VALID追加後の新規不適合行(superuser)が拒否されない(SQLSTATE=%)', v_state;
  end if;
  raise notice 'PASS: NOT VALID追加後、新規不適合行はsuperuserのINSERTでも23514で拒否され、行数不変';

  perform pg_temp.t0091_reset_state();
  perform pg_temp.t0091_try_insert('NOT VALID後:新規不適合行(player)', v_c.active_uids[1], v_c.active_pids[1], 1, repeat('a', 51), '23514', 'answers_body_shape_check');
  perform pg_temp.t0091_try_insert('NOT VALID後:新規適合行(player)', v_c.active_uids[1], v_c.active_pids[1], 1, '適合する回答', '00000');

  -- UPDATEにも即時適用される：適合行の本文を不適合に変えるUPDATEは拒否。
  insert into public.answers (turn_id, participant_id, seq, body, resolved)
    values (v_c.turn_id, v_c.active_pids[2], 4, '適合する旧行', true);
  begin
    update public.answers set body = repeat(chr(32), 2)
      where turn_id = v_c.turn_id and participant_id = v_c.active_pids[2] and seq = 4;
    v_state := '00000';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
  end;
  if v_state <> '23514' or v_constraint is distinct from 'answers_body_shape_check'
     or not exists (select 1 from public.answers where turn_id = v_c.turn_id and participant_id = v_c.active_pids[2] and seq = 4 and body = '適合する旧行') then
    raise exception 'FAIL: NOT VALID追加後、本文を不適合にするUPDATEが拒否されない(SQLSTATE=%)', v_state;
  end if;
  raise notice 'PASS: NOT VALID追加後、本文を不適合にするUPDATEは23514で拒否され、本文は不変';

  -- 既知の挙動（残存リスクの記録）：PostgreSQLはUPDATE後の行全体を再検査するため、
  -- 不適合な旧行は本文以外の列（score_total等）のUPDATEでも拒否される。
  begin
    update public.answers set score_total = score_total + 1 where id = v_legacy_ids[1];
    v_state := '00000';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
  end;
  if v_state <> '23514' or v_constraint is distinct from 'answers_body_shape_check' then
    raise exception 'FAIL: 不適合な旧行の他列UPDATEの挙動が想定(23514)と違う(SQLSTATE=%)', v_state;
  end if;
  raise notice 'PASS(既知の挙動): 不適合な旧行は、本文以外の列のUPDATEでも23514で拒否される（適用フェーズで旧行の適合件数確認が必要）';
end $$;

-- 再実行前提にしない：同名制約がある状態で0091をもう一度流すと、黙って成功せず
-- 42710(duplicate_object)で失敗する。直後のERROR出力1行はこの確認のための想定どおりの出力。
savepoint t0091_rerun;
\set ON_ERROR_STOP off
\echo '（想定どおりのERROR：0091の二重適用は同名制約により失敗する）'
\ir ../migrations/0091_answer_body_shape_check.sql
\set ON_ERROR_STOP on
rollback to savepoint t0091_rerun;
select set_config('t0091.rerun_sqlstate', :'LAST_ERROR_SQLSTATE', true) \gset t0091_ignored_
do $$
begin
  if current_setting('t0091.rerun_sqlstate') <> '42710' then
    raise exception 'FAIL: 0091の二重適用が42710で失敗しなかった(SQLSTATE=%)', current_setting('t0091.rerun_sqlstate');
  end if;
  if (select count(*) from pg_constraint where conname = 'answers_body_shape_check') <> 1 then
    raise exception 'FAIL: 0091の二重適用後、answers_body_shape_checkが1件でない';
  end if;
  raise notice 'PASS: 0091の二重適用は42710(duplicate_object)で失敗し、黙って成功しない（制約は1件のまま）';
end $$;

rollback;

-- ============================================================
-- テスト7：rollback後、試験データが残っておらず、制約は通常フロー（0092適用済み）の状態に戻っている
-- ============================================================
do $$
begin
  if exists (select 1 from auth.users where id::text like 'e0910000-%')
     or exists (select 1 from public.topic_bank where id::text like 'e0912000-%')
     or exists (select 1 from public.lives where title = '0091回答本文制約テスト') then
    raise exception 'FAIL: 0091テストの試験データが残っている';
  end if;
  if (select count(*) from pg_constraint where conname = 'answers_body_shape_check') <> 1
     or (select count(*) from pg_constraint where conname = 'answers_body_shape_check' and convalidated = true) <> 1 then
    raise exception 'FAIL: rollback後、answers_body_shape_check(convalidated=true)が1件だけになっていない';
  end if;
  raise notice 'PASS: 試験データは残っておらず、answers_body_shape_checkは0092適用済みの状態(convalidated=true)で1件';
end $$;

select '0091 ALL TESTS PASSED' as result;
