-- 0084 回帰テスト：ライブを2周制にした挙動を検証する。
--  - 必要お題数は組数×2（不足・重複は拒否）
--  - begin_gameは2周分のターンを作る（同じ組・同じ順番、2周目は別のお題）
--  - 組結果後は周→組の順に次のターンへ進み、最後のターンの後だけfinal_resultへ進む
-- 実行方法はsupabase/tests/run.sh参照（全*.test.sqlが同一DBを共有するため、
-- 非closedのライブは先にclosedへ倒す）。

\set ON_ERROR_STOP on

-- 非closedライブは全体で高々1件（lives_one_active_idx）。既存の残存ライブはclosedへ倒す。
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

-- テスト1：必要お題数は組数×2。不足・重複は拒否される。
do $$
declare
  v_r record;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);

  select * into v_r from public.create_live_preparation(
    now(), '2周テスト(不足)', 20, 2,
    array['f0850000-0000-0000-0000-000000000001', 'f0850000-0000-0000-0000-000000000002', 'f0850000-0000-0000-0000-000000000003']::uuid[]
  );
  reset role;
  if v_r.ok is not false then raise exception 'FAIL: 2組に対しお題3件（必要4件）が受け付けられた'; end if;
  if v_r.reason not like '%4件必要%' then raise exception 'FAIL: お題不足の理由に「4件必要」が無い(got=%)', v_r.reason; end if;
  raise notice 'PASS: 2組のライブはお題4件が必要で、3件では作成が拒否され「4件必要」と表示される';

  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '2周テスト(重複)', 20, 2,
    array['f0850000-0000-0000-0000-000000000001', 'f0850000-0000-0000-0000-000000000001', 'f0850000-0000-0000-0000-000000000002', 'f0850000-0000-0000-0000-000000000003']::uuid[]
  );
  reset role;
  if v_r.ok is not false then raise exception 'FAIL: 同じお題の重複が受け付けられた'; end if;
  raise notice 'PASS: 同じお題を重複して選んだ場合は拒否される';
end $$;

-- テスト2〜：2組・お題4件で作成し、参加・組分け・開始し、2周分のターンを検証する。
do $$
declare
  v_live uuid;
  v_r record;
  v_turns int;
  v_distinct int;
  v_first_round int;
  v_seq text;
  v_t record;
  v_i int := 0;
  v_expected_next text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '2周テスト(本体)', 20, 2,
    array['f0850000-0000-0000-0000-000000000001', 'f0850000-0000-0000-0000-000000000002', 'f0850000-0000-0000-0000-000000000003', 'f0850000-0000-0000-0000-000000000004']::uuid[]
  );
  if v_r.ok is not true then raise exception 'FAIL: 2組・お題4件のライブ作成に失敗した(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;
  reset role;

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
  if v_turns <> 4 then raise exception 'FAIL: 2組×2周のターンが4件になっていない(got=%)', v_turns; end if;
  if v_distinct <> 4 then raise exception 'FAIL: 周をまたいでお題が重複している(distinct=%)', v_distinct; end if;
  raise notice 'PASS: 2組×2周で4ターンが作られ、4つのお題がすべて別々に割り当てられる';

  -- 1周目→2周目の順序：round=1の2組が先、その後round=2の2組（同じ組の順番）。
  v_seq := '';
  for v_t in
    select t.round, g.group_order from public.turns t join public.groups g on g.id = t.group_id
    where t.live_id = v_live order by t.round, g.group_order
  loop
    v_seq := v_seq || v_t.round || '-' || v_t.group_order || ' ';
  end loop;
  if v_seq <> '1-1 1-2 2-1 2-2 ' then raise exception 'FAIL: ターンの周・組の順序が想定と違う(got=%)', v_seq; end if;
  raise notice 'PASS: ターンは1周目(組1→組2)の後に2周目(組1→組2)の順で並ぶ';

  -- 組結果→次のターン：最後のターン以外はtopic_revealへ、最後の組結果後だけfinal_resultへ進む。
  set local role authenticated;
  perform set_config('myapp.uid', 'f0850000-0000-0000-0000-00000000a001', true);
  for v_t in
    select t.id, t.round, g.group_order from public.turns t join public.groups g on g.id = t.group_id
    where t.live_id = v_live order by t.round, g.group_order
  loop
    v_i := v_i + 1;
    update public.lives
      set current_phase = 'group_result', current_turn_id = v_t.id, phase_deadline = now() - interval '1 second'
      where id = v_live;
    update public.turns set status = 'done' where id = v_t.id;
    select advanced_to into v_expected_next
      from public.host_advance_group_result_to_next(v_live, v_t.id, 0);
    if v_i < 4 then
      if v_expected_next <> 'topic_reveal' then
        raise exception 'FAIL: % 番目のターン(周%・組%)の後にtopic_revealへ進まなかった(got=%)', v_i, v_t.round, v_t.group_order, v_expected_next;
      end if;
    else
      if v_expected_next <> 'final_result' then
        raise exception 'FAIL: 2周目最後の組の後にfinal_resultへ進まなかった(got=%)', v_expected_next;
      end if;
    end if;
  end loop;
  reset role;
  raise notice 'PASS: 1周目の最終組の後は2周目の第1組へ進み、2周目の最終組の後だけfinal_resultへ進む';
end $$;
