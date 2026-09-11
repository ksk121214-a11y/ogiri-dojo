-- 0066 回帰テスト（撤回・修正後）：
-- - host_send_bot_tsukkomi は廃止され、代理送信者(participant_id)をクライアントから
--   指定できる入口自体が存在しないこと
-- - 既存の一般参加者用 send_tsukkomi が、退場済み参加者・非参加者・answering以外の
--   フェーズ・NULL/不正なkind・text・レート制限をDB側で確実に拒否すること
-- - 正常な参加者本人はanswering中に送信でき、そのときだけイベントが1件作られること
-- - PUBLIC/anonはEXECUTEできず、live_tsukkomi_eventsへの直接INSERTも拒否されること
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

-- ============================================================
-- テスト0: host_send_bot_tsukkomi は存在しない（代理送信者を指定できる入口が無い）。
-- send_tsukkomi の引数は (uuid, text, text) のみで participant_id を受け取らない。
-- ============================================================
do $$
begin
  if to_regprocedure('public.host_send_bot_tsukkomi(uuid,uuid,text,text)') is not null then
    raise exception 'FAIL: host_send_bot_tsukkomi がまだ存在している（廃止したはず）';
  end if;
  if to_regprocedure('public.send_tsukkomi(uuid,uuid,text,text)') is not null then
    raise exception 'FAIL: send_tsukkomi が participant_id を受け取る形で存在している（なりすまし経路）';
  end if;
  if to_regprocedure('public.send_tsukkomi(uuid,text,text)') is null then
    raise exception 'FAIL: send_tsukkomi(uuid,text,text) が見つからない';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lives' and column_name = 'last_bot_tsukkomi_at'
  ) then
    raise exception 'FAIL: lives.last_bot_tsukkomi_at がまだ存在している（廃止したはず）';
  end if;
  raise notice 'PASS: 代理送信者(participant_id)を指定できる入口が存在しない';
end $$;

insert into auth.users (id) values
  ('a6000000-0000-0000-0000-00000000000a'), -- playerX（liveA）
  ('a6000000-0000-0000-0000-00000000000b'), -- playerY（liveA・退場予定）
  ('a6000000-0000-0000-0000-0000000000ff')  -- liveAに参加していない一般ユーザー
on conflict do nothing;

insert into public.topic_bank (id, body, format, is_active) values
  ('a6100000-0000-0000-0000-000000000001', '0066テスト用お題1', 'text', true),
  ('a6100000-0000-0000-0000-000000000002', '0066テスト用お題2', 'text', true)
on conflict do nothing;

-- admin（host）を1人用意して create_live_preparation / begin_game を回す。
insert into auth.users (id) values
  ('a6000000-0000-0000-0000-00000000000f')
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a6000000-0000-0000-0000-00000000000f';

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
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000f', true);
  perform public.join_live(v_live_a, 'player', null);

  perform public.randomize_groups(v_live_a);
  perform public.begin_game(v_live_a);
end $$;

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
  (select p.id from public.participants p
     where p.live_id = la.id and p.user_id = 'a6000000-0000-0000-0000-00000000000b') as player_y_id
from public.lives la
where la.title = '0066テストA';

grant select on _t0066_ctx to authenticated, anon;

do $$
declare
  r record;
begin
  select * into r from _t0066_ctx;
  if r.live_a_id is null or r.player_y_id is null then
    raise exception 'FAIL: テスト前提の参加者を特定できなかった (%,%)', r.live_a_id, r.player_y_id;
  end if;
end $$;

reset role;

-- ============================================================
-- テスト1: PUBLIC / anon は EXECUTE 権限を持たず、実行しても到達できない。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
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
      raise notice 'PASS: anon は send_tsukkomi に到達できない (insufficient_privilege)';
  end;
end $$;

-- ============================================================
-- テスト2: 非参加者（liveAに参加していない一般ユーザー）は NOT_A_PARTICIPANT。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-0000000000ff', true);
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏');
    raise exception 'FAIL: 非参加者が送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_A_PARTICIPANT' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
      raise notice 'PASS: 非参加者は送信できない (NOT_A_PARTICIPANT)';
  end;
end $$;

-- ============================================================
-- テスト3: NULLのkind/textは明示的にINVALID_TSUKKOMIで拒否される。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
  begin
    perform public.send_tsukkomi(ctx.live_a_id, null, null);
    raise exception 'FAIL: kind/textがNULLでも送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'INVALID_TSUKKOMI' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'clap', null);
    raise exception 'FAIL: textがNULLでも送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'INVALID_TSUKKOMI' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  raise notice 'PASS: NULLのkind/textはINVALID_TSUKKOMIで拒否される';
end $$;

