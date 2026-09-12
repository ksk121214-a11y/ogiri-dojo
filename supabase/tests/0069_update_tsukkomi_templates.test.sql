-- 0069 回帰テスト：ツッコミ定型文の新旧移行期間対応。
-- - 新しい2文言（「アホか！」「上手いこと言うな」）を送信できる
-- - 移行期間中は旧2文言（「そうはならんやろ」「それは無理あるて」）も送信できる
--   （画面には出していないが、フロント反映前の古い画面からの送信を拒否しない）
-- - 任意の自由入力は引き続き拒否される
-- - 0066由来の防御（権限・レート制限・退場者拒否）が0069のCREATE OR REPLACE後も
--   維持されている
-- 0066自体の網羅的な回帰（anon拒否・非参加者拒否・フェーズ確認・
-- ロック順序・live_tsukkomi_eventsへの直接INSERT拒否等）は
-- supabase/tests/0066_send_tsukkomi_hardening.test.sql が引き続き検証する
-- （0069はそちらを壊していないことを前提に、ここでは文言まわりに絞る）。
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('a6900000-0000-0000-0000-00000000000a'), -- playerX（liveA）
  ('a6900000-0000-0000-0000-00000000000b'), -- playerY（liveA・途中で退場させる）
  ('a6900000-0000-0000-0000-0000000000ff')  -- liveAに参加していない一般ユーザー
on conflict do nothing;

insert into public.topic_bank (id, body, format, is_active) values
  ('a6910000-0000-0000-0000-000000000001', '0069テスト用お題1', 'text', true),
  ('a6910000-0000-0000-0000-000000000002', '0069テスト用お題2', 'text', true)
on conflict do nothing;

insert into auth.users (id) values
  ('a6900000-0000-0000-0000-00000000000f')
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a6900000-0000-0000-0000-00000000000f';

do $$
declare
  v_live_a uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_a from public.create_live_preparation(
    now(), '0069テストA', 20, 2,
    array['a6910000-0000-0000-0000-000000000001', 'a6910000-0000-0000-0000-000000000002']::uuid[]
  );
  update public.lives set current_phase = 'opening' where id = v_live_a;

  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_a, 'player', null);
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_a, 'player', null);
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000f', true);
  perform public.join_live(v_live_a, 'player', null);

  perform public.randomize_groups(v_live_a);
  perform public.begin_game(v_live_a);
end $$;

do $$
declare
  v_live_a uuid;
  v_turn_a uuid;
begin
  select id into v_live_a from public.lives where title = '0069テストA';
  select id into v_turn_a from public.turns where live_id = v_live_a and status = 'active' limit 1;
  update public.lives set current_phase = 'answering', current_turn_id = v_turn_a where id = v_live_a;
end $$;

create temporary table _t0069_ctx as
select
  la.id as live_a_id,
  (select p.id from public.participants p
     where p.live_id = la.id and p.user_id = 'a6900000-0000-0000-0000-00000000000b') as player_y_id
from public.lives la
where la.title = '0069テストA';

grant select on _t0069_ctx to authenticated, anon;

do $$
declare
  r record;
begin
  select * into r from _t0069_ctx;
  if r.live_a_id is null or r.player_y_id is null then
    raise exception 'FAIL: テスト前提の参加者を特定できなかった (%,%)', r.live_a_id, r.player_y_id;
  end if;
end $$;

reset role;

-- ============================================================
-- テスト1: 新しい2文言を送信できる。
-- ============================================================
do $$
declare
  ctx record;
  v_count int;
begin
  select * into ctx from _t0069_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000a', true);

  perform public.send_tsukkomi(ctx.live_a_id, 'stamp', 'アホか！');
  select count(*) into v_count from public.live_tsukkomi_events
    where live_id = ctx.live_a_id and kind = 'stamp' and text = 'アホか！';
  if v_count <> 1 then
    raise exception 'FAIL: 新文言「アホか！」が送信できなかった';
  end if;
  raise notice 'PASS: 新文言「アホか！」を送信できる';
end $$;

do $$
declare
  ctx record;
  v_count int;
begin
  select * into ctx from _t0069_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000f', true);

  perform public.send_tsukkomi(ctx.live_a_id, 'stamp', '上手いこと言うな');
  select count(*) into v_count from public.live_tsukkomi_events
    where live_id = ctx.live_a_id and kind = 'stamp' and text = '上手いこと言うな';
  if v_count <> 1 then
    raise exception 'FAIL: 新文言「上手いこと言うな」が送信できなかった';
  end if;
  raise notice 'PASS: 新文言「上手いこと言うな」を送信できる';
end $$;

-- ============================================================
-- テスト2: 移行期間中は旧2文言も送信できる（1秒レート制限を避けるため、
-- 別の参加者アカウントを使う）。
-- ============================================================
do $$
declare
  ctx record;
  v_count int;
