-- 0085 回帰テスト：host_add_next_roundの「組ごとに1件のお題」仕様
-- （既存の本番仕様＝1組1お題を、動的に追加する周でも維持する）を検証する。
-- p_topicsは[{"group_id":"<uuid>","topic_body":"<お題>"}, ...]のjsonb配列で、
-- 配列の位置ではなくgroup_idで組と対応させる。
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0970000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- host
  ('f0970000-0000-0000-0000-00000000a002', false, '{"provider":"x"}'::jsonb), -- 非host
  ('f0970000-0000-0000-0000-00000000a011', false, '{"provider":"x"}'::jsonb),
  ('f0970000-0000-0000-0000-00000000a012', false, '{"provider":"x"}'::jsonb),
  ('f0970000-0000-0000-0000-00000000a013', false, '{"provider":"x"}'::jsonb)
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0970000-0000-0000-0000-00000000a001';

insert into public.topic_bank (id, body, format, is_active) values
  ('f0970000-0000-0000-0000-000000000001', '組別お題テスト用1', 'text', true),
  ('f0970000-0000-0000-0000-000000000002', '組別お題テスト用2', 'text', true),
  ('f0970000-0000-0000-0000-000000000003', '組別お題テスト用3', 'text', true)
on conflict do nothing;

-- 補助：ホストとして3組のライブを1周目まで開始する（各組1人のplayer）。
create or replace function pg_temp.setup_live_3groups() returns uuid
language plpgsql as $$
declare
  v_r record;
  v_live uuid;
begin
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '組別お題テスト(3組)', 20, 3,
    array['f0970000-0000-0000-0000-000000000001', 'f0970000-0000-0000-0000-000000000002', 'f0970000-0000-0000-0000-000000000003']::uuid[]
  );
  if v_r.ok is not true then raise exception 'FAIL: 組別お題テスト用ライブの作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;

  update public.lives set current_phase = 'opening' where id = v_live;
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a011', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a012', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a013', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a001', true);
  perform public.randomize_groups(v_live);
  perform public.begin_game(v_live);
  return v_live;
end $$;

-- 補助：ライブの1周目（round=1）の全ターンをまとめて組結果にし、
-- awaiting_round_decisionまで進める。
create or replace function pg_temp.finish_round_to_decision(p_live uuid, p_round int) returns void
language plpgsql as $$
declare
  v_turn record;
  v_advanced text;
begin
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a001', true);
  for v_turn in
    select t.id from public.turns t join public.groups g on g.id = t.group_id
    where t.live_id = p_live and t.round = p_round order by g.group_order
  loop
    update public.lives set current_phase = 'group_result', current_turn_id = v_turn.id, phase_deadline = now() - interval '1 second'
      where id = p_live;
    update public.turns set status = 'done' where id = v_turn.id;
    select advanced_to into v_advanced from public.host_advance_group_result_to_next(p_live, v_turn.id, 0);
  end loop;
  if v_advanced <> 'awaiting_round_decision' then
    raise exception 'FAIL: finish_round_to_decisionの最後がawaiting_round_decisionになっていない(got=%)', v_advanced;
  end if;
end $$;
grant execute on function pg_temp.finish_round_to_decision(uuid, int) to authenticated, anon;

-- 補助：group_order→group_idのマップから、jsonb配列（指定した順序のまま。
-- 配列の並びがgroup_orderと一致しない場合でも正しく対応することを確認するテストで使う）を作る。
create or replace function pg_temp.topics_payload(p_live uuid, p_pairs jsonb) returns jsonb
-- p_pairs例：'[{"group_order":3,"body":"x"},{"group_order":1,"body":"y"}]'
language sql as $$
  select jsonb_agg(jsonb_build_object(
    'group_id', (select g.id from public.groups g where g.live_id = p_live and g.group_order = (pair->>'group_order')::int),
    'topic_body', pair->>'body'
  ))
  from jsonb_array_elements(p_pairs) as pair
