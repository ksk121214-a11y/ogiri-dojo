-- 0084 回帰テスト：create_live_preparationの呼び出し方（5・6・7・8引数）が、どれも同じ2周制の処理になることを確認する。
--  - 実在するシグネチャは8引数版の1つだけ（5〜7引数版は0068・0073・0079でdrop済み）。
--    5〜7引数の呼び出しは、末尾のdefault引数で8引数版へ解決される。
--  - どの呼び出し方でも、必要お題数は組数×2。お題が1周分（組数と同数）なら作成時点で拒否する。
--  - 作成されたライブは rounds_per_live=2 で保存され、begin_gameで2周分（4ターン）が開始できる。
--    （作成できたのに開始できない中間状態を作らないことは、この各呼び出し方の開始確認で示す）
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0900000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- host
  ('f0900000-0000-0000-0000-00000000a011', false, '{"provider":"x"}'::jsonb)  -- player
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'f0900000-0000-0000-0000-00000000a001';

insert into public.topic_bank (id, body, format, is_active) values
  ('f0900000-0000-0000-0000-000000000001', '引数テスト用お題1', 'text', true),
  ('f0900000-0000-0000-0000-000000000002', '引数テスト用お題2', 'text', true),
  ('f0900000-0000-0000-0000-000000000003', '引数テスト用お題3', 'text', true),
  ('f0900000-0000-0000-0000-000000000004', '引数テスト用お題4', 'text', true)
on conflict do nothing;

-- 実在シグネチャは1つだけ（8引数・default引数3つ）であることを確認する
do $$
declare
  v_n int;
  v_args int;
  v_defaults int;
begin
  select count(*), max(p.pronargs), max(p.pronargdefaults) into v_n, v_args, v_defaults
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_live_preparation';
  if v_n <> 1 then raise exception 'FAIL: create_live_preparationの実在シグネチャが%件（1件のはず）', v_n; end if;
  if v_args <> 8 or v_defaults <> 3 then raise exception 'FAIL: 唯一のシグネチャが8引数・default3件ではない(args=%, defaults=%)', v_args, v_defaults; end if;
  raise notice 'PASS: create_live_preparationの実在シグネチャは8引数版（default引数3件）の1つだけ';
end $$;

-- 補助：作成したライブを開始し、ターン数と異なるお題数を返す（お題は作成時に登録済み）
create or replace function pg_temp.try_start(p_live uuid, out ok boolean, out reason text, out turns int, out distinct_topics int)
language plpgsql as $$
declare
  v_b record;
begin
  update public.lives set current_phase = 'opening' where id = p_live;
  insert into public.participants (live_id, user_id, role, preferred_role, is_guest, guest_number)
    values (p_live, 'f0900000-0000-0000-0000-00000000a011', 'player', 'player', false, null);
  perform set_config('myapp.uid', 'f0900000-0000-0000-0000-00000000a001', true);
  perform public.randomize_groups(p_live);
  select * into v_b from public.begin_game(p_live);
  ok := v_b.ok;
  reason := v_b.reason;
  select count(*)::int, count(distinct topic_id)::int into turns, distinct_topics from public.turns where live_id = p_live;
end $$;

-- 補助：作成を試みる（ホストとして）。戻り値は (ok, reason, live_id)
create or replace function pg_temp.create_as_host(p_args text) returns table (ok boolean, reason text, live_id uuid)
language plpgsql as $$
declare
  v_sql text;
begin
  perform set_config('myapp.uid', 'f0900000-0000-0000-0000-00000000a001', true);
  v_sql := 'select * from public.create_live_preparation(' || p_args || ')';
  return query execute v_sql;
end $$;

do $$
declare
  v_prev_counter int;
  v_t1 text := '''f0900000-0000-0000-0000-000000000001''';
  v_t2 text := '''f0900000-0000-0000-0000-000000000002''';
  v_t3 text := '''f0900000-0000-0000-0000-000000000003''';
  v_t4 text := '''f0900000-0000-0000-0000-000000000004''';
  v_four text;
  v_two text;
  v_three text;
  v_r record;
  v_live uuid;
  v_s record;
  v_row record;
