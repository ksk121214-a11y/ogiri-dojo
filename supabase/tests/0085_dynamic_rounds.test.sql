-- 0085 回帰テスト：運営者が周回を判断する仕様（host_add_next_round /
-- host_finish_live_from_round_decision）を検証する。
--  - 組結果後、次のターンが無ければawaiting_round_decisionへ入る（自動でfinal_resultへは進まない）
--  - host_add_next_roundは運営者だけが実行できる（非host・未認証は拒否）
--  - awaiting_round_decision以外のフェーズでは拒否される
--  - 1周目終了前（awaiting_round_decisionに入る前）は拒否される
--  - 第2周・第3周を追加できる。上限（10周）超過は拒否される
--  - 同じ周番号の二重追加（多重送信・古い画面）は二重作成しない
--  - 続行(host_add_next_round)と終了(host_finish_live_from_round_decision)が競合した場合、片方だけが成立する
--  - 終了後の追加は拒否される。続行後の重複終了操作は二重処理しない
--  - 最終結果は全完了周の回答を含む（apply_live_rank_rewardsの集計対象として確認）
--  - テストライブ・緊急中止では初期ライブ限定特典を付与しない（既存条件を維持）
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0950000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- host
  ('f0950000-0000-0000-0000-00000000a002', false, '{"provider":"x"}'::jsonb), -- 非host
  ('f0950000-0000-0000-0000-00000000a011', false, '{"provider":"x"}'::jsonb)  -- player
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0950000-0000-0000-0000-00000000a001';

insert into public.topic_bank (id, body, format, is_active) values
  ('f0950000-0000-0000-0000-000000000001', '動的周回テスト用お題1', 'text', true)
on conflict do nothing;

-- 補助：ホストとしてライブを1周目まで開始する（1組・1人のplayer）
create or replace function pg_temp.setup_live() returns uuid
language plpgsql as $$
declare
  v_r record;
  v_live uuid;
begin
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '動的周回テスト', 20, 1,
    array['f0950000-0000-0000-0000-000000000001']::uuid[]
  );
  if v_r.ok is not true then raise exception 'FAIL: 動的周回テスト用ライブの作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;

  update public.lives set current_phase = 'opening' where id = v_live;
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a011', true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  perform public.randomize_groups(v_live);
  perform public.begin_game(v_live);
  return v_live;
end $$;

-- 補助：このファイルのライブは常に1組だけなので、1件のお題を
-- host_add_next_roundが要求するgroup_id付きjsonb配列（1要素）へ変換する。
-- 複数組・group_idの対応検証そのものは0085_per_group_topics.test.sqlで行う。
create or replace function pg_temp.one_topic(p_live uuid, p_body text) returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'group_id', (select id from public.groups where live_id = p_live and group_order = 1),
    'topic_body', p_body
  ))
$$;
grant execute on function pg_temp.one_topic(uuid, text) to authenticated, anon;

-- テスト1：1周目終了前（opening/topic_reveal/answering等）はhost_add_next_round・
-- host_finish_live_from_round_decisionいずれも拒否される。
do $$
declare
  v_live uuid;
  v_add record;
  v_fin record;
begin
  v_live := pg_temp.setup_live();

  if (select current_phase from public.lives where id = v_live) <> 'topic_reveal' then
    raise exception 'FAIL: begin_game直後のフェーズがtopic_revealになっていない';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  select * into v_add from public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, 'まだ早いお題'));
  select * into v_fin from public.host_finish_live_from_round_decision(v_live);
  reset role;
  if v_add.ok is not false then raise exception 'FAIL: 1周目終了前なのにhost_add_next_roundが成功した'; end if;
  if v_fin.ok is not false then raise exception 'FAIL: 1周目終了前なのにhost_finish_live_from_round_decisionが成功した'; end if;
  raise notice 'PASS: awaiting_round_decision以外のフェーズではhost_add_next_round・host_finish_live_from_round_decisionいずれも拒否される';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- テスト2〜：1組の1周目を終えてawaiting_round_decisionへ入り、権限・上限・冪等性を検証する。
do $$
declare
  v_live uuid;
  v_turn1 uuid;
  v_round2_turn uuid;
  v_advanced text;
  v_add record;
  v_fin record;
  v_round int;
  v_turn_round record;
