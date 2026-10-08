-- 0084/0085 回帰テスト：ライブ作成時の「1周目分のお題」要件を検証する。
--  - 必要お題数は組数×1（0085でライブ開始時点の必要数を組数×1へ変更した。
--    2周目以降のお題は運営者がhost_add_next_round（0085_dynamic_rounds.test.sql）
--    でその都度指定する）。不足・重複は拒否される。過剰（1周分を超える数）は、
--    歴史的に組数×2（旧2周固定）のお題を渡す既存の呼び出し元を壊さないため、
--    0085で「不足のみ拒否・超過分は先頭から必要数だけ使用」という、begin_gameの
--    不足チェックと同じ方針に変更した（0084_create_live_entrypoints.test.sqlで検証）。
--  - begin_gameは1周目分のターンだけを作る（同じ組・同じ順番）。
-- 動的な周回追加・組結果後の進行（awaiting_round_decision等）の検証は
-- 0085_dynamic_rounds.test.sqlで行う。
-- 実行方法はsupabase/tests/run.sh参照（全*.test.sqlが同一DBを共有するため、
-- 非closedのライブは先にclosedへ倒す）。

\set ON_ERROR_STOP on

update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0850000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- host
  ('f0850000-0000-0000-0000-00000000a011', false, '{"provider":"x"}'::jsonb),
  ('f0850000-0000-0000-0000-00000000a012', false, '{"provider":"x"}'::jsonb),
  ('f0850000-0000-0000-0000-00000000a013', false, '{"provider":"x"}'::jsonb),
  ('f0850000-0000-0000-0000-00000000a014', false, '{"provider":"x"}'::jsonb)
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0850000-0000-0000-0000-00000000a001';

insert into public.topic_bank (id, body, format, is_active) values
  ('f0850000-0000-0000-0000-000000000001', '2周テスト用お題1', 'text', true),
  ('f0850000-0000-0000-0000-000000000002', '2周テスト用お題2', 'text', true),
  ('f0850000-0000-0000-0000-000000000003', '2周テスト用お題3', 'text', true),
  ('f0850000-0000-0000-0000-000000000004', '2周テスト用お題4', 'text', true)
on conflict do nothing;

-- テスト1：必要お題数は組数×1。不足は拒否される。過剰（1周分を超える数）は、
-- 歴史的に組数×2を渡す既存の呼び出し元を壊さないため拒否しない（先頭の必要数だけ使う）。
do $$
declare
  v_r record;
  v_live uuid;
  v_topic_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);

  select * into v_r from public.create_live_preparation(
    now(), '1周テスト(不足)', 20, 2,
    array['f0850000-0000-0000-0000-000000000001']::uuid[]
  );
  reset role;
  if v_r.ok is not false then raise exception 'FAIL: 2組に対しお題1件（必要2件）が受け付けられた'; end if;
  if v_r.reason not like '%2件必要%' then raise exception 'FAIL: お題不足の理由に「2件必要」が無い(got=%)', v_r.reason; end if;
  raise notice 'PASS: 2組のライブは1周目分のお題2件が必要で、1件では作成が拒否され「2件必要」と表示される';

  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '1周テスト(過剰)', 20, 2,
    array['f0850000-0000-0000-0000-000000000001', 'f0850000-0000-0000-0000-000000000002', 'f0850000-0000-0000-0000-000000000003']::uuid[]
  );
  reset role;
  if v_r.ok is not true then raise exception 'FAIL: 1周分を超えるお題3件を渡した作成が失敗した(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;
  select count(*) into v_topic_count from public.topics where live_id = v_live;
  if v_topic_count <> 2 then raise exception 'FAIL: 過剰分を無視せず%件のtopicsが作られた（想定2件）', v_topic_count; end if;
  update public.lives set current_phase = 'closed' where id = v_live;
  raise notice 'PASS: 1周分(2件)を超えるお題を渡しても作成は拒否されず、先頭2件だけが使われる（2周目以降は運営者がhost_add_next_roundで指定する）';

  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '1周テスト(重複)', 20, 2,
    array['f0850000-0000-0000-0000-000000000001', 'f0850000-0000-0000-0000-000000000001']::uuid[]
  );
  reset role;
  if v_r.ok is not false then raise exception 'FAIL: 同じお題の重複が受け付けられた'; end if;
  raise notice 'PASS: 同じお題を重複して選んだ場合は拒否される';
end $$;

-- テスト2：2組・お題2件（1周分）で作成し、参加・組分け・開始し、1周目分のターンを検証する。
do $$
declare
  v_live uuid;
  v_r record;
  v_turns int;
  v_distinct int;
  v_seq text;
  v_t record;
  v_saved_rounds int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '1周テスト(本体)', 20, 2,
    array['f0850000-0000-0000-0000-000000000001', 'f0850000-0000-0000-0000-000000000002']::uuid[]
  );
  if v_r.ok is not true then raise exception 'FAIL: 2組・お題2件のライブ作成に失敗した(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;
  reset role;

  select rounds_per_live into v_saved_rounds from public.lives where id = v_live;
  if v_saved_rounds <> 1 then raise exception 'FAIL: 新規作成のrounds_per_liveが1になっていない(got=%)', v_saved_rounds; end if;
  raise notice 'PASS: 新規作成したライブはrounds_per_live=1（1周目分だけ）を保存する';

  update public.lives set current_phase = 'opening' where id = v_live;
  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a011', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a012', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a013', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a014', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);
  perform public.randomize_groups(v_live);
  perform public.begin_game(v_live);
  reset role;

  select count(*), count(distinct topic_id) into v_turns, v_distinct
    from public.turns where live_id = v_live;
  if v_turns <> 2 then raise exception 'FAIL: 2組×1周のターンが2件になっていない(got=%)', v_turns; end if;
  if v_distinct <> 2 then raise exception 'FAIL: 組ごとにお題が重複している(distinct=%)', v_distinct; end if;
  raise notice 'PASS: 2組×1周で2ターンが作られ、2つのお題がそれぞれ別々に割り当てられる';

  v_seq := '';
  for v_t in
    select t.round, g.group_order from public.turns t join public.groups g on g.id = t.group_id
    where t.live_id = v_live order by t.round, g.group_order
  loop
    v_seq := v_seq || v_t.round || '-' || v_t.group_order || ' ';
  end loop;
  if v_seq <> '1-1 1-2 ' then raise exception 'FAIL: ターンの周・組の順序が想定と違う(got=%)', v_seq; end if;
  raise notice 'PASS: ターンは1周目(組1→組2)のみが作られる（2周目以降はまだ存在しない）';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;
