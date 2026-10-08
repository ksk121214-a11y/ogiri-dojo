-- 0084/0085 回帰テスト：周回数の保存値（lives.rounds_per_live）と、0084で再定義したRPC・
-- 内部ヘルパーの実行権限（PUBLIC/anon/authenticated）を検証する。
--  - create_live_preparationは rounds_per_live=1（1周目分だけ）を明示的に保存する
--    （0085で2周固定から動的な周回追加へ変更したため。2周目以降はhost_add_next_round）
--  - begin_gameは保存値が1でなければ開始しない（ターンも作らない）
--  - お題が足りないライブは、begin_gameでも1周分が揃わないため開始できない（多層防御）
--  - 本番(standard)の回答時間は90秒、short_testは20秒のまま
--  - 公開RPCはauthenticatedのみ、_apply_first_live_rewardは誰も直接実行できない
-- host_add_next_round等の新規RPCの権限検証は0085_dynamic_rounds.test.sqlで行う。
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0870000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- host
  ('f0870000-0000-0000-0000-00000000a011', false, '{"provider":"x"}'::jsonb),
  ('f0870000-0000-0000-0000-00000000a012', false, '{"provider":"x"}'::jsonb)
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0870000-0000-0000-0000-00000000a001';

insert into public.topic_bank (id, body, format, is_active) values
  ('f0870000-0000-0000-0000-000000000001', '周回設定テスト用お題1', 'text', true),
  ('f0870000-0000-0000-0000-000000000002', '周回設定テスト用お題2', 'text', true),
  ('f0870000-0000-0000-0000-000000000003', '周回設定テスト用お題3', 'text', true),
  ('f0870000-0000-0000-0000-000000000004', '周回設定テスト用お題4', 'text', true)
on conflict do nothing;

-- テスト1：新規作成は rounds_per_live=1 を明示的に保存する（テストライブ・本番ライブとも）
do $$
declare
  v_r record;
  v_saved int;
  v_official_before int;
begin
  select last_value into v_official_before from public.official_live_counter where id = true;

  set local role authenticated;
  perform set_config('myapp.uid', 'f0870000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '周回設定(テスト)', 20, 2,
    array['f0870000-0000-0000-0000-000000000001', 'f0870000-0000-0000-0000-000000000002']::uuid[],
    'test', null, 'standard'
  );
  reset role;
  if v_r.ok is not true then raise exception 'FAIL: テストライブ(2組・お題2件)の作成に失敗(reason=%)', v_r.reason; end if;
  select rounds_per_live into v_saved from public.lives where id = v_r.live_id;
  if v_saved is distinct from 1 then raise exception 'FAIL: 新規作成のlives.rounds_per_liveが1で保存されていない(got=%)', v_saved; end if;
  update public.lives set current_phase = 'closed' where id = v_r.live_id;
  raise notice 'PASS: 新規作成したライブはlives.rounds_per_live=1（1周目分だけ）を明示的に保存する（テストライブ）';

  -- 本番ライブも同じ保存値（開催番号は試験用の大きな値を使い、カウンターは後で元に戻す）
  set local role authenticated;
  perform set_config('myapp.uid', 'f0870000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '周回設定(本番テスト)', 20, 2,
    array['f0870000-0000-0000-0000-000000000001', 'f0870000-0000-0000-0000-000000000002']::uuid[],
    'official', 982050, 'standard'
  );
  reset role;
  if v_r.ok is not true then raise exception 'FAIL: 本番ライブ(2組・お題2件)の作成に失敗(reason=%)', v_r.reason; end if;
  select rounds_per_live into v_saved from public.lives where id = v_r.live_id;
  if v_saved is distinct from 1 then raise exception 'FAIL: 本番ライブのrounds_per_liveが1で保存されていない(got=%)', v_saved; end if;
  update public.lives set current_phase = 'closed' where id = v_r.live_id;
  update public.official_live_counter set last_value = v_official_before where id = true;
  raise notice 'PASS: 新規作成した本番ライブもlives.rounds_per_live=1を明示的に保存する';
end $$;