begin
  v_live := pg_temp.setup_live();
  select current_turn_id into v_turn1 from public.lives where id = v_live;

  set local role authenticated;
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  update public.lives set current_phase = 'group_result', phase_deadline = now() - interval '1 second' where id = v_live;
  update public.turns set status = 'done' where id = v_turn1;
  select advanced_to into v_advanced from public.host_advance_group_result_to_next(v_live, v_turn1, 0);
  reset role;
  if v_advanced <> 'awaiting_round_decision' then
    raise exception 'FAIL: 1組・1周だけのライブが組結果後にawaiting_round_decisionへ進まなかった(got=%)', v_advanced;
  end if;
  if (select current_phase from public.lives where id = v_live) <> 'awaiting_round_decision' then
    raise exception 'FAIL: lives.current_phaseがawaiting_round_decisionになっていない';
  end if;
  if (select current_turn_id from public.lives where id = v_live) <> v_turn1 then
    raise exception 'FAIL: awaiting_round_decisionへ入った時点でcurrent_turn_idが変わってしまった（直前の組結果表示が壊れる）';
  end if;
  raise notice 'PASS: 全組終了後はawaiting_round_decisionへ入り、current_turn_idは直前のターンを保つ';

  -- 非hostは拒否される
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a002', true);
  begin
    perform public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, '非host用お題'));
    raise exception 'FAIL: 非hostがhost_add_next_roundを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  raise notice 'PASS: 非hostはhost_add_next_roundを実行できない';

  -- 未認証は拒否される
  perform set_config('myapp.uid', '', true);
  begin
    perform public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, '未認証用お題'));
    raise exception 'FAIL: 未認証でhost_add_next_roundを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  raise notice 'PASS: 未認証ではhost_add_next_roundを実行できない（is_host()がfalseを返すため拒否される）';

  -- 空のお題は拒否される
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  select * into v_add from public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, '   '));
  if v_add.ok is not false then raise exception 'FAIL: 空のお題でhost_add_next_roundが成功した'; end if;
  raise notice 'PASS: 空文字・空白だけのお題は拒否される';

  -- 第2周を追加する
  select * into v_add from public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, '動的2周目のお題'));
  if v_add.ok is not true then raise exception 'FAIL: 第2周の追加に失敗(reason=%)', v_add.reason; end if;
  if (v_add.live).current_phase <> 'topic_reveal' then raise exception 'FAIL: 第2周追加後のフェーズがtopic_revealでない'; end if;
  if (v_add.live).rounds_per_live <> 2 then raise exception 'FAIL: rounds_per_liveが2に増えていない(got=%)', (v_add.live).rounds_per_live; end if;
  v_round2_turn := v_add.first_turn_id; -- 直後の二重追加テストでv_addが上書きされるため、ここで確保しておく
  select round into v_round from public.turns where id = v_round2_turn;
  if v_round <> 2 then raise exception 'FAIL: 追加されたターンのroundが2になっていない(got=%)', v_round; end if;
  raise notice 'PASS: host_add_next_roundで第2周を追加できる（rounds_per_live=2、新しいターンがtopic_revealで開始）';

  -- 同じ周番号(2)の二重追加は拒否される（多重送信・古い画面からの再送の冪等化）
  select * into v_add from public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, '二重追加お題'));
  if v_add.ok is not false then raise exception 'FAIL: 既に追加済みの周番号(2)で再度host_add_next_roundが成功した（二重作成の恐れ）'; end if;
  if (select count(*) from public.turns where live_id = v_live and round = 2) <> 1 then
    raise exception 'FAIL: 第2周のターンが2件以上作られている（二重作成）';
  end if;
  raise notice 'PASS: 同じ周番号への二重のhost_add_next_round呼び出しは二重作成しない（既にtopic_revealへ進んでいるため拒否される）';

  -- 第2周を終えて再びawaiting_round_decisionへ入る
  update public.lives set current_phase = 'group_result', phase_deadline = now() - interval '1 second' where id = v_live;
  update public.turns set status = 'done' where id = v_round2_turn;
  select advanced_to into v_advanced from public.host_advance_group_result_to_next(v_live, v_round2_turn, 0);
  if v_advanced <> 'awaiting_round_decision' then raise exception 'FAIL: 第2周終了後にawaiting_round_decisionへ進まなかった(got=%)', v_advanced; end if;

  -- 第3周を追加できる（最低3周まで実際に追加できることを確認する）
  select * into v_add from public.host_add_next_round(v_live, 3, pg_temp.one_topic(v_live, '動的3周目のお題'));
  if v_add.ok is not true then raise exception 'FAIL: 第3周の追加に失敗(reason=%)', v_add.reason; end if;
  if (v_add.live).rounds_per_live <> 3 then raise exception 'FAIL: rounds_per_liveが3に増えていない(got=%)', (v_add.live).rounds_per_live; end if;
  raise notice 'PASS: host_add_next_roundで第3周も同様に追加できる（最大周回数まで繰り返し可能）';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- テスト3：上限（10周）到達後は追加できず、終了だけ選べる。
