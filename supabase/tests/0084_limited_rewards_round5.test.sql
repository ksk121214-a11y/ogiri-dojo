-- 0084 回帰テスト：限定特典（最初の目撃者・限定アイコン）の対象を本番開催番号#0001〜#0005へ拡張した
-- 挙動を検証する。mark_final_result_presence / grant_first_live_reward（内部の_apply_first_live_reward）を
-- 実際に呼び、対象判定・一度だけ付与・付与理由の開催番号化・通知の一件化・不正ケースの拒否を確認する。
-- 実行方法はsupabase/tests/run.sh参照（全*.test.sqlが同一DBを共有するため、既存の開催番号2〜6は
-- 試験専用の大きな番号へ退避してから使う。既存データの中身は変更しない）。

\set ON_ERROR_STOP on

-- ============================================================
-- フィクスチャ準備
-- ============================================================
do $$
declare
  v_n int;
begin
  -- 開催番号2〜6が既存テストで使われている場合は、番号だけを試験専用の大きな値へ退避する。
  for v_n in 2..6 loop
    update public.lives set official_sequence_number = 982000 + v_n
      where official_sequence_number = v_n;
  end loop;
  -- 非closedライブは全体で高々1件（lives_one_active_idx）。既存の残存ライブはclosedへ倒す。
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0840000-0000-0000-0000-00000000a100', false, '{"provider":"x"}'::jsonb), -- m1：#2〜#5に参加する一般会員（#2で獲得）
  ('f0840000-0000-0000-0000-00000000a101', false, '{"provider":"x"}'::jsonb), -- m2：#2で観客として参加（獲得）
  ('f0840000-0000-0000-0000-00000000a102', true,  '{"provider":"anonymous"}'::jsonb), -- g1：匿名ゲスト（対象外）
  ('f0840000-0000-0000-0000-00000000a103', false, '{"provider":"x"}'::jsonb), -- m3：#3で初めて参加（#3で獲得）
  ('f0840000-0000-0000-0000-00000000a104', false, '{"provider":"x"}'::jsonb), -- m4：#5に参加するが緊急中止（対象外）
  ('f0840000-0000-0000-0000-00000000a105', false, '{"provider":"x"}'::jsonb), -- m5：#4でキック済み（対象外）
  ('f0840000-0000-0000-0000-00000000a106', false, '{"provider":"x"}'::jsonb)  -- m6：#6に参加（対象外）
on conflict do nothing;

insert into auth.identities (user_id, provider) values
  ('f0840000-0000-0000-0000-00000000a100', 'x'),
  ('f0840000-0000-0000-0000-00000000a101', 'x'),
  ('f0840000-0000-0000-0000-00000000a103', 'x'),
  ('f0840000-0000-0000-0000-00000000a104', 'x'),
  ('f0840000-0000-0000-0000-00000000a105', 'x'),
  ('f0840000-0000-0000-0000-00000000a106', 'x')
on conflict do nothing;

-- ============================================================
-- ヘルパー：ライブを1本ずつ final_result で作り、参加者と到達記録を通す
-- ============================================================
create or replace function pg_temp.run_final(
  p_live_id uuid, p_seq int, p_mode text, p_emergency boolean
) returns void language plpgsql as $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  insert into public.lives (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published, emergency_closed)
  values (p_live_id, now(), 'final_result', p_mode, p_seq, false, p_emergency);
end $$;

-- 「#n」のライブを作り、指定ユーザーの参加登録を入れる（role/kicked は引数で指定）
create or replace function pg_temp.add_participant(
  p_live_id uuid, p_user_id uuid, p_role text, p_kicked boolean
) returns void language plpgsql as $$
begin
  insert into public.participants (live_id, user_id, role, preferred_role, is_guest, guest_number, kicked_at)
  values (p_live_id, p_user_id, p_role, p_role, false, null, case when p_kicked then now() else null end);
end $$;

-- ============================================================
-- テスト1：#2・#3・#4・#5が対象。#6・テスト・緊急中止・ゲスト・キック済みは対象外。
-- ============================================================
do $$
declare
  v_live2 uuid := 'f0840000-0000-0000-0000-00000000b002';
  v_live3 uuid := 'f0840000-0000-0000-0000-00000000b003';
  v_live4 uuid := 'f0840000-0000-0000-0000-00000000b004';
  v_live5 uuid := 'f0840000-0000-0000-0000-00000000b005';
  v_live6 uuid := 'f0840000-0000-0000-0000-00000000b006';
  v_test  uuid := 'f0840000-0000-0000-0000-00000000b007';
  v_r record;
  v_titles int;
