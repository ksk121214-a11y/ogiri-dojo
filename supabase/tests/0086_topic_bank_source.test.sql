-- 0086 回帰テスト：host_add_next_roundが、登録済みのお題（topic_bank）から選んだ場合に
-- topics.topic_bank_idへ出典を保存し、不正なID・本文の不一致・同一リクエスト内での
-- 重複指定をDB側でも拒否することを検証する。手入力（topic_bank_id省略）との
-- 後方互換性（0085_per_group_topics.test.sqlが別途検証）を壊していないことも、
-- このファイル内で明示的にもう一度確認する。
-- 実行方法はsupabase/tests/run.sh参照。pg_tempはpsql接続（セッション）ごとに
-- 独立するため、このファイル専用にヘルパーを定義する（他ファイルのpg_tempと共有しない）。

\set ON_ERROR_STOP on

update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0860000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- host
  ('f0860000-0000-0000-0000-00000000a011', false, '{"provider":"x"}'::jsonb),
  ('f0860000-0000-0000-0000-00000000a012', false, '{"provider":"x"}'::jsonb),
  ('f0860000-0000-0000-0000-00000000a013', false, '{"provider":"x"}'::jsonb)
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0860000-0000-0000-0000-00000000a001';

insert into public.topic_bank (id, body, format, is_active) values
  ('f0860000-0000-0000-0000-000000000001', '初期お題1', 'text', true),
  ('f0860000-0000-0000-0000-000000000002', '初期お題2', 'text', true),
  ('f0860000-0000-0000-0000-000000000003', '初期お題3', 'text', true),
  -- 第2周で「登録済みのお題から選ぶ」対象。
  ('f0860000-0000-0000-0000-00000000b001', '登録済みのお題（1組目用）', 'text', true),
  ('f0860000-0000-0000-0000-00000000b002', '登録済みのお題（image_caption）', 'image_caption', true),
  -- 使用停止済み（is_active=false）。選ぶと拒否されるはず。
  ('f0860000-0000-0000-0000-00000000b003', '使用停止済みのお題', 'text', false)
on conflict do nothing;

create or replace function pg_temp.setup_live_3groups() returns uuid
language plpgsql as $$
declare
  v_r record;
  v_live uuid;
begin
  perform set_config('myapp.uid', 'f0860000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), 'topic_bank出典テスト(3組)', 20, 3,
    array['f0860000-0000-0000-0000-000000000001', 'f0860000-0000-0000-0000-000000000002', 'f0860000-0000-0000-0000-000000000003']::uuid[]
  );
  if v_r.ok is not true then raise exception 'FAIL: テスト用ライブの作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;

  update public.lives set current_phase = 'opening' where id = v_live;
  perform set_config('myapp.uid', 'f0860000-0000-0000-0000-00000000a011', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0860000-0000-0000-0000-00000000a012', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0860000-0000-0000-0000-00000000a013', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0860000-0000-0000-0000-00000000a001', true);
  perform public.randomize_groups(v_live);
  perform public.begin_game(v_live);
  return v_live;
end $$;

create or replace function pg_temp.finish_round_to_decision(p_live uuid, p_round int) returns void
language plpgsql as $$
declare
  v_turn record;
  v_advanced text;
begin
  perform set_config('myapp.uid', 'f0860000-0000-0000-0000-00000000a001', true);
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

-- ============================================================
-- 正常系：1組は登録済みのお題（image_caption含む）から選択、1組は手入力
-- ============================================================
do $$
declare
  v_live uuid;
  v_g1 uuid;
  v_g2 uuid;
  v_g3 uuid;
  v_add record;
  v_topic1 record;
  v_topic2 record;
  v_topic3 record;
begin
  v_live := pg_temp.setup_live_3groups();
  perform pg_temp.finish_round_to_decision(v_live, 1);
  select id into v_g1 from public.groups where live_id = v_live and group_order = 1;
  select id into v_g2 from public.groups where live_id = v_live and group_order = 2;
  select id into v_g3 from public.groups where live_id = v_live and group_order = 3;

  perform set_config('myapp.uid', 'f0860000-0000-0000-0000-00000000a001', true);

  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', '登録済みのお題（1組目用）', 'topic_bank_id', 'f0860000-0000-0000-0000-00000000b001'),
    jsonb_build_object('group_id', v_g2, 'topic_body', '登録済みのお題（image_caption）', 'topic_bank_id', 'f0860000-0000-0000-0000-00000000b002'),
    jsonb_build_object('group_id', v_g3, 'topic_body', '3組目は手入力のお題')
  ));
  if v_add.ok is not true then raise exception 'FAIL: 登録済み選択+手入力の混在が失敗(reason=%)', v_add.reason; end if;

  select tp.topic_bank_id, tp.body, tp.format into v_topic1
    from public.turns t join public.topics tp on tp.id = t.topic_id
    where t.live_id = v_live and t.round = 2 and t.group_id = v_g1;
  if v_topic1.topic_bank_id <> 'f0860000-0000-0000-0000-00000000b001' then
    raise exception 'FAIL: 1組目のtopic_bank_idが保存されていない(got=%)', v_topic1.topic_bank_id;
  end if;
  if v_topic1.body <> '登録済みのお題（1組目用）' then raise exception 'FAIL: 1組目の本文が不一致'; end if;
  raise notice 'PASS: 登録済みのお題を選んだ場合、topics.topic_bank_idへ出典IDが保存される';

  select tp.topic_bank_id, tp.body, tp.format into v_topic2
    from public.turns t join public.topics tp on tp.id = t.topic_id
    where t.live_id = v_live and t.round = 2 and t.group_id = v_g2;
  if v_topic2.format <> 'image_caption' then
    raise exception 'FAIL: 登録済みのお題のformatが引き継がれていない(got=%)', v_topic2.format;
  end if;
  raise notice 'PASS: 登録済みのお題のformat（image_caption）がtopics.formatへ引き継がれる';

  select tp.topic_bank_id, tp.body into v_topic3
    from public.turns t join public.topics tp on tp.id = t.topic_id
    where t.live_id = v_live and t.round = 2 and t.group_id = v_g3;
  if v_topic3.topic_bank_id is not null then
    raise exception 'FAIL: 手入力(topic_bank_id省略)のはずがtopic_bank_idが設定されている(got=%)', v_topic3.topic_bank_id;
  end if;
  if v_topic3.body <> '3組目は手入力のお題' then raise exception 'FAIL: 3組目(手入力)の本文が不一致'; end if;
  raise notice 'PASS: topic_bank_idを省略した手入力は、従来どおりtopic_bank_id=nullで保存される（後方互換）';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- ============================================================