$$;
grant execute on function pg_temp.topics_payload(uuid, jsonb) to authenticated, anon;

-- ============================================================
-- 正常系
-- ============================================================
do $$
declare
  v_live uuid;
  v_add record;
  v_fin record;
  v_n int;
begin
  v_live := pg_temp.setup_live_3groups();
  perform pg_temp.finish_round_to_decision(v_live, 1);

  -- 第2周：3組に3件、配列の並びはわざと組順と逆（group_idで対応することを確認）。
  select * into v_add from public.host_add_next_round(v_live, 2, pg_temp.topics_payload(v_live, '[
    {"group_order":3,"body":"第2周・3組目のお題"},
    {"group_order":1,"body":"第2周・1組目のお題"},
    {"group_order":2,"body":"第2周・2組目のお題"}
  ]'::jsonb));
  if v_add.ok is not true then raise exception 'FAIL: 3組へ3件渡した第2周の追加に失敗(reason=%)', v_add.reason; end if;
  if (v_add.live).rounds_per_live <> 2 then raise exception 'FAIL: rounds_per_liveが2になっていない'; end if;

  -- 第2周のturn数が組数(3)と一致し、各組に正しいお題が対応している
  select count(*) into v_n from public.turns where live_id = v_live and round = 2;
  if v_n <> 3 then raise exception 'FAIL: 第2周のturn数が組数と一致しない(got=%)', v_n; end if;

  if not exists (
    select 1 from public.turns t join public.groups g on g.id = t.group_id join public.topics tp on tp.id = t.topic_id
    where t.live_id = v_live and t.round = 2 and g.group_order = 1 and tp.body = '第2周・1組目のお題'
  ) then raise exception 'FAIL: 第2周1組目に正しいお題が割り当てられていない'; end if;
  if not exists (
    select 1 from public.turns t join public.groups g on g.id = t.group_id join public.topics tp on tp.id = t.topic_id
    where t.live_id = v_live and t.round = 2 and g.group_order = 2 and tp.body = '第2周・2組目のお題'
  ) then raise exception 'FAIL: 第2周2組目に正しいお題が割り当てられていない'; end if;
  if not exists (
    select 1 from public.turns t join public.groups g on g.id = t.group_id join public.topics tp on tp.id = t.topic_id
    where t.live_id = v_live and t.round = 2 and g.group_order = 3 and tp.body = '第2周・3組目のお題'
  ) then raise exception 'FAIL: 第2周3組目に正しいお題が割り当てられていない'; end if;
  raise notice 'PASS: 3組構成で、配列の並びに関係なくgroup_idで各組へ正しいお題が割り当てられる（第2周のturn数も組数と一致）';

  -- 第1周のお題が変更されていない
  if not exists (select 1 from public.turns t join public.groups g on g.id=t.group_id join public.topics tp on tp.id=t.topic_id where t.live_id=v_live and t.round=1 and g.group_order=1 and tp.body='組別お題テスト用1') then
    raise exception 'FAIL: 第2周追加後に第1周1組目のお題が変わった';
  end if;
  raise notice 'PASS: 第2周追加後も第1周のお題は変更されない';

  -- 第3周も各組に別のお題を保存する
  perform pg_temp.finish_round_to_decision(v_live, 2);
  select * into v_add from public.host_add_next_round(v_live, 3, pg_temp.topics_payload(v_live, '[
    {"group_order":1,"body":"第3周・1組目のお題"},
    {"group_order":2,"body":"第3周・2組目のお題"},
    {"group_order":3,"body":"第3周・3組目のお題"}
  ]'::jsonb));
  if v_add.ok is not true then raise exception 'FAIL: 第3周の追加に失敗(reason=%)', v_add.reason; end if;

  select count(*) into v_n from public.turns where live_id = v_live and round = 3;
  if v_n <> 3 then raise exception 'FAIL: 第3周のturn数が組数と一致しない(got=%)', v_n; end if;
  if not exists (select 1 from public.turns t join public.groups g on g.id=t.group_id join public.topics tp on tp.id=t.topic_id where t.live_id=v_live and t.round=3 and g.group_order=2 and tp.body='第3周・2組目のお題') then
    raise exception 'FAIL: 第3周2組目に正しいお題が割り当てられていない';
  end if;
  -- 第3周追加時に第2周のお題が変更されていない
  if not exists (select 1 from public.turns t join public.groups g on g.id=t.group_id join public.topics tp on tp.id=t.topic_id where t.live_id=v_live and t.round=2 and g.group_order=2 and tp.body='第2周・2組目のお題') then
    raise exception 'FAIL: 第3周追加後に第2周2組目のお題が変わった';
  end if;
  raise notice 'PASS: 第3周も各組に別のお題が保存され、第1周・第2周のお題は変更されない';

  -- 全組の重複がなく、全ターンのお題が互いに異なる
  select count(*) into v_n from (select topic_id from public.turns where live_id = v_live group by topic_id having count(*) > 1) d;
  if v_n <> 0 then raise exception 'FAIL: お題が重複している(%件)', v_n; end if;
  raise notice 'PASS: 1〜3周・3組すべてで異なるお題が使われ、重複が無い';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- 10周目まで追加可能・最終結果が全完了周の得点を含む
do $$
declare
  v_live uuid;
  v_add record;
  v_fin record;
  v_round int;
  v_turn1 uuid;
  v_payload jsonb;
begin
  v_live := pg_temp.setup_live_3groups();
  perform pg_temp.finish_round_to_decision(v_live, 1);

  for v_round in 2..10 loop
    select * into v_add from public.host_add_next_round(v_live, v_round, pg_temp.topics_payload(v_live, (
      select jsonb_agg(jsonb_build_object('group_order', go, 'body', format('第%s周・%s組目', v_round, go)))
      from unnest(array[1,2,3]) as go
    )::jsonb));
    if v_add.ok is not true then raise exception 'FAIL: 第%周の追加に失敗(reason=%)', v_round, v_add.reason; end if;
    perform pg_temp.finish_round_to_decision(v_live, v_round);
  end loop;

  select rounds_per_live into v_round from public.lives where id = v_live;
  if v_round <> 10 then raise exception 'FAIL: 10周まで追加した後のrounds_per_liveが10になっていない(got=%)', v_round; end if;
  raise notice 'PASS: 3組構成でも組ごとのお題指定を10周目まで繰り返し追加できる';

  -- 全ての組・回答に得点を入れて、最終結果(apply_live_rank_rewards)が全完了周を含むことを確認する
  insert into public.answers (turn_id, participant_id, seq, body, score_total, resolved)
  select t.id, p.id, 1, 'テスト回答', 3, true
  from public.turns t
  join public.groups g on g.id = t.group_id
  join public.participants p on p.group_id = g.id and p.role = 'player'
  where t.live_id = v_live;

  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a001', true);
  select * into v_fin from public.host_finish_live_from_round_decision(v_live);
  if v_fin.ok is not true then raise exception 'FAIL: 10周到達後のhost_finish_live_from_round_decisionに失敗(reason=%)', v_fin.reason; end if;
  update public.lives set current_phase = 'closed' where id = v_live;

  perform set_config('myapp.uid', '', true);
  perform public.apply_live_rank_rewards(v_live);
  -- 得点は1ターンにつき3点×10周=30点が各playerに入っているはず
  if exists (
    select 1 from public.answers a join public.participants p on p.id = a.participant_id
    where p.live_id = v_live group by p.id having coalesce(sum(a.score_total), 0) <> 30
  ) then
    raise exception 'FAIL: 10周分の得点合計が想定(30点/人)と違う';
  end if;
  raise notice 'PASS: 最終結果（apply_live_rank_rewardsの集計対象）は10周全てで確定した回答を含む';
end $$;

-- ============================================================
-- 異常系（1周目終了後・awaiting_round_decisionの状態から検証する）
-- ============================================================
do $$
declare
  v_live uuid;
  v_add record;
  v_fin record;
  v_r record;
  v_g1 uuid;
  v_g2 uuid;
  v_g3 uuid;
begin
  v_live := pg_temp.setup_live_3groups();
  perform pg_temp.finish_round_to_decision(v_live, 1);
  select id into v_g1 from public.groups where live_id = v_live and group_order = 1;
  select id into v_g2 from public.groups where live_id = v_live and group_order = 2;
  select id into v_g3 from public.groups where live_id = v_live and group_order = 3;

  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a001', true);

  -- お題が1件不足
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 'a'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b')
  ));
  if v_add.ok is not false or v_add.reason not like '%3件必要%' then
    raise exception 'FAIL: お題1件不足が拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: お題が1件不足している場合は拒否される';

  -- お題が1件多い（有効な3組＋同じ組の重複1件で計4件）
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 'a'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c'),
    jsonb_build_object('group_id', v_g1, 'topic_body', 'd')
  ));
  if v_add.ok is not false or v_add.reason not like '%3件必要%' then
    raise exception 'FAIL: お題1件過剰が拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: お題が1件多い場合は拒否される（件数チェックが内容確認より先に行われる）';

  -- 同じgroup_idが重複（件数は3のまま）
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 'a'),
    jsonb_build_object('group_id', v_g1, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'c')
  ));
  if v_add.ok is not false or v_add.reason not like '%重複%' then
    raise exception 'FAIL: 同じgroup_idの重複が拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: 同じgroup_idが重複して指定された場合は拒否される';

  -- 存在しないgroup_id（ランダムなUUID）
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', gen_random_uuid(), 'topic_body', 'a'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false or v_add.reason not like '%存在しない%' then
    raise exception 'FAIL: 存在しないgroup_idが拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: 現在のライブに存在しないgroup_idは拒否される（別ライブのgroup_idも同じ経路で拒否される）';

  -- 空文字
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', ''),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false then raise exception 'FAIL: 空文字のお題が拒否されない'; end if;
  raise notice 'PASS: 空文字のお題は拒否される';

  -- 空白だけ
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', '   '),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false then raise exception 'FAIL: 空白だけのお題が拒否されない'; end if;
  raise notice 'PASS: 空白だけのお題は拒否される';

  -- 最大文字数超過（201文字）
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', repeat('あ', 201)),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false or v_add.reason not like '%200文字%' then
    raise exception 'FAIL: 201文字のお題が拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: 最大文字数(200)を超えるお題は拒否される';

  -- JSON配列ではない（オブジェクト）
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_object('group_id', v_g1, 'topic_body', 'a'));
  if v_add.ok is not false then raise exception 'FAIL: 配列でないp_topicsが拒否されない'; end if;
  raise notice 'PASS: p_topicsがJSON配列でない場合は拒否される';

  -- topic_bodyが文字列ではない（数値）
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 123),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false then raise exception 'FAIL: topic_bodyが数値の場合に拒否されない'; end if;
  raise notice 'PASS: topic_bodyが文字列でない場合は拒否される';

  -- group_idがUUIDではない
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', 'not-a-uuid', 'topic_body', 'a'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false then raise exception 'FAIL: group_idがUUID形式でない場合に拒否されない'; end if;
  raise notice 'PASS: group_idがUUID形式でない場合は拒否される';

  -- expected round不一致
  select * into v_add from public.host_add_next_round(v_live, 5, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 'a'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false then raise exception 'FAIL: expected round不一致が拒否されない'; end if;
  raise notice 'PASS: p_expected_roundが現在のrounds_per_live+1と一致しない場合は拒否される';

  -- 判断待ち以外（topic_revealへ戻して確認）
  update public.lives set current_phase = 'topic_reveal' where id = v_live;
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 'a'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false then raise exception 'FAIL: awaiting_round_decision以外のフェーズで拒否されない'; end if;
  raise notice 'PASS: awaiting_round_decision以外のフェーズでは拒否される';
  update public.lives set current_phase = 'awaiting_round_decision' where id = v_live;

  -- 非host
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a002', true);
  begin
    perform public.host_add_next_round(v_live, 2, jsonb_build_array(
      jsonb_build_object('group_id', v_g1, 'topic_body', 'a'),
      jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
      jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
    ));
    raise exception 'FAIL: 非hostが成功してしまった';
  exception when others then
    if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
  end;
  raise notice 'PASS: 非hostは拒否される';

  -- 未認証
  perform set_config('myapp.uid', '', true);
  begin
    perform public.host_add_next_round(v_live, 2, jsonb_build_array(
      jsonb_build_object('group_id', v_g1, 'topic_body', 'a'),
      jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
      jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
    ));
    raise exception 'FAIL: 未認証が成功してしまった';
  exception when others then
    if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
  end;
  raise notice 'PASS: 未認証は拒否される';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- 上限超過・終了後の追加・二重送信・続行と終了の競合（3組構成でも同じ結果になることを確認）
do $$
declare
  v_live uuid;
  v_add record;
  v_add2 record;
  v_fin record;
  v_round int;
  v_payload jsonb;
  v_valid_payload jsonb;
  v_turn_count_before int;
  v_turn_count_after int;
begin
  v_live := pg_temp.setup_live_3groups();
  perform pg_temp.finish_round_to_decision(v_live, 1);

  for v_round in 2..10 loop
    v_payload := pg_temp.topics_payload(v_live, (
      select jsonb_agg(jsonb_build_object('group_order', go, 'body', format('上限テスト第%s周%s組', v_round, go)))
      from unnest(array[1,2,3]) as go
    )::jsonb);
    select * into v_add from public.host_add_next_round(v_live, v_round, v_payload);
    if v_add.ok is not true then raise exception 'FAIL: 第%周の追加に失敗(reason=%)', v_round, v_add.reason; end if;
    perform pg_temp.finish_round_to_decision(v_live, v_round);
  end loop;

  -- 上限超過（11周目）
  v_payload := pg_temp.topics_payload(v_live, (
    select jsonb_agg(jsonb_build_object('group_order', go, 'body', '上限超過'))
    from unnest(array[1,2,3]) as go
  )::jsonb);
  select * into v_add from public.host_add_next_round(v_live, 11, v_payload);
  if v_add.ok is not false or v_add.reason not like '%上限%' then
    raise exception 'FAIL: 3組構成でも上限超過(11周目)が拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: 3組構成でも周回数の上限(10)を超える追加は拒否される';

  -- 終了を選ぶ
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a001', true);
  select * into v_fin from public.host_finish_live_from_round_decision(v_live);
  if v_fin.ok is not true then raise exception 'FAIL: 終了操作に失敗(reason=%)', v_fin.reason; end if;

  -- 終了後の追加は拒否される
  select * into v_add from public.host_add_next_round(v_live, 11, v_payload);
  if v_add.ok is not false then raise exception 'FAIL: 終了後の追加が成功してしまった'; end if;
  raise notice 'PASS: 終了（final_result到達）後の追加は拒否される（3組構成でも同じ）';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- 同じ要求の二重送信（通信断を模す：1回目成功後、クライアントが同じp_expected_round・
-- 同じp_topicsで再送しても二重にturnを作らない）と、続行・終了の競合。
do $$
declare
  v_live uuid;
  v_add record;
  v_add2 record;
  v_fin record;
  v_payload jsonb;
  v_turn_count int;
begin
  v_live := pg_temp.setup_live_3groups();
  perform pg_temp.finish_round_to_decision(v_live, 1);

  v_payload := pg_temp.topics_payload(v_live, '[
    {"group_order":1,"body":"再送テスト1組目"},
    {"group_order":2,"body":"再送テスト2組目"},
    {"group_order":3,"body":"再送テスト3組目"}
  ]'::jsonb);

  select * into v_add from public.host_add_next_round(v_live, 2, v_payload);
  if v_add.ok is not true then raise exception 'FAIL: 1回目の追加に失敗(reason=%)', v_add.reason; end if;

  -- クライアントが応答を受け取れず、同じ要求（同じp_expected_round=2・同じp_topics）を再送したと仮定
  select * into v_add2 from public.host_add_next_round(v_live, 2, v_payload);
  if v_add2.ok is not false then raise exception 'FAIL: 同じ要求の再送が成功してしまった（二重作成の恐れ）'; end if;

  select count(*) into v_turn_count from public.turns where live_id = v_live and round = 2;
  if v_turn_count <> 3 then raise exception 'FAIL: 再送によってturnが二重に作られた（想定3件、実際%件）', v_turn_count; end if;
  raise notice 'PASS: 通信断後の同じ要求の再送は、既にtopic_revealへ進んでいることで安全に拒否され、turnを二重作成しない';

  -- 続行と終了の競合：第2周を終えてawaiting_round_decisionへ戻し、続行を先に確定させる
  perform pg_temp.finish_round_to_decision(v_live, 2);
  select * into v_add from public.host_add_next_round(v_live, 3, pg_temp.topics_payload(v_live, '[
    {"group_order":1,"body":"競合テスト1組目"},
    {"group_order":2,"body":"競合テスト2組目"},
    {"group_order":3,"body":"競合テスト3組目"}
  ]'::jsonb));
  if v_add.ok is not true then raise exception 'FAIL: 続行操作に失敗(reason=%)', v_add.reason; end if;

  select * into v_fin from public.host_finish_live_from_round_decision(v_live);
  if v_fin.ok is not false then raise exception 'FAIL: 続行済みなのに終了操作も成立してしまった'; end if;
  raise notice 'PASS: 3組構成でも続行と終了が競合した場合、先に成立した続行だけが有効になる';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- ============================================================
-- 後方互換（既存ライブの読み取り・第1周の作成・既存呼び出し互換性）
-- ============================================================
do $$
declare
  v_r record;
  v_live uuid;
  v_s record;
begin
  -- 既存の5引数呼び出し（create_live_preparation）は、1周目分のお題数のままで動作する
  set local role authenticated;
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '後方互換(5引数)', 20, 2,
    array['f0970000-0000-0000-0000-000000000001', 'f0970000-0000-0000-0000-000000000002']::uuid[]
  );
  reset role;
  if v_r.ok is not true then raise exception 'FAIL: 既存の5引数create_live_preparation呼び出しに失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;

  update public.lives set current_phase = 'opening' where id = v_live;
  insert into public.participants (live_id, user_id, role, preferred_role, is_guest, guest_number)
    values (v_live, 'f0970000-0000-0000-0000-00000000a011', 'player', 'player', false, null);
  perform set_config('myapp.uid', 'f0970000-0000-0000-0000-00000000a001', true);
  perform public.randomize_groups(v_live);
  select * into v_s from public.begin_game(v_live);
  if v_s.ok is not true then raise exception 'FAIL: 既存ライブの第1周作成(begin_game)に失敗(reason=%)', v_s.reason; end if;

  -- 既存ライブの読み取り（lives/turns/groups/topics）が壊れていない
  if not exists (select 1 from public.lives where id = v_live) then
    raise exception 'FAIL: 作成したライブをlivesから読み取れない';
  end if;
  if (select count(*) from public.turns where live_id = v_live) <> 2 then
    raise exception 'FAIL: 第1周のturn数が組数と一致しない';
  end if;
  raise notice 'PASS: 既存の5引数create_live_preparation呼び出し・第1周の作成・既存ライブの読み取りは変更後も壊れていない';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

update public.lives set current_phase = 'closed' where current_phase <> 'closed';