-- テスト2：保存値が1でなければbegin_gameは開始せず、ターンも作らない
do $$
declare
  v_r record;
  v_live uuid;
  v_begin record;
  v_turns int;
  v_phase text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0870000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '周回設定(開始拒否)', 20, 2,
    array['f0870000-0000-0000-0000-000000000001', 'f0870000-0000-0000-0000-000000000002']::uuid[],
    'test', null, 'standard'
  );
  reset role;
  v_live := v_r.live_id;

  update public.lives set current_phase = 'opening' where id = v_live;
  update public.lives set rounds_per_live = 2 where id = v_live; -- 保存値を2周へ改ざんした状況を模擬
  set local role authenticated;
  perform set_config('myapp.uid', 'f0870000-0000-0000-0000-00000000a001', true);
  select * into v_begin from public.begin_game(v_live);
  reset role;
  if v_begin.ok is not false then raise exception 'FAIL: 保存値が1でないのに開始できてしまった'; end if;
  if v_begin.reason not like '%1周目開始%' then raise exception 'FAIL: 周回数の不一致理由が出ていない(got=%)', v_begin.reason; end if;
  select count(*) into v_turns from public.turns where live_id = v_live;
  select current_phase into v_phase from public.lives where id = v_live;
  if v_turns <> 0 then raise exception 'FAIL: 拒否されたのにターンが作られている(%件)', v_turns; end if;
  if v_phase <> 'opening' then raise exception 'FAIL: 拒否されたのに進行フェーズが変わった(%)', v_phase; end if;
  raise notice 'PASS: 保存された周回数が1でなければbegin_gameは開始せず、ターンも進行も変えない';
  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- テスト3：作成後にお題を減らされても（ライブは作られた後）、begin_gameは1周分が揃わなければ開始しない。
-- 作成時点で拒否する本体の検証は0084_create_live_entrypointsで行う。これは多層防御の確認。
do $$
declare
  v_r record;
  v_begin record;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0870000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), '周回設定(お題不足の多層防御)', 20, 2,
    array['f0870000-0000-0000-0000-000000000001', 'f0870000-0000-0000-0000-000000000002']::uuid[],
    'test', null, 'standard'
  );
  reset role;
  if v_r.ok is not true then raise exception 'FAIL: 2組・お題2件の作成に失敗(reason=%)', v_r.reason; end if;
  update public.lives set current_phase = 'opening' where id = v_r.live_id;
  insert into public.participants (live_id, user_id, role, preferred_role, is_guest, guest_number)
    values (v_r.live_id, 'f0870000-0000-0000-0000-00000000a011', 'player', 'player', false, null);
  set local role authenticated;
  perform set_config('myapp.uid', 'f0870000-0000-0000-0000-00000000a001', true);
  perform public.randomize_groups(v_r.live_id);
  reset role;
  update public.participants set group_id = (select id from public.groups where live_id = v_r.live_id and group_order = 1)
    where live_id = v_r.live_id;
  -- 作成後に登録お題を1件（1周分の2件未満）へ減らした状態を模擬する
  delete from public.topics where live_id = v_r.live_id and id in (
    select id from public.topics where live_id = v_r.live_id order by created_at desc limit 1
  );
  set local role authenticated;
  perform set_config('myapp.uid', 'f0870000-0000-0000-0000-00000000a001', true);
  select * into v_begin from public.begin_game(v_r.live_id);
  reset role;
  if v_begin.ok is not false then raise exception 'FAIL: お題が1周分に満たないライブが開始できてしまった'; end if;
  if v_begin.reason not like '%お題%' then raise exception 'FAIL: お題不足の理由が出ていない(got=%)', v_begin.reason; end if;
  update public.lives set current_phase = 'closed' where id = v_r.live_id;
  raise notice 'PASS: 作成後にお題が1周分に満たなくなったライブは、begin_gameでも開始できない（多層防御）';
end $$;