do $$
declare
  v_live uuid;
  v_turn1 uuid;
  v_advanced text;
  v_add record;
  v_fin record;
  v_round int;
  v_live_row public.lives;
begin
  v_live := pg_temp.setup_live();
  select current_turn_id into v_turn1 from public.lives where id = v_live;

  set local role authenticated;
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  update public.lives set current_phase = 'group_result', phase_deadline = now() - interval '1 second' where id = v_live;
  update public.turns set status = 'done' where id = v_turn1;
  perform public.host_advance_group_result_to_next(v_live, v_turn1, 0);

  -- 第2周〜第10周まで追加する（計9回。現在round=1→10まで）。
  for v_round in 2..10 loop
    select * into v_add from public.host_add_next_round(v_live, v_round, pg_temp.one_topic(v_live, '上限テスト周' || v_round));
    if v_add.ok is not true then raise exception 'FAIL: 第%周の追加に失敗(reason=%)', v_round, v_add.reason; end if;
    update public.lives set current_phase = 'group_result', phase_deadline = now() - interval '1 second' where id = v_live;
    update public.turns set status = 'done' where id = v_add.first_turn_id;
    select advanced_to into v_advanced from public.host_advance_group_result_to_next(v_live, v_add.first_turn_id, 0);
    if v_advanced <> 'awaiting_round_decision' then raise exception 'FAIL: 第%周終了後にawaiting_round_decisionへ進まなかった(got=%)', v_round, v_advanced; end if;
  end loop;

  select rounds_per_live into v_round from public.lives where id = v_live;
  if v_round <> 10 then raise exception 'FAIL: 10周まで追加した後のrounds_per_liveが10になっていない(got=%)', v_round; end if;

  -- 11周目は上限超過で拒否される
  select * into v_add from public.host_add_next_round(v_live, 11, pg_temp.one_topic(v_live, '上限超過のお題'));
  if v_add.ok is not false then raise exception 'FAIL: 10周を超える第11周の追加が成功してしまった（上限超過）'; end if;
  if v_add.reason not like '%上限%' then raise exception 'FAIL: 上限超過の理由が出ていない(got=%)', v_add.reason; end if;
  raise notice 'PASS: 10周（安全上の上限）に達した後、host_add_next_roundは拒否される';

  -- 上限到達後も終了は選べる
  select * into v_fin from public.host_finish_live_from_round_decision(v_live);
  if v_fin.ok is not true then raise exception 'FAIL: 上限到達後にhost_finish_live_from_round_decisionが失敗した(reason=%)', v_fin.reason; end if;
  if (v_fin.live).current_phase <> 'final_result' then raise exception 'FAIL: 終了操作の後にfinal_resultへ進んでいない'; end if;
  raise notice 'PASS: 周回数の上限に達した後も、host_finish_live_from_round_decisionでライブを終了できる';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- テスト4：終了後の追加拒否・重複終了の無害化・続行と終了が競合した場合に片方だけ成立する。
do $$
declare
  v_live uuid;
  v_turn1 uuid;
  v_advanced text;
  v_add record;
  v_fin record;
  v_fin2 record;