begin
  -- 第2回：m1（player）・m2（audience）が最終結果へ到達。g1（ゲスト）はparticipantsにもいない扱い。
  perform pg_temp.run_final(v_live2, 2, 'official', false);
  perform pg_temp.add_participant(v_live2, 'f0840000-0000-0000-0000-00000000a100', 'player', false);
  perform pg_temp.add_participant(v_live2, 'f0840000-0000-0000-0000-00000000a101', 'audience', false);
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a100', true);
  perform public.mark_final_result_presence(v_live2, 'f0840000-0000-0000-0000-00000000a100');
  v_r := public.grant_first_live_reward(v_live2, 'f0840000-0000-0000-0000-00000000a100');
  if v_r.newly_granted is not true then raise exception 'FAIL: #2のm1に初回付与が起きない'; end if;
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a101', true);
  perform public.mark_final_result_presence(v_live2, 'f0840000-0000-0000-0000-00000000a101');
  v_r := public.grant_first_live_reward(v_live2, 'f0840000-0000-0000-0000-00000000a101');
  if v_r.newly_granted is not true then raise exception 'FAIL: #2の観客m2に付与が起きない（観客も対象のはず）'; end if;

  if not exists (select 1 from public.user_titles where user_id = 'f0840000-0000-0000-0000-00000000a100' and title_slug = 'first-witness' and granted_reason = 'official_0002_final_result') then
    raise exception 'FAIL: 付与理由がofficial_0002_final_resultになっていない';
  end if;
  if not exists (select 1 from public.user_limited_icons where user_id = 'f0840000-0000-0000-0000-00000000a101' and icon_slug = 'first-witness' and granted_reason = 'official_0002_final_result') then
    raise exception 'FAIL: 限定アイコンの付与理由がofficial_0002_final_resultになっていない';
  end if;
  raise notice 'PASS: 開催番号#2の最終結果到達者（プレイヤー・観客）が限定称号・限定アイコンの対象になり、理由に#0002が入る';

  perform pg_temp.run_final(v_live3, 3, 'official', false);
  -- 第3回：m1は既に獲得済み（再付与・再通知なし）。m3は初参加で獲得。
  perform pg_temp.add_participant(v_live3, 'f0840000-0000-0000-0000-00000000a100', 'player', false);
  perform pg_temp.add_participant(v_live3, 'f0840000-0000-0000-0000-00000000a103', 'player', false);
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a100', true);
  perform public.mark_final_result_presence(v_live3, 'f0840000-0000-0000-0000-00000000a100');
  v_r := public.grant_first_live_reward(v_live3, 'f0840000-0000-0000-0000-00000000a100');
  if v_r.newly_granted is not false then raise exception 'FAIL: 既に獲得済みのm1に#3で再付与された'; end if;
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a103', true);
  perform public.mark_final_result_presence(v_live3, 'f0840000-0000-0000-0000-00000000a103');
  v_r := public.grant_first_live_reward(v_live3, 'f0840000-0000-0000-0000-00000000a103');
  if v_r.newly_granted is not true then raise exception 'FAIL: #3で初参加のm3に付与されない'; end if;
  if not exists (select 1 from public.user_titles where user_id = 'f0840000-0000-0000-0000-00000000a100' and granted_reason = 'official_0002_final_result') then
    raise exception 'FAIL: 既存の所有行の付与理由(#0002)が#3の処理で書き換えられた';
  end if;
  if not exists (select 1 from public.user_titles where user_id = 'f0840000-0000-0000-0000-00000000a103' and granted_reason = 'official_0003_final_result') then
    raise exception 'FAIL: #3で獲得したm3の付与理由がofficial_0003_final_resultになっていない';
  end if;
  if (select count(*) from public.notifications where user_id = 'f0840000-0000-0000-0000-00000000a100' and type = 'first_live_reward') <> 1 then
    raise exception 'FAIL: m1に限定特典の通知が2件以上ある（重複通知）';
  end if;
  raise notice 'PASS: 既獲得者は#3で再付与・再通知されず、既存の付与理由も書き換わらない。#3で初めて参加した人は#0003の理由で獲得する';

  perform pg_temp.run_final(v_live4, 4, 'official', false);
  -- 第4回：m5はキック済み→到達記録を作れない。
  perform pg_temp.add_participant(v_live4, 'f0840000-0000-0000-0000-00000000a105', 'player', true);
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a105', true);
  begin
    perform public.mark_final_result_presence(v_live4, 'f0840000-0000-0000-0000-00000000a105');
    raise exception 'FAIL: キック済みのm5が#4の到達記録を作れてしまった';
  exception when others then
    if sqlerrm not like '%PARTICIPANT_KICKED%' then raise; end if;
  end;
  raise notice 'PASS: キック済みの利用者は#4の到達記録を作れず、限定特典の対象にならない';

  perform pg_temp.run_final(v_live5, 5, 'official', false);
  -- 第5回：限定特典の上限。m4は緊急中止の別ライブ(emerg)で扱うため、ここでは参加のみ。
  perform pg_temp.add_participant(v_live5, 'f0840000-0000-0000-0000-00000000a100', 'player', false);
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a100', true);
  perform public.mark_final_result_presence(v_live5, 'f0840000-0000-0000-0000-00000000a100');
  raise notice 'PASS: 開催番号#5（上限）の到達記録が作れる';

  -- 第6回：対象外（拒否される）
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  insert into public.lives (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
  values (v_live6, now(), 'final_result', 'official', 6, false);
  insert into public.participants (live_id, user_id, role, preferred_role, is_guest, guest_number, kicked_at)
  values (v_live6, 'f0840000-0000-0000-0000-00000000a106', 'player', 'player', false, null, null);
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a106', true);
  begin
    perform public.mark_final_result_presence(v_live6, 'f0840000-0000-0000-0000-00000000a106');
    raise exception 'FAIL: 開催番号#6の到達記録が作れてしまった';
  exception when others then
    if sqlerrm not like '%NOT_FIRST_OFFICIAL_LIVE%' then raise; end if;
  end;
  raise notice 'PASS: 開催番号#6は限定特典の対象外（到達記録が作られない）';

  -- テストライブ：対象外
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  insert into public.lives (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
  values (v_test, now(), 'final_result', 'test', null, false);
  insert into public.participants (live_id, user_id, role, preferred_role, is_guest, guest_number, kicked_at)
  values (v_test, 'f0840000-0000-0000-0000-00000000a106', 'player', 'player', false, null, null);
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a106', true);
  begin
    perform public.mark_final_result_presence(v_test, 'f0840000-0000-0000-0000-00000000a106');
    raise exception 'FAIL: テストライブの到達記録が作れてしまった';
  exception when others then
    if sqlerrm not like '%NOT_FIRST_OFFICIAL_LIVE%' then raise; end if;
  end;
  raise notice 'PASS: テストライブ（official以外）は限定特典の対象外';

  -- 緊急中止：対象外
  -- 開催番号は1〜5が一意のため、#5の行を一時的に緊急中止にして確認する（別行は作らない）。
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  update public.lives set current_phase = 'final_result', emergency_closed = true where id = v_live5;
  perform pg_temp.add_participant(v_live5, 'f0840000-0000-0000-0000-00000000a104', 'player', false);
  perform set_config('myapp.uid', 'f0840000-0000-0000-0000-00000000a104', true);
  begin
    perform public.mark_final_result_presence(v_live5, 'f0840000-0000-0000-0000-00000000a104');
    raise exception 'FAIL: 緊急中止されたライブの到達記録が作れてしまった';
  exception when others then
    if sqlerrm not like '%LIVE_EMERGENCY_CLOSED%' then raise; end if;
  end;
  raise notice 'PASS: 緊急中止されたライブは対象外';

  -- 匿名ゲストは到達記録が作れない（参加登録があっても対象外）
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  select count(*) into v_titles from public.user_titles where user_id = 'f0840000-0000-0000-0000-00000000a102';
  if v_titles <> 0 then raise exception 'FAIL: 匿名ゲストに限定称号が付与されている'; end if;
  raise notice 'PASS: 匿名ゲストには限定称号が付与されていない';
end $$;
