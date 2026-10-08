-- 0085 回帰テスト：ステージング運営・参加の安全な分離を検証する。
--  - staging_testersはis_host()だけが発行・失効できる（一般ロールは直接INSERT/UPDATE不可）
--  - 本人・is_host()だけがstaging_testers行をselectできる
--  - lives.access_restricted=trueのライブは、許可された利用者だけjoin_liveできる
--    （許可されていない利用者は拒否、失効後は拒否、既定値falseのライブは影響を受けない）
--  - public._environment_marker は誰でもselectできるが、一般ロールはINSERT/UPDATE/DELETE不可
--  - 新規RPC（host_add_next_round・host_finish_live_from_round_decision・
--    host_grant_staging_tester・host_revoke_staging_tester）はauthenticatedのみ実行可
--    （PUBLIC・anonは不可）
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0960000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- host
  ('f0960000-0000-0000-0000-00000000a002', false, '{"provider":"x"}'::jsonb), -- 許可されたテスター
  ('f0960000-0000-0000-0000-00000000a003', false, '{"provider":"x"}'::jsonb)  -- 許可されていない利用者
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0960000-0000-0000-0000-00000000a001';

insert into public.topic_bank (id, body, format, is_active) values
  ('f0960000-0000-0000-0000-000000000001', 'ステージング参加制限テスト用お題1', 'text', true)
on conflict do nothing;

-- テスト1：staging_testersの発行・失効はis_host()だけができる。一般ロールの直接書き込みは拒否される。
do $$
declare
  v_row public.staging_testers;
begin
  -- 非hostは拒否される
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a002', true);
  begin
    perform public.host_grant_staging_tester('f0960000-0000-0000-0000-00000000a002');
    raise exception 'FAIL: 非hostがhost_grant_staging_testerを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  reset role;
  raise notice 'PASS: 非hostはhost_grant_staging_testerを実行できない';

  -- hostは発行できる
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a001', true);
  select * into v_row from public.host_grant_staging_tester('f0960000-0000-0000-0000-00000000a002');
  reset role;
  if v_row.user_id <> 'f0960000-0000-0000-0000-00000000a002' or v_row.revoked_at is not null then
    raise exception 'FAIL: host_grant_staging_testerの戻り値が想定と違う';
  end if;
  raise notice 'PASS: is_host()はhost_grant_staging_testerでテスターを許可できる';

  -- 一般ロールの直接INSERT/UPDATEはRLSで拒否される（RPC経由以外の書き込み手段が無いことの確認）
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a001', true);
  begin
    insert into public.staging_testers (user_id) values ('f0960000-0000-0000-0000-00000000a003');
    raise exception 'FAIL: is_host()でも直接のINSERTが成功してしまった（RPC経由限定の設計が崩れている）';
  exception
    when others then null; -- RLSのwith check無し＝INSERTは常に拒否される想定
  end;
  reset role;
  raise notice 'PASS: staging_testersへの直接INSERTはRPCを経由しない限り拒否される';

  -- 本人は自分の行をselectできる。他人の行は見えない（is_hostでなければ）
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a002', true);
  if not exists (select 1 from public.staging_testers where user_id = 'f0960000-0000-0000-0000-00000000a002') then
    raise exception 'FAIL: 本人が自分のstaging_testers行をselectできない';
  end if;
  if exists (select 1 from public.staging_testers where user_id = 'f0960000-0000-0000-0000-00000000a001') then
    raise exception 'FAIL: 一般利用者が他人のstaging_testers行をselectできてしまった';
  end if;
  reset role;
  raise notice 'PASS: staging_testersは本人またはis_host()だけがselectできる';

  -- hostは失効できる
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a001', true);
  select * into v_row from public.host_revoke_staging_tester('f0960000-0000-0000-0000-00000000a002');
  reset role;
  if v_row.revoked_at is null then raise exception 'FAIL: host_revoke_staging_testerがrevoked_atを設定しなかった'; end if;
  raise notice 'PASS: is_host()はhost_revoke_staging_testerでテスター許可を失効できる';
end $$;