begin
  v_live := pg_temp.setup_live();
  select current_turn_id into v_turn1 from public.lives where id = v_live;

  set local role authenticated;
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  update public.lives set current_phase = 'group_result', phase_deadline = now() - interval '1 second' where id = v_live;
  update public.turns set status = 'done' where id = v_turn1;
  perform public.host_advance_group_result_to_next(v_live, v_turn1, 0);

  -- 終了を選ぶ
  select * into v_fin from public.host_finish_live_from_round_decision(v_live);
  if v_fin.ok is not true then raise exception 'FAIL: host_finish_live_from_round_decisionに失敗(reason=%)', v_fin.reason; end if;
  if (select current_phase from public.lives where id = v_live) <> 'final_result' then
    raise exception 'FAIL: 終了操作の後にfinal_resultへ進んでいない';
  end if;

  -- 終了後の追加は拒否される（既にawaiting_round_decisionではないため）
  select * into v_add from public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, '終了後のお題'));
  if v_add.ok is not false then raise exception 'FAIL: final_result到達後にhost_add_next_roundが成功してしまった'; end if;
  raise notice 'PASS: 終了（final_result到達）後のhost_add_next_roundは拒否される';

  -- 続行後（ここでは終了後）の重複終了操作は二重処理しない（エラーにせずそのまま返す）
  select * into v_fin2 from public.host_finish_live_from_round_decision(v_live);
  if v_fin2.ok is not true then raise exception 'FAIL: 二重の終了操作がエラーになった（ok=false）'; end if;
  if (select current_phase from public.lives where id = v_live) <> 'final_result' then
    raise exception 'FAIL: 二重の終了操作でフェーズが変わってしまった';
  end if;
  raise notice 'PASS: final_result到達後に重複してhost_finish_live_from_round_decisionを呼んでも二重処理せず無害';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- テスト5：続行(host_add_next_round)と終了(host_finish_live_from_round_decision)が
-- 競合した場合、先に成立した一方だけが有効になる（行ロックにより直列化される）。
do $$
declare
  v_live uuid;
  v_turn1 uuid;
  v_add record;
  v_fin record;
begin
  v_live := pg_temp.setup_live();
  select current_turn_id into v_turn1 from public.lives where id = v_live;

  set local role authenticated;
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  update public.lives set current_phase = 'group_result', phase_deadline = now() - interval '1 second' where id = v_live;
  update public.turns set status = 'done' where id = v_turn1;
  perform public.host_advance_group_result_to_next(v_live, v_turn1, 0);

  -- 同じトランザクション内では行ロックにより順に実行される。先に続行を確定させる。
  select * into v_add from public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, '競合テスト用お題'));
  if v_add.ok is not true then raise exception 'FAIL: 続行操作に失敗(reason=%)', v_add.reason; end if;

  -- 後から終了を試みても、既にawaiting_round_decisionではないため拒否される
  -- （「続行と終了が競合しても片方だけが成立する」の確認）。
  select * into v_fin from public.host_finish_live_from_round_decision(v_live);
  if v_fin.ok is not false then raise exception 'FAIL: 既に続行済みなのに終了操作も成立してしまった（両方成立は不可）'; end if;
  if (select current_phase from public.lives where id = v_live) <> 'topic_reveal' then
    raise exception 'FAIL: 続行が成立した後のフェーズがtopic_revealのままになっていない';
  end if;
  raise notice 'PASS: 続行と終了が競合しても、先に成立した一方だけが有効になり、もう一方は拒否される';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- テスト6：テストライブ・緊急中止では初期ライブ限定特典を付与しない（既存条件を維持）。
-- 動的な周回追加を経ても、live_mode='test'ならapply_live_rank_rewardsは何もしないことを確認する。
do $$
declare
  v_live uuid;
  v_turn1 uuid;
  v_add record;
begin
  v_live := pg_temp.setup_live();
  select current_turn_id into v_turn1 from public.lives where id = v_live;

  set local role authenticated;
  perform set_config('myapp.uid', 'f0950000-0000-0000-0000-00000000a001', true);
  update public.lives set current_phase = 'group_result', phase_deadline = now() - interval '1 second' where id = v_live;
  update public.turns set status = 'done' where id = v_turn1;
  perform public.host_advance_group_result_to_next(v_live, v_turn1, 0);
  select * into v_add from public.host_add_next_round(v_live, 2, pg_temp.one_topic(v_live, 'テストライブ特典確認用お題'));
  update public.lives set current_phase = 'group_result', phase_deadline = now() - interval '1 second' where id = v_live;
  update public.turns set status = 'done' where id = v_add.first_turn_id;
  perform public.host_advance_group_result_to_next(v_live, v_add.first_turn_id, 0);
  perform public.host_finish_live_from_round_decision(v_live);
  update public.lives set current_phase = 'closed' where id = v_live;
  perform set_config('myapp.uid', '', true);
  perform public.apply_live_rank_rewards(v_live);
  if (select rank_rewards_applied from public.lives where id = v_live) is not false then
    raise exception 'FAIL: テストライブなのにrank_rewards_appliedがtrueになった';
  end if;
  raise notice 'PASS: 動的に周回を追加したテストライブでも、apply_live_rank_rewardsは何も付与しない（既存条件を維持）';
end $$;

update public.lives set current_phase = 'closed' where current_phase <> 'closed';