-- ============================================================
-- テスト4: 許可リスト外のkind/textはINVALID_TSUKKOMIで拒否される。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'stamp', '任意の自由入力テキスト');
    raise exception 'FAIL: 許可リスト外のtextを送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'INVALID_TSUKKOMI' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'boo', '👏');
    raise exception 'FAIL: 不正なkindを送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'INVALID_TSUKKOMI' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  raise notice 'PASS: 許可リスト外のkind/textはINVALID_TSUKKOMIで拒否される';
end $$;

-- ============================================================
-- テスト5: answering以外のフェーズはLIVE_NOT_SENDABLEで拒否される。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  update public.lives set current_phase = 'group_result' where id = ctx.live_a_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏');
    raise exception 'FAIL: answering以外のフェーズで送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'LIVE_NOT_SENDABLE' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  reset role;
  update public.lives set current_phase = 'answering' where id = ctx.live_a_id;
  raise notice 'PASS: answering以外のフェーズでは送信できない (LIVE_NOT_SENDABLE)';
end $$;

-- ============================================================
-- テスト6: 対象ライブが存在しない場合はLIVE_NOT_FOUND。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
  begin
    perform public.send_tsukkomi(gen_random_uuid(), 'clap', '👏');
    raise exception 'FAIL: 存在しないliveへ送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'LIVE_NOT_FOUND' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 存在しないliveはLIVE_NOT_FOUNDで拒否される';
  end;
end $$;

-- ============================================================
-- テスト7: 退場済み参加者（kicked_at設定済み）はNOT_A_PARTICIPANTで拒否される。
-- ============================================================
do $$
declare
  ctx record;
begin
  select * into ctx from _t0066_ctx;
  update public.participants set kicked_at = now() where id = ctx.player_y_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000b', true);
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏');
    raise exception 'FAIL: 退場済み参加者が送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_A_PARTICIPANT' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  reset role;
  update public.participants set kicked_at = null where id = ctx.player_y_id;
  raise notice 'PASS: 退場済み参加者は送信できない (NOT_A_PARTICIPANT)';
end $$;

-- ============================================================
-- テスト8: 正常な参加者本人はanswering中に送信でき、そのときだけイベントが
--          1件作られる。かつ1秒以内の連打はRATE_LIMITEDで拒否される。
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
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
  perform public.send_tsukkomi(ctx.live_a_id, 'stamp', 'なんでやねん');

  reset role;
  select count(*) into v_after from public.live_tsukkomi_events where live_id = ctx.live_a_id;
  if v_after <> v_before + 1 then
    raise exception 'FAIL: 正常送信でイベントが1件だけ作られていない (before=%, after=%)', v_before, v_after;
  end if;
  if not exists (
    select 1 from public.live_tsukkomi_events
    where live_id = ctx.live_a_id and kind = 'stamp' and text = 'なんでやねん'
      and participant_id = (
        select id from public.participants
        where live_id = ctx.live_a_id and user_id = 'a6000000-0000-0000-0000-00000000000a'
      )
  ) then
    raise exception 'FAIL: 送信内容/送信者(participant_id)が正しく保存されていない';
  end if;

  -- 直後の連打はレート制限で拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
  begin
    perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏');
    raise exception 'FAIL: 1秒以内の連打を送信できてしまった';
  exception
    when others then
      if sqlerrm <> 'RATE_LIMITED' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  reset role;
  select count(*) into v_after from public.live_tsukkomi_events where live_id = ctx.live_a_id;
  if v_after <> v_before + 1 then
    raise exception 'FAIL: レート制限で拒否されたはずなのにイベントが増えている (before=%, after=%)', v_before, v_after;
  end if;
  raise notice 'PASS: 正常送信は1件だけイベントを作り、直後の連打はRATE_LIMITEDで拒否される';
end $$;

-- ============================================================
-- テスト9: live_tsukkomi_events への直接 INSERT は一般ユーザーに許可されていない。
-- ============================================================
do $$
declare
  ctx record;
  v_self_participant uuid;
begin
  select * into ctx from _t0066_ctx;
  select id into v_self_participant from public.participants
    where live_id = ctx.live_a_id and user_id = 'a6000000-0000-0000-0000-00000000000a';

  set local role authenticated;
  perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
  begin
    insert into public.live_tsukkomi_events (live_id, participant_id, kind, text)
      values (ctx.live_a_id, v_self_participant, 'clap', '👏');
    raise exception 'FAIL: 一般ユーザーが live_tsukkomi_events へ直接 INSERT できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: live_tsukkomi_events への直接 INSERT は拒否される (insufficient_privilege)';
    when others then
      if sqlerrm not ilike '%row-level security%' and sqlerrm not ilike '%permission denied%' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
      raise notice 'PASS: live_tsukkomi_events への直接 INSERT は拒否される (RLS)';
  end;
end $$;

drop table _t0066_ctx;

select 'ALL 0066 TESTS PASSED' as result;
