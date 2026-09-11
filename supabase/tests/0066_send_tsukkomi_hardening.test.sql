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

-- ============================================================
-- テスト10（再レビュー対応・問題2）：フェーズ確認とINSERTのアトミック性。
-- 別トランザクションが対象live行をFOR UPDATEで先にロックしたまま保持している間、
-- send_tsukkomiの呼び出しはそのロックを待ってブロックされ、ロック解放（＝別
-- トランザクションのコミット）後の最新current_phase（answering以外）を正しく見て
-- LIVE_NOT_SENDABLEで拒否すること（フェーズ確認とINSERTの間に別トランザクションの
-- フェーズ変更が割り込めないこと）を、dblinkで開いた別セッションを使って検証する。
-- dblink拡張が使えない環境ではこのテストだけをスキップする（他のテストは影響しない）。
-- ============================================================
do $$
declare
  v_has_dblink boolean;
begin
  begin
    create extension if not exists dblink;
    v_has_dblink := true;
  exception when others then
    v_has_dblink := false;
  end;

  if not v_has_dblink then
    raise notice 'SKIP: dblink拡張が利用できないため、フェーズ切替境界の競合テストを省略';
    return;
  end if;

  -- 別セッション（dblink接続）からも呼べるよう、public スキーマに一時的な
  -- ヘルパー関数を用意する（pg_tempは接続ごとに独立していて dblink の別接続からは
  -- 見えないため）。1回のトップレベル呼び出し＝1トランザクションとして、
  -- lives行をFOR UPDATEしたままp_hold_secondsだけ保持し、その後current_phaseを
  -- group_resultへ進めて（呼び出し完了時に自動コミット）解放する。
  create or replace function public._t0066_hold_lock_then_advance(
    p_live_id uuid,
    p_hold_seconds numeric
  ) returns boolean
  language plpgsql
  as $f$
  begin
    perform 1 from public.lives where id = p_live_id for update;
    perform pg_sleep(p_hold_seconds);
    update public.lives set current_phase = 'group_result' where id = p_live_id;
    return true;
  end;
  $f$;
end $$;

do $$
declare
  ctx record;
  v_conn text := 'dbname=' || current_database();
  v_connected boolean := false;
  v_started_at timestamptz;
  v_elapsed_ms numeric;
  v_before int;
  v_after int;
begin
  if to_regprocedure('public._t0066_hold_lock_then_advance(uuid,numeric)') is null then
    return; -- 直前のブロックでdblinkが使えずスキップ済み
  end if;

  select * into ctx from _t0066_ctx;
  update public.participants set last_tsukkomi_at = null
    where live_id = ctx.live_a_id and user_id = 'a6000000-0000-0000-0000-00000000000a';
  select count(*) into v_before from public.live_tsukkomi_events where live_id = ctx.live_a_id;

  begin
    perform dblink_connect('t0066bg', v_conn);
    v_connected := true;
  exception when others then
    raise notice 'SKIP: dblink接続に失敗したため、フェーズ切替境界の競合テストを省略 (%)', sqlerrm;
  end;

  if v_connected then
    -- 別セッションでlives行をFOR UPDATEでロックし1.5秒保持した後、
    -- current_phaseをgroup_resultへ進めて（関数呼び出し完了時に）コミットする。
    perform dblink_send_query(
      't0066bg',
      format('select public._t0066_hold_lock_then_advance(%L::uuid, %s)', ctx.live_a_id, 1.5)
    );
    -- 別セッションが実際にロックを取るまで少し待つ（非同期送信のため）。
    perform pg_sleep(0.3);

    v_started_at := clock_timestamp();
    set local role authenticated;
    perform set_config('myapp.uid', 'a6000000-0000-0000-0000-00000000000a', true);
    begin
      perform public.send_tsukkomi(ctx.live_a_id, 'clap', '👏');
      raise exception 'FAIL: 別トランザクションのフェーズ変更をまたいでもsend_tsukkomiが成功してしまった';
    exception
      when others then
        if sqlerrm <> 'LIVE_NOT_SENDABLE' then
          raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
        end if;
    end;
    reset role;
    v_elapsed_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

    -- 別セッションの結果を受け取ってから切断する。
    perform ok from dblink_get_result('t0066bg') as t(ok boolean);
    perform dblink_disconnect('t0066bg');

    if v_elapsed_ms < 800 then
      raise exception
        'FAIL: send_tsukkomiが別トランザクションのlivesロックを待たずに完了した（約%ms、FOR UPDATEが効いていない疑い）',
        round(v_elapsed_ms);
    end if;

    select count(*) into v_after from public.live_tsukkomi_events where live_id = ctx.live_a_id;
    if v_after <> v_before then
      raise exception 'FAIL: フェーズ変更後にもかかわらずイベントがINSERTされた (before=%, after=%)', v_before, v_after;
    end if;

    update public.lives set current_phase = 'answering' where id = ctx.live_a_id;
    raise notice
      'PASS: フェーズ確認とINSERTがアトミック（別トランザクションのlivesロック解放を約%ms待ってから最新フェーズで拒否）',
      round(v_elapsed_ms);
  end if;
end $$;

do $$
begin
  drop function if exists public._t0066_hold_lock_then_advance(uuid, numeric);
end $$;

drop table _t0066_ctx;

select 'ALL 0066 TESTS PASSED' as result;
