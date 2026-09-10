-- 0066 回帰テスト：ホスト専用 RPC host_send_bot_tsukkomi の
-- 権限・入力検証・レート制限・なりすまし拒否、および人間用 send_tsukkomi の
-- 非退行を確認する。実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('a6000000-0000-0000-0000-00000000000a'), -- player1（liveA）
  ('a6000000-0000-0000-0000-00000000000b'), -- player2（liveA）
  ('a6000000-0000-0000-0000-00000000000c'), -- player3（liveA）
  ('a6000000-0000-0000-0000-00000000000d'), -- player4（liveA）
  ('a6000000-0000-0000-0000-00000000000e'), -- player（liveB）
  ('a6000000-0000-0000-0000-0000000000ff'), -- 非host（一般ユーザー）
  ('a6000000-0000-0000-0000-00000000000f')  -- admin（=host、liveAのplayerも兼ねる）
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a6000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a6100000-0000-0000-0000-000000000001', '0066テスト用お題A1', 'text', true),
  ('a6100000-0000-0000-0000-000000000002', '0066テスト用お題A2', 'text', true),
  ('a6100000-0000-0000-0000-000000000003', '0066テスト用お題B1', 'text', true),
  ('a6100000-0000-0000-0000-000000000004', '0066テスト用お題B2', 'text', true)
on conflict do nothing;

-- ライブB を先に作って参加者を1人 player にしてから closed にする
-- （「別ライブの参加者を代理送信者に指定できない」検証用。create_live_preparation は
--  非closed のライブが1つでもあると新規作成を弾くため、A より先に用意して閉じる）。
do $$
declare
  v_live_b uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_b from public.create_live_preparation(
    now(), '0066テストB', 20, 2,
    array['a6100000-0000-0000-0000-000000000003', 'a6100000-0000-0000-0000-000000000004']::uuid[]
  );
  update public.lives set current_phase = 'opening' where id = v_live_b;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000e', true);
  perform public.join_live(v_live_b, 'player', null);
  reset role;
  update public.participants set role = 'player'
    where live_id = v_live_b and user_id = 'a6000000-0000-0000-0000-00000000000e';
  update public.lives set current_phase = 'closed' where id = v_live_b;
end $$;

-- ライブA：4人 + admin が player 参加 → randomize → begin_game → answering へ。
do $$
declare
  v_live_a uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_a from public.create_live_preparation(
    now(), '0066テストA', 20, 2,
    array['a6100000-0000-0000-0000-000000000001', 'a6100000-0000-0000-0000-000000000002']::uuid[]
  );
  update public.lives set current_phase = 'opening' where id = v_live_a;

  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_a, 'player', null);
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_a, 'player', null);
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000c', true);
  perform public.join_live(v_live_a, 'player', null);
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000d', true);
  perform public.join_live(v_live_a, 'player', null);
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  perform public.join_live(v_live_a, 'player', null); -- admin も liveA の player

  perform public.randomize_groups(v_live_a);
  perform public.begin_game(v_live_a);
end $$;

-- 回答受付中へ（このRPCは current_phase = 'answering' のときだけ送信可）。
do $$
declare
  v_live_a uuid;
  v_turn_a uuid;
begin
  select id into v_live_a from public.lives where title = '0066テストA';
  select id into v_turn_a from public.turns where live_id = v_live_a and status = 'active' limit 1;
  update public.lives set current_phase = 'answering', current_turn_id = v_turn_a where id = v_live_a;
end $$;

create temporary table _t0066_ctx as
select
  la.id as live_a_id,
  lb.id as live_b_id,
  (select p.id from public.participants p
     where p.live_id = la.id and p.user_id = 'a6000000-0000-0000-0000-00000000000a' and p.role = 'player') as bot_a1,
  (select p.id from public.participants p
     where p.live_id = la.id and p.user_id = 'a6000000-0000-0000-0000-00000000000b' and p.role = 'player') as bot_a2,
  (select p.id from public.participants p
     where p.live_id = la.id and p.user_id = 'a6000000-0000-0000-0000-00000000000c' and p.role = 'player') as bot_a3,
  (select p.id from public.participants p
     where p.live_id = la.id and p.user_id = 'a6000000-0000-0000-0000-00000000000f' and p.role = 'player') as admin_participant_a,
  (select p.id from public.participants p
     where p.live_id = lb.id and p.user_id = 'a6000000-0000-0000-0000-00000000000e' and p.role = 'player') as participant_b