begin
  select last_value into v_prev_counter from public.official_live_counter where id = true;
  v_four := format('array[%s,%s,%s,%s]::uuid[]', v_t1, v_t2, v_t3, v_t4);
  v_three := format('array[%s,%s,%s]::uuid[]', v_t1, v_t2, v_t3);
  v_two := format('array[%s,%s]::uuid[]', v_t1, v_t2);

  -- ==========================================================
  -- 5引数：now(), title, max, 組数, お題
  -- ==========================================================
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  perform set_config('myapp.uid', 'f0900000-0000-0000-0000-00000000a001', true);
  select * into v_r from pg_temp.create_as_host(format('now(), ''5引数(お題不足)'', 20, 2, %s', v_three)) x;
  if v_r.ok is not false or v_r.reason not like '%4件必要%' then
    raise exception 'FAIL: 5引数：2組にお題3件（1周半）で作成できてしまった(ok=%, reason=%)', v_r.ok, v_r.reason;
  end if;
  select * into v_r from pg_temp.create_as_host(format('now(), ''5引数(1周分)'', 20, 2, %s', v_two)) x;
  if v_r.ok is not false or v_r.reason not like '%4件必要%' then
    raise exception 'FAIL: 5引数：2組にお題2件（1周分）で作成できてしまった(reason=%)', v_r.reason;
  end if;
  select * into v_r from pg_temp.create_as_host(format('now(), ''5引数(2周分)'', 20, 2, %s', v_four)) x;
  if v_r.ok is not true then raise exception 'FAIL: 5引数：2組・お題4件（2周分）の作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;
  select * into v_row from public.lives where id = v_live;
  if v_row.rounds_per_live <> 2 or v_row.live_mode <> 'test' or v_row.timing_profile <> 'standard' or v_row.official_sequence_number is not null then
    raise exception 'FAIL: 5引数の作成結果が想定と違う(rounds=%, mode=%, timing=%)', v_row.rounds_per_live, v_row.live_mode, v_row.timing_profile;
  end if;
  select * into v_s from pg_temp.try_start(v_live);
  if v_s.ok is not true or v_s.turns <> 4 or v_s.distinct_topics <> 4 then
    raise exception 'FAIL: 5引数で作ったライブが2周分（4ターン・お題4件）で開始できない(ok=%, turns=%, reason=%)', v_s.ok, v_s.turns, v_s.reason;
  end if;
  update public.lives set current_phase = 'closed' where id = v_live;
  raise notice 'PASS: 5引数：お題が1周分・1周半は作成拒否、2周分は作成→rounds_per_live=2→開始まで2周（4ターン）';

  -- ==========================================================
  -- 6引数：…, 組数, お題, live_mode（本番は開催番号を自動採番）
  -- ==========================================================
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  select * into v_r from pg_temp.create_as_host(format('now(), ''6引数(1周分)'', 20, 2, %s, ''official''', v_two)) x;
  if v_r.ok is not false or v_r.reason not like '%4件必要%' then
    raise exception 'FAIL: 6引数：お題1周分で作成できてしまった(reason=%)', v_r.reason;
  end if;
  select * into v_r from pg_temp.create_as_host(format('now(), ''6引数(2周分)'', 20, 2, %s, ''official''', v_four)) x;
  if v_r.ok is not true then raise exception 'FAIL: 6引数：2周分の本番ライブ作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;
  select * into v_row from public.lives where id = v_live;
  if v_row.rounds_per_live <> 2 or v_row.live_mode <> 'official' or v_row.official_sequence_number is null then
    raise exception 'FAIL: 6引数の本番作成結果が想定と違う(rounds=%, mode=%, number=%)', v_row.rounds_per_live, v_row.live_mode, v_row.official_sequence_number;
  end if;
  select * into v_s from pg_temp.try_start(v_live);
  if v_s.ok is not true or v_s.turns <> 4 then raise exception 'FAIL: 6引数で作ったライブが2周（4ターン）で開始できない(reason=%)', v_s.reason; end if;
  update public.lives set current_phase = 'closed' where id = v_live;
  raise notice 'PASS: 6引数：お題1周分は作成拒否、2周分の本番ライブは開催番号を採番し、2周（4ターン）で開始できる';

  -- ==========================================================
  -- 7引数：…, live_mode, 手動の開催番号
  -- ==========================================================
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  select * into v_r from pg_temp.create_as_host(format('now(), ''7引数(1周分)'', 20, 2, %s, ''official'', 982090', v_two)) x;
  if v_r.ok is not false or v_r.reason not like '%4件必要%' then
    raise exception 'FAIL: 7引数：お題1周分で作成できてしまった(reason=%)', v_r.reason;
  end if;
  select * into v_r from pg_temp.create_as_host(format('now(), ''7引数(2周分)'', 20, 2, %s, ''official'', 982091', v_four)) x;
  if v_r.ok is not true then raise exception 'FAIL: 7引数：2周分の作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;
  select * into v_row from public.lives where id = v_live;
  if v_row.rounds_per_live <> 2 or v_row.official_sequence_number <> 982091 then
    raise exception 'FAIL: 7引数の作成結果が想定と違う(rounds=%, number=%)', v_row.rounds_per_live, v_row.official_sequence_number;
  end if;
  select * into v_s from pg_temp.try_start(v_live);
  if v_s.ok is not true or v_s.turns <> 4 then raise exception 'FAIL: 7引数で作ったライブが2周（4ターン）で開始できない(reason=%)', v_s.reason; end if;
  update public.lives set current_phase = 'closed' where id = v_live;
  raise notice 'PASS: 7引数：お題1周分は作成拒否、2周分は指定の開催番号で作成され、2周（4ターン）で開始できる';

  -- ==========================================================
  -- 8引数（完全形）：…, live_mode, 手動番号, timing_profile
  -- ==========================================================
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  select * into v_r from pg_temp.create_as_host(format('now(), ''8引数(1周分)'', 20, 2, %s, ''test'', null, ''short_test''', v_two)) x;
  if v_r.ok is not false or v_r.reason not like '%4件必要%' then
    raise exception 'FAIL: 8引数：お題1周分で作成できてしまった(reason=%)', v_r.reason;
  end if;
  select * into v_r from pg_temp.create_as_host(format('now(), ''8引数(2周分・短縮)'', 20, 2, %s, ''test'', null, ''short_test''', v_four)) x;
  if v_r.ok is not true then raise exception 'FAIL: 8引数：2周分の短縮テストライブの作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;
  select * into v_row from public.lives where id = v_live;
  if v_row.rounds_per_live <> 2 or v_row.timing_profile <> 'short_test' or v_row.live_mode <> 'test' then
    raise exception 'FAIL: 8引数の作成結果が想定と違う(rounds=%, timing=%)', v_row.rounds_per_live, v_row.timing_profile;
  end if;
  select * into v_s from pg_temp.try_start(v_live);
  if v_s.ok is not true or v_s.turns <> 4 then raise exception 'FAIL: 8引数で作ったライブが2周（4ターン）で開始できない(reason=%)', v_s.reason; end if;
  update public.lives set current_phase = 'closed' where id = v_live;
  raise notice 'PASS: 8引数：お題1周分は作成拒否、2周分の短縮テストライブは2周（4ターン）で開始できる';

  -- 後始末：本番の開催番号カウンターを元に戻す（7引数の手動番号の影響を残さない）
  update public.official_live_counter set last_value = v_prev_counter where id = true;
end $$;

update public.lives set current_phase = 'closed' where current_phase <> 'closed';