-- 異常系：不正なtopic_bank_id・本文不一致・使用停止・同一リクエスト内の重複選択
-- ============================================================
do $$
declare
  v_live uuid;
  v_g1 uuid;
  v_g2 uuid;
  v_g3 uuid;
  v_add record;
  v_n int;
begin
  v_live := pg_temp.setup_live_3groups();
  perform pg_temp.finish_round_to_decision(v_live, 1);
  select id into v_g1 from public.groups where live_id = v_live and group_order = 1;
  select id into v_g2 from public.groups where live_id = v_live and group_order = 2;
  select id into v_g3 from public.groups where live_id = v_live and group_order = 3;

  perform set_config('myapp.uid', 'f0860000-0000-0000-0000-00000000a001', true);

  -- topic_bank_idがUUID形式でない
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 'a', 'topic_bank_id', 'not-a-uuid'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false then raise exception 'FAIL: topic_bank_idがUUID形式でない場合に拒否されない'; end if;
  raise notice 'PASS: topic_bank_idがUUID形式でない場合は拒否される';

  -- topic_bank_idが存在しない
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 'a', 'topic_bank_id', gen_random_uuid()),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false or v_add.reason not like '%見つからないか%' then
    raise exception 'FAIL: 存在しないtopic_bank_idが拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: 存在しないtopic_bank_idは拒否される';

  -- topic_bank_idが使用停止済み(is_active=false)
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', '使用停止済みのお題', 'topic_bank_id', 'f0860000-0000-0000-0000-00000000b003'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false or v_add.reason not like '%見つからないか%' then
    raise exception 'FAIL: 使用停止済みのtopic_bank_idが拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: is_active=falseのtopic_bank_idは拒否される';

  -- 本文がtopic_bank側と一致しない
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', '本文を書き換えた', 'topic_bank_id', 'f0860000-0000-0000-0000-00000000b001'),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false or v_add.reason not like '%一致しません%' then
    raise exception 'FAIL: 本文不一致が拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: topic_bodyがtopic_bank側のbodyと一致しない場合は拒否される';

  -- 同じtopic_bank_idを2組へ重複指定
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', '登録済みのお題（1組目用）', 'topic_bank_id', 'f0860000-0000-0000-0000-00000000b001'),
    jsonb_build_object('group_id', v_g2, 'topic_body', '登録済みのお題（1組目用）', 'topic_bank_id', 'f0860000-0000-0000-0000-00000000b001'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not false or v_add.reason not like '%複数の組%' then
    raise exception 'FAIL: 同じtopic_bank_idの重複指定が拒否されない(ok=%, reason=%)', v_add.ok, v_add.reason;
  end if;
  raise notice 'PASS: 同じtopic_bank_idを複数の組に重複指定した場合は拒否される';

  -- topic_bank_idがJSON null（明示的にnullを渡した場合も手入力として許可される）
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', v_g1, 'topic_body', 'a', 'topic_bank_id', null),
    jsonb_build_object('group_id', v_g2, 'topic_body', 'b'),
    jsonb_build_object('group_id', v_g3, 'topic_body', 'c')
  ));
  if v_add.ok is not true then raise exception 'FAIL: topic_bank_id=JSON nullの手入力が失敗(reason=%)', v_add.reason; end if;
  raise notice 'PASS: topic_bank_idに明示的にJSON nullを渡した場合も手入力として許可される';

  -- 上記の失敗した試行では、どれもturnが作られていないこと（拒否時に部分作成されない）
  select count(*) into v_n from public.turns where live_id = v_live and round = 2;
  if v_n <> 3 then raise exception 'FAIL: 拒否された試行の後にturn数が想定(3=最後に成功したJSON null分)と違う(got=%)', v_n; end if;

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

update public.lives set current_phase = 'closed' where current_phase <> 'closed';