from public.lives la, public.lives lb
where la.title = '0066テストA' and lb.title = '0066テストB';

grant select on _t0066_ctx to authenticated, anon;

do $$
declare
  r record;
begin
  select * into r from _t0066_ctx;
  if r.bot_a1 is null or r.bot_a2 is null or r.bot_a3 is null
     or r.admin_participant_a is null or r.participant_b is null then
    raise exception 'FAIL: テスト前提の参加者を特定できなかった (%,%,%,%,%)',
      r.bot_a1, r.bot_a2, r.bot_a3, r.admin_participant_a, r.participant_b;
  end if;
end $$;

reset role;

-- ============================================================
-- テスト0: PUBLIC / anon は EXECUTE 権限を持たない。
-- ============================================================
do $$
begin
  if has_function_privilege('public', 'host_send_bot_tsukkomi(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: PUBLIC が host_send_bot_tsukkomi の EXECUTE を持っている';
  end if;
  if has_function_privilege('anon', 'host_send_bot_tsukkomi(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon が host_send_bot_tsukkomi の EXECUTE を持っている';
  end if;
  raise notice 'PASS: PUBLIC/anon は host_send_bot_tsukkomi の EXECUTE 権限を持たない';
end $$;

-- ============================================================
-- テスト0b: anon は実際に呼び出しても到達できない (insufficient_privilege)。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  set local role anon;
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.bot_a1, 'clap', '👏');
    raise exception 'FAIL: anon が host_send_bot_tsukkomi を実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon は host_send_bot_tsukkomi に到達できない (insufficient_privilege)';
  end;
end $$;

-- ============================================================
-- テスト1: 非host（一般authenticatedユーザー）は NOT_AUTHORIZED で拒否される。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-0000000000ff', true);
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.bot_a1, 'clap', '👏');
    raise exception 'FAIL: 非host が host_send_bot_tsukkomi を実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_AUTHORIZED' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
      raise notice 'PASS: 非host は host_send_bot_tsukkomi を実行できない (NOT_AUTHORIZED)';
  end;
end $$;

-- ============================================================
-- テスト2: host が正当な引数で呼ぶと成功し、live_tsukkomi_events へ1行 INSERT される。
-- ============================================================
do $$
declare
  ctx record;
  v_before int;
  v_after int;
begin
  select * into ctx from _t0066_ctx;
  select count(*) into v_before from public.live_tsukkomi_events where live_id = ctx.live_a_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.bot_a1, 'stamp', 'なんでやねん');

  reset role;
  select count(*) into v_after from public.live_tsukkomi_events where live_id = ctx.live_a_id;
  if v_after <> v_before + 1 then
    raise exception 'FAIL: live_tsukkomi_events へ INSERT されていない (before=%, after=%)', v_before, v_after;
  end if;
  if not exists (
    select 1 from public.live_tsukkomi_events
    where live_id = ctx.live_a_id and participant_id = ctx.bot_a1
      and kind = 'stamp' and text = 'なんでやねん'
  ) then
    raise exception 'FAIL: 送信内容が保存されていない';
  end if;
  raise notice 'PASS: host が正当な引数で呼ぶと live_tsukkomi_events へ届く';
end $$;

-- ============================================================
-- テスト3: サーバー側レート制限（ライブ単位・1秒に1回）。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  -- 直前（テスト2）の送信から1秒未満での2回目は弾かれる。
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.bot_a2, 'clap', '👏');
    raise exception 'FAIL: レート制限が働かず連続送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'RATE_LIMITED' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
      raise notice 'PASS: サーバー側レート制限が働く (RATE_LIMITED)';
  end;
end $$;

-- ============================================================
-- テスト4: 不正な kind/text は INVALID_TSUKKOMI で拒否される。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  -- レート制限に引っかからないよう last_bot_tsukkomi_at を巻き戻す。
  update public.lives set last_bot_tsukkomi_at = now() - interval '10 seconds' where id = ctx.live_a_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.bot_a1, 'stamp', '任意の自由入力テキスト');
    raise exception 'FAIL: 許可リスト外の text を送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'INVALID_TSUKKOMI' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.bot_a1, 'boo', '👏');
    raise exception 'FAIL: 不正な kind を送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'INVALID_TSUKKOMI' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  raise notice 'PASS: 不正な kind/text は DB 側で拒否される (INVALID_TSUKKOMI)';
end $$;