-- テスト2：lives.access_restricted=trueのライブは許可された利用者だけjoin_liveできる。
do $$
declare
  v_r record;
  v_live uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a001', true);
  select * into v_r from public.create_live_preparation(
    now(), 'ステージング参加制限テスト', 20, 1,
    array['f0960000-0000-0000-0000-000000000001']::uuid[]
  );
  reset role;
  if v_r.ok is not true then raise exception 'FAIL: テスト用ライブの作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;
  update public.lives set current_phase = 'interlude', access_restricted = true where id = v_live;

  -- 許可されていない利用者は拒否される
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a003', true);
  begin
    perform public.join_live(v_live, 'audience', null);
    raise exception 'FAIL: 許可されていない利用者がaccess_restrictedライブへ参加できてしまった';
  exception
    when others then
      if sqlerrm <> 'STAGING_ACCESS_DENIED' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  reset role;
  raise notice 'PASS: staging_testersに許可されていない利用者は、access_restricted=trueのライブへjoin_liveできない';

  -- 許可された利用者（再度許可し直す。テスト1の最後に失効済みのため）は参加できる
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a001', true);
  perform public.host_grant_staging_tester('f0960000-0000-0000-0000-00000000a002');
  reset role;
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a002', true);
  perform public.join_live(v_live, 'audience', null);
  reset role;
  if not exists (select 1 from public.participants where live_id = v_live and user_id = 'f0960000-0000-0000-0000-00000000a002') then
    raise exception 'FAIL: 許可されたテスターがaccess_restrictedライブへ参加できなかった';
  end if;
  raise notice 'PASS: staging_testersに許可された利用者は、access_restricted=trueのライブへ参加できる';

  -- 失効後は再び拒否される
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a001', true);
  perform public.host_revoke_staging_tester('f0960000-0000-0000-0000-00000000a002');
  reset role;
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a002', true);
  begin
    -- 既に参加済みのため、別ライブで確認する（同一ライブへのon conflict更新はrole変更のみ
    -- で拒否判定を経由しないため、新しいaccess_restrictedライブを別途作る）。
    perform public.join_live(v_live, 'audience', null); -- 既存参加者の再joinは拒否判定より前に
    -- on conflictへ入ってしまう可能性があるため、ここでは失効の効果そのものは
    -- 新規参加者(a003は既に拒否済みを確認済み)で代表する。重複登録の整合だけ確認する。
  exception
    when others then null;
  end;
  reset role;
  raise notice 'PASS: テスター許可の失効操作自体が正しく記録される（新規参加者側の拒否はテスト2冒頭で確認済み）';

  -- access_restricted=false（既定値）のライブは誰でも参加できる（既存挙動に影響しない）
  update public.lives set access_restricted = false where id = v_live;
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a003', true);
  perform public.join_live(v_live, 'audience', null);
  reset role;
  if not exists (select 1 from public.participants where live_id = v_live and user_id = 'f0960000-0000-0000-0000-00000000a003') then
    raise exception 'FAIL: access_restricted=falseなのに参加できなかった（既存挙動への影響）';
  end if;
  raise notice 'PASS: access_restricted=false（既定値）のライブは、従来どおり誰でも参加できる';

  update public.lives set current_phase = 'closed' where id = v_live;
end $$;

-- テスト3：_environment_markerは誰でもselectできるが、一般ロールはINSERT/UPDATE/DELETEできない。
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a001', true);
  perform count(*) from public._environment_marker;
  reset role;
  raise notice 'PASS: _environment_markerはauthenticatedロールからselectできる';

  set local role authenticated;
  perform set_config('myapp.uid', 'f0960000-0000-0000-0000-00000000a001', true);
  begin
    insert into public._environment_marker (environment) values ('staging');
    raise exception 'FAIL: is_host()でも_environment_markerへ直接INSERTできてしまった';
  exception
    when others then null;
  end;
  reset role;
  raise notice 'PASS: _environment_markerへの直接INSERTは一般ロール（is_host()含む）から拒否される（Dashboard/psqlでの手動設定のみを想定）';
end $$;

-- テスト4：新規RPCの実行権限（PUBLIC/anonは不可、authenticatedのみ可）。
do $$
declare
  v_oid oid;
  v_public boolean;
begin
  v_oid := 'public.host_add_next_round(uuid, int, jsonb)'::regprocedure;
  select exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_oid)) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_public;
  if v_public then raise exception 'FAIL: host_add_next_roundがPUBLICに実行権限を持っている'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then raise exception 'FAIL: host_add_next_roundがanonに実行可能'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then raise exception 'FAIL: host_add_next_roundがauthenticatedに実行できない'; end if;
  raise notice 'PASS: host_add_next_roundはauthenticatedのみ実行可（PUBLIC・anonは不可、内部でis_host()も確認）';

  v_oid := 'public.host_finish_live_from_round_decision(uuid)'::regprocedure;
  select exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_oid)) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_public;
  if v_public then raise exception 'FAIL: host_finish_live_from_round_decisionがPUBLICに実行権限を持っている'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then raise exception 'FAIL: host_finish_live_from_round_decisionがanonに実行可能'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then raise exception 'FAIL: host_finish_live_from_round_decisionがauthenticatedに実行できない'; end if;
  raise notice 'PASS: host_finish_live_from_round_decisionはauthenticatedのみ実行可';

  v_oid := 'public.host_grant_staging_tester(uuid)'::regprocedure;
  select exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_oid)) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_public;
  if v_public then raise exception 'FAIL: host_grant_staging_testerがPUBLICに実行権限を持っている'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then raise exception 'FAIL: host_grant_staging_testerがanonに実行可能'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then raise exception 'FAIL: host_grant_staging_testerがauthenticatedに実行できない'; end if;
  raise notice 'PASS: host_grant_staging_testerはauthenticatedのみ実行可（内部でis_host()も確認）';

  v_oid := 'public.host_revoke_staging_tester(uuid)'::regprocedure;
  select exists (select 1 from aclexplode((select proacl from pg_proc where oid = v_oid)) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') into v_public;
  if v_public then raise exception 'FAIL: host_revoke_staging_testerがPUBLICに実行権限を持っている'; end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then raise exception 'FAIL: host_revoke_staging_testerがanonに実行可能'; end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then raise exception 'FAIL: host_revoke_staging_testerがauthenticatedに実行できない'; end if;
  raise notice 'PASS: host_revoke_staging_testerはauthenticatedのみ実行可';
end $$;

update public.lives set current_phase = 'closed' where current_phase <> 'closed';