-- テスト4：短縮時間（short_test）は20秒のまま、本番(standard)の回答時間は90秒。他フェーズは据え置き。
do $$
begin
  if public._live_phase_duration_ms('standard', 'answering') <> 90000 then
    raise exception 'FAIL: 本番(standard)の回答時間が90秒になっていない';
  end if;
  if public._live_phase_duration_ms('short_test', 'answering') <> 20000 then
    raise exception 'FAIL: short_testの回答時間が20秒のままになっていない';
  end if;
  if public._live_phase_duration_ms('standard', 'judge') <> 10000
     or public._live_phase_duration_ms('standard', 'topic_reveal') <> 13000
     or public._live_phase_duration_ms('standard', 'opening') <> 45000
     or public._live_phase_duration_ms('standard', 'interlude') <> 15000
     or public._live_phase_duration_ms('standard', 'group_result') <> 15000 then
    raise exception 'FAIL: 回答時間以外の本番フェーズ時間が変わっている';
  end if;
  if public._live_phase_duration_ms('short_test', 'judge') <> 6000
     or public._live_phase_duration_ms('short_test', 'topic_reveal') <> 7000 then
    raise exception 'FAIL: short_testの他フェーズ時間が変わっている';
  end if;
  raise notice 'PASS: 本番の回答時間は90秒、short_testは20秒、他のフェーズ時間は変わらない';
end $$;

-- テスト5：実行権限の明示。PUBLIC（proaclのgrantee=0）・anonは実行不可、authenticatedのみ可。
do $$
declare
  v_oid oid;
  v_public boolean;
begin
  -- create_live_preparation（8引数）
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_live_preparation' and p.pronargs = 8;
  select exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_oid)) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_public;
  if v_public then raise exception 'FAIL: create_live_preparation(8引数)がPUBLICに実行権限を持っている'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then raise exception 'FAIL: create_live_preparation(8引数)がanonに実行可能'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then raise exception 'FAIL: create_live_preparation(8引数)がauthenticatedに実行できない'; end if;
  raise notice 'PASS: create_live_preparation（8引数）はauthenticatedのみ実行可（PUBLIC・anonは不可）';

  -- begin_game(uuid)
  v_oid := 'public.begin_game(uuid)'::regprocedure;
  select exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_oid)) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_public;
  if v_public then raise exception 'FAIL: begin_gameがPUBLICに実行権限を持っている'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then raise exception 'FAIL: begin_gameがanonに実行可能'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then raise exception 'FAIL: begin_gameがauthenticatedに実行できない'; end if;
  raise notice 'PASS: begin_game(uuid)はauthenticatedのみ実行可（PUBLIC・anonは不可）';

  -- mark_final_result_presence(uuid, uuid)
  v_oid := 'public.mark_final_result_presence(uuid, uuid)'::regprocedure;
  select exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_oid)) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_public;
  if v_public then raise exception 'FAIL: mark_final_result_presenceがPUBLICに実行権限を持っている'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then raise exception 'FAIL: mark_final_result_presenceがanonに実行可能'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then raise exception 'FAIL: mark_final_result_presenceがauthenticatedに実行できない'; end if;
  raise notice 'PASS: mark_final_result_presence(uuid, uuid)はauthenticatedのみ実行可';

  -- _apply_first_live_reward(uuid, uuid)：内部ヘルパーは誰からも直接実行できない
  v_oid := 'public._apply_first_live_reward(uuid, uuid)'::regprocedure;
  select exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_oid)) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_public;
  if v_public then raise exception 'FAIL: _apply_first_live_rewardがPUBLICに実行権限を持っている'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then raise exception 'FAIL: _apply_first_live_rewardがanonに実行可能'; end if;
  if has_function_privilege('authenticated', v_oid, 'EXECUTE') then raise exception 'FAIL: _apply_first_live_rewardがauthenticatedに直接実行可能'; end if;
  raise notice 'PASS: _apply_first_live_reward(uuid, uuid)はPUBLIC・anon・authenticatedのいずれからも直接実行できない';
end $$;

-- 後始末：このファイルのライブは閉じておく（後続テストの非closedライブ制約に影響させない）
update public.lives set current_phase = 'closed' where current_phase <> 'closed';