-- ============================================================
-- テスト5: 別ライブの参加者・退場者・存在しないID・運営者本人 は
--          代理送信者に指定できない（INVALID_SENDER）。
-- ============================================================
do $$
declare
  ctx record;
  v_kicked uuid;
begin
  select * into ctx from _t0066_ctx;
  update public.lives set last_bot_tsukkomi_at = now() - interval '10 seconds' where id = ctx.live_a_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);

  -- (a) 別ライブ（liveB）の参加者
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.participant_b, 'clap', '👏');
    raise exception 'FAIL: 別ライブの参加者を代理送信者に指定できてしまった';
  exception when others then
    if sqlerrm <> 'INVALID_SENDER' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  -- (b) 存在しない participant_id
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, gen_random_uuid(), 'clap', '👏');
    raise exception 'FAIL: 存在しない participant_id で送信できてしまった';
  exception when others then
    if sqlerrm <> 'INVALID_SENDER' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  -- (c) 運営者本人（user_id = auth.uid()）の participant
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.admin_participant_a, 'clap', '👏');
    raise exception 'FAIL: 運営者本人の participant を代理送信者に指定できてしまった';
  exception when others then
    if sqlerrm <> 'INVALID_SENDER' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  -- (d) 退場済み参加者
  reset role;
  update public.participants set kicked_at = now() where id = ctx.bot_a3;
  v_kicked := ctx.bot_a3;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, v_kicked, 'clap', '👏');
    raise exception 'FAIL: 退場済み参加者を代理送信者に指定できてしまった';
  exception when others then
    if sqlerrm <> 'INVALID_SENDER' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  reset role;
  update public.participants set kicked_at = null where id = ctx.bot_a3;

  raise notice 'PASS: 別ライブ/存在しない/運営者本人/退場者 は代理送信者に指定できない (INVALID_SENDER)';
end $$;

-- ============================================================
-- テスト6: 送信可能な状態でないライブ（answering 以外）は LIVE_NOT_SENDABLE。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  update public.lives set current_phase = 'group_result',
    last_bot_tsukkomi_at = now() - interval '10 seconds' where id = ctx.live_a_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.host_send_bot_tsukkomi(ctx.live_a_id, ctx.bot_a1, 'clap', '👏');
    raise exception 'FAIL: answering 以外のフェーズで送信できてしまった';
  exception when others then
    if sqlerrm <> 'LIVE_NOT_SENDABLE' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  reset role;
  update public.lives set current_phase = 'answering' where id = ctx.live_a_id;
  raise notice 'PASS: answering 以外のフェーズでは送信できない (LIVE_NOT_SENDABLE)';
end $$;

-- ============================================================
-- テスト7: live_tsukkomi_events への直接 INSERT は一般ユーザーに許可されていない。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true); -- 一般参加者
  begin
    insert into public.live_tsukkomi_events (live_id, participant_id, kind, text)
      values (ctx.live_a_id, ctx.bot_a1, 'clap', '👏');
    raise exception 'FAIL: 一般ユーザーが live_tsukkomi_events へ直接 INSERT できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: live_tsukkomi_events への直接 INSERT は拒否される (insufficient_privilege)';
    when others then
      -- RLS で 42501 以外（例：new row violates row-level security）になる環境も許容。
      if sqlerrm not ilike '%row-level security%' and sqlerrm not ilike '%permission denied%' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
      raise notice 'PASS: live_tsukkomi_events への直接 INSERT は拒否される (RLS)';
  end;
end $$;

-- ============================================================
-- テスト8: 人間用 send_tsukkomi は非退行（そのライブの参加者は従来どおり送れる）。
-- ============================================================
do $$
declare
  ctx record;
  v_before int;
  v_after int;
begin
  select * into ctx from _t0066_ctx;
  update public.participants set last_tsukkomi_at = null
    where id in (ctx.bot_a2);
  select count(*) into v_before from public.live_tsukkomi_events where live_id = ctx.live_a_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000b', true); -- liveA の参加者本人
  perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏');

  reset role;
  select count(*) into v_after from public.live_tsukkomi_events where live_id = ctx.live_a_id;
  if v_after <> v_before + 1 then
    raise exception 'FAIL: 人間用 send_tsukkomi が動かなくなっている (before=%, after=%)', v_before, v_after;
  end if;
  raise notice 'PASS: 人間用 send_tsukkomi は非退行（従来どおり送れる）';
end $$;

drop table _t0066_ctx;

select 'ALL 0066 TESTS PASSED' as result;