begin
  select * into ctx from _t0069_ctx;
  set local role authenticated;
  -- player_y（このテストファイル内ではまだ何も送信していない未使用の参加者）を使う。
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000b', true);

  perform public.send_tsukkomi(ctx.live_a_id, 'stamp', 'そうはならんやろ');
  select count(*) into v_count from public.live_tsukkomi_events
    where live_id = ctx.live_a_id and kind = 'stamp' and text = 'そうはならんやろ';
  if v_count <> 1 then
    raise exception 'FAIL: 移行期間中の旧文言「そうはならんやろ」が送信できなかった';
  end if;
  raise notice 'PASS: 移行期間中は旧文言「そうはならんやろ」も送信できる';
end $$;

-- 直前のテスト1でこのユーザー(a)は既に送信済みのため、1秒レート制限に
-- 引っかからないよう少し待つ（実クロックのpg_sleep、テスト専用の割り切り）。
-- 注意：do $$ ... end $$ ブロックの内側でpg_sleepしても、plpgsqlのnow()
-- （=transaction_timestamp()）はそのブロック＝トランザクションの開始時刻に
-- 固定されたままなので意味が無い（sleep後もnow()は進まない）。必ずこの
-- ブロックの外側・別の top-level 文として実行し、次のdo $$ブロックが新しい
-- トランザクションとして開始される時にはじめて経過時間が反映されるようにする。
select pg_sleep(1.05);

do $$
declare
  ctx record;
  v_count int;
begin
  select * into ctx from _t0069_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000a', true);

  perform public.send_tsukkomi(ctx.live_a_id, 'stamp', 'それは無理あるて');
  select count(*) into v_count from public.live_tsukkomi_events
    where live_id = ctx.live_a_id and kind = 'stamp' and text = 'それは無理あるて';
  if v_count <> 1 then
    raise exception 'FAIL: 移行期間中の旧文言「それは無理あるて」が送信できなかった';
  end if;
  raise notice 'PASS: 移行期間中は旧文言「それは無理あるて」も送信できる';
end $$;

-- ============================================================
-- テスト3: 任意の自由入力は引き続き拒否される（許可リスト完全一致の維持）。
-- ============================================================
-- 直前のこのユーザー(f)の送信からのレート制限を避ける
-- （do $$ブロックの外側で行う理由は上のコメント参照）。
select pg_sleep(1.05);

do $$
declare
  ctx record;
begin
  select * into ctx from _t0069_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000f', true);

  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'stamp', 'ここに自由入力の攻撃文字列');
    raise exception 'FAIL: 許可リストに無い自由入力が送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'INVALID_TSUKKOMI' then
        raise exception 'FAIL: 自由入力拒否時のエラーがINVALID_TSUKKOMIではない (%)', sqlerrm;
      end if;
      raise notice 'PASS: 許可リストに無い自由入力は引き続き拒否される（INVALID_TSUKKOMI）';
  end;
end $$;

-- ============================================================
-- テスト4: 権限境界の維持（PUBLIC/anonはEXECUTEできない）。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0069_ctx;
  if has_function_privilege('public', 'send_tsukkomi(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: PUBLIC が send_tsukkomi の EXECUTE を持っている';
  end if;
  if has_function_privilege('anon', 'send_tsukkomi(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon が send_tsukkomi の EXECUTE を持っている';
  end if;

  set local role anon;
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏');
    raise exception 'FAIL: anon が send_tsukkomi を実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 0069適用後もanonはsend_tsukkomiに到達できない（権限境界の維持）';
  end;
end $$;

-- ============================================================
-- テスト5: 1人1秒のレート制限が維持されている。
-- ============================================================
-- 直前のこのユーザー(b)の送信からのレート制限を避ける
-- （do $$ブロックの外側で行う理由は上のコメント参照）。
select pg_sleep(1.05);

do $$
declare
  ctx record;
  v_count int;
begin
  select * into ctx from _t0069_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000b', true);

  perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏');
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏'); -- 直後の連打
    raise exception 'FAIL: 1秒以内の連打がRATE_LIMITEDで拒否されなかった';
  exception
    when others then
      if sqlerrm <> 'RATE_LIMITED' then
        raise exception 'FAIL: 連打拒否時のエラーがRATE_LIMITEDではない (%)', sqlerrm;
      end if;
      raise notice 'PASS: 0069適用後も1人1秒のレート制限が維持されている';
  end;
  select count(*) into v_count from public.live_tsukkomi_events
    where live_id = ctx.live_a_id and kind = 'clap' and text = '👏';
  if v_count <> 1 then
    raise exception 'FAIL: レート制限テストで送信されたイベント件数が想定と違う(%)', v_count;
  end if;
end $$;

-- ============================================================
-- テスト6: 退場済み参加者は拒否される（NOT_A_PARTICIPANT）。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0069_ctx;
  update public.participants set kicked_at = now() where id = ctx.player_y_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a6900000-0000-0000-0000-00000000000b', true);
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'stamp', 'アホか！');
    raise exception 'FAIL: 退場済み参加者が送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_A_PARTICIPANT' then
        raise exception 'FAIL: 退場済み参加者拒否時のエラーがNOT_A_PARTICIPANTではない (%)', sqlerrm;
      end if;
      raise notice 'PASS: 0069適用後も退場済み参加者は拒否される（NOT_A_PARTICIPANT）';
  end;
end $$;

reset role;

do $$
begin
  raise notice 'ALL 0069 TSUKKOMI TEMPLATE MIGRATION TESTS PASSED';
end $$;
