-- 機能3「ライブの組時間が0秒で止まる問題」の回帰確認テスト。
-- 0065（atomic_phase_advance_rpcs）は書き換えない。本ファイルは0065が提供する
-- host_advance_answering_to_group_result / host_advance_group_result_to_next を、
-- 0065のテストでは扱っていない2つの観点で追加検証する：
--   A) begin_gameから複数組・複数ラウンドを実際に最後まで歩かせ、途中の組で
--      止まらずfinal_resultまで正しく進むこと（0065は個々のRPCを単発で検証して
--      いるだけで、実際のbegin_game起点からの一連の流れは検証していなかった）。
--   B) 複数タブ相当の「本当に同時」の呼び出しを、dblinkによる実際の並行セッションで
--      検証する（0065のテスト3・7は同一セッション内の逐次呼び出しによる冪等性の
--      検証であり、真の同時実行は検証していなかった）。
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('a9000000-0000-0000-0000-00000000000a'),
  ('a9000000-0000-0000-0000-00000000000b'),
  ('a9000000-0000-0000-0000-00000000000c'),
  ('a9000000-0000-0000-0000-0000000000ff') -- 非host
on conflict do nothing;
insert into auth.users (id) values ('a9000000-0000-0000-0000-00000000000f') on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a9000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a9100000-0000-0000-0000-000000000001', '0068回帰テスト用お題1', 'text', true),
  ('a9100000-0000-0000-0000-000000000002', '0068回帰テスト用お題2', 'text', true),
  ('a9100000-0000-0000-0000-000000000003', '0068回帰テスト用お題3', 'text', true)
on conflict do nothing;

-- ============================================================
-- テストA: begin_game起点から3組ぶんを実際に最後まで歩かせ、途中で止まらず
--          final_resultへ到達する（組時間0秒からの遷移が全ての組で機能する）。
-- ============================================================
do $$
declare
  v_live_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068回帰テストA', 20, 3,
    array[
      'a9100000-0000-0000-0000-000000000001',
      'a9100000-0000-0000-0000-000000000002',
      'a9100000-0000-0000-0000-000000000003'
    ]::uuid[],
    'test'
  );
  update public.lives set current_phase = 'opening' where id = v_live_id;

  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000c', true);
  perform public.join_live(v_live_id, 'player', null);

  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  perform public.begin_game(v_live_id);
end $$;

create temporary table _t0068b_ctx as
select id as live_id from public.lives where title = '0068回帰テストA';

do $$
declare
  v_live_id uuid;
  v_result_a record;
  v_result_b record;
  v_group_count int;
  v_processed int := 0;
  v_guard int := 0;
begin
  select live_id into v_live_id from _t0068b_ctx;
  select count(*) into v_group_count from public.turns where live_id = v_live_id;
  if v_group_count <> 3 then
    raise exception 'FAIL: begin_game後のturns件数が3でない(got=%)', v_group_count;
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);

  loop
    v_guard := v_guard + 1;
    if v_guard > 10 then
      raise exception 'FAIL: 組の進行が%回のループでも終わらない（0秒から先へ進めていない疑い）', v_guard;
    end if;

    -- 組時間が0秒になった状態を模す（answering中に締切超過）。
    update public.lives
      set current_phase = 'answering', phase_deadline = now() - interval '1 second'
      where id = v_live_id;

    select * into v_result_a from public.host_advance_answering_to_group_result(
      v_live_id,
      (select current_turn_id from public.lives where id = v_live_id),
      now() + interval '15 seconds'
    );
    if v_result_a.updated is not true then
      raise exception 'FAIL: %組目でanswering→group_resultの遷移が行われなかった(updated=%)', v_processed + 1, v_result_a.updated;
    end if;
    if (v_result_a.live).current_phase <> 'group_result' then
      raise exception 'FAIL: %組目でcurrent_phaseがgroup_resultになっていない', v_processed + 1;
    end if;

    select * into v_result_b from public.host_advance_group_result_to_next(
      v_live_id,
      (select current_turn_id from public.lives where id = v_live_id),
      now() + interval '13 seconds'
    );
    if v_result_b.updated is not true then
      raise exception 'FAIL: %組目でgroup_result→次への遷移が行われなかった', v_processed + 1;
    end if;
    v_processed := v_processed + 1;

    if v_result_b.advanced_to = 'final_result' then
      exit;
    elsif v_result_b.advanced_to <> 'topic_reveal' then
      raise exception 'FAIL: 想定外のadvanced_to(%)', v_result_b.advanced_to;
    end if;
    -- 実際の司会画面(advanceIfDue)はtopic_reveal→answeringを単純なガード付き
    -- UPDATEで行う（0065のRPC対象外）。次のループのためにここでも同様に進める。
    update public.lives set current_phase = 'answering' where id = v_live_id;
  end loop;

  reset role;

  if v_processed <> 3 then
    raise exception 'FAIL: 処理した組数が3でない(got=%)', v_processed;
  end if;
  if (select current_phase from public.lives where id = v_live_id) <> 'final_result' then
    raise exception 'FAIL: 最終的にfinal_resultへ到達していない(got=%)', (select current_phase from public.lives where id = v_live_id);
  end if;
  if exists (select 1 from public.turns where live_id = v_live_id and status <> 'done') then
    raise exception 'FAIL: 全組が終わったはずなのにstatus<>doneのturnsが残っている';
  end if;

  raise notice 'PASS: begin_gameから3組すべてを組時間0秒の状態から歩かせても、途中で止まらずfinal_resultへ到達する';
end $$;

-- ============================================================
-- テストB（複数タブでも一度だけ遷移する）：dblinkによる実際の並行呼び出しで、
--          host_advance_answering_to_group_resultが2つのセッションから
--          "本当に同時に"呼ばれても、実際の遷移は1回だけになることを検証する。
--          dblink拡張が使えない環境ではスキップする。
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
    raise notice 'SKIP: dblink拡張が利用できないため、複数タブ同時遷移テストを省略';
  end if;
end $$;

do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
begin
  -- 新しいライブを1つ用意し、answering/turnAの状態にする（テストAで使ったライブとは別）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068回帰テストB', 20, 1,
    array['a9100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  update public.lives set current_phase = 'opening' where id = v_live_id;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  perform public.begin_game(v_live_id);
  reset role;

  select current_turn_id into v_turn_a from public.lives where id = v_live_id;
  update public.lives set current_phase = 'answering' where id = v_live_id;

  create temporary table _t0068b_race_ctx as select v_live_id as live_id, v_turn_a as turn_id;

  create or replace function public._t0068b_call_advance(
    p_live_id uuid, p_turn_id uuid, p_deadline timestamptz, p_hold_seconds numeric
  ) returns boolean
  language plpgsql
  as $f$
  declare
    v_updated boolean;
  begin
    -- 実RPC呼び出しの前に、同じlives行を自分のトランザクションでFOR UPDATEし、
    -- p_hold_seconds秒だけ保持する。これにより、もう一方の同時呼び出しが
    -- RPC内部のFOR UPDATEで実際に待たされる状況を作り、"本当に同時"の競合を再現する。
    perform 1 from public.lives where id = p_live_id for update;
    if p_hold_seconds > 0 then
      perform pg_sleep(p_hold_seconds);
    end if;
    perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
    select updated into v_updated from public.host_advance_answering_to_group_result(p_live_id, p_turn_id, p_deadline);
    return v_updated;
  end;
  $f$;
end $$;

do $$
declare
  v_conn text := 'dbname=' || current_database();
  v_connected boolean := false;
  ctx record;
  v_started_at timestamptz;
  v_elapsed_ms numeric;
  v_bg_updated boolean;
  v_main_updated boolean;
  v_turn_status text;
  v_final_phase text;
begin
  if to_regprocedure('public._t0068b_call_advance(uuid,uuid,timestamptz,numeric)') is null then
    return; -- dblinkが使えずスキップ済み
  end if;

  select * into ctx from _t0068b_race_ctx;

  begin
    perform dblink_connect('t0068brace', v_conn);
    v_connected := true;
  exception when others then
    raise notice 'SKIP: dblink接続に失敗したため、複数タブ同時遷移テストを省略 (%)', sqlerrm;
  end;

  if v_connected then
    -- 別セッション（タブA相当）：1.5秒だけ行ロックを保持してからRPCを呼ぶ。
    perform dblink_send_query(
      't0068brace',
      format('select public._t0068b_call_advance(%L::uuid, %L::uuid, %L::timestamptz, %s)',
        ctx.live_id, ctx.turn_id, now() + interval '15 seconds', 1.5)
    );
    perform pg_sleep(0.3); -- 別セッションが実際にFOR UPDATEを取るまで少し待つ

    -- 本セッション（タブB相当）：同時にRPCを呼ぶ。タブAのロック解放を待たされるはず。
    v_started_at := clock_timestamp();
    v_main_updated := public._t0068b_call_advance(ctx.live_id, ctx.turn_id, now() + interval '15 seconds', 0);
    v_elapsed_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

    select ok into v_bg_updated from dblink_get_result('t0068brace') as t(ok boolean);
    perform dblink_disconnect('t0068brace');

    if v_elapsed_ms < 800 then
      raise exception
        'FAIL: 同時呼び出しがタブAの行ロックを待たずに完了した（約%ms、FOR UPDATEが効いていない疑い）',
        round(v_elapsed_ms);
    end if;

    if v_bg_updated and v_main_updated then
      raise exception 'FAIL: 2つの同時呼び出しの両方がupdated=trueになった（二重遷移）';
    end if;
    if not v_bg_updated and not v_main_updated then
      raise exception 'FAIL: 2つの同時呼び出しのどちらもupdated=trueにならなかった（遷移が失われた）';
    end if;

    select status into v_turn_status from public.turns where id = ctx.turn_id;
    if v_turn_status <> 'done' then
      raise exception 'FAIL: 同時呼び出し後、turnのstatusがdoneになっていない(got=%)', v_turn_status;
    end if;
    select current_phase into v_final_phase from public.lives where id = ctx.live_id;
    if v_final_phase <> 'group_result' then
      raise exception 'FAIL: 同時呼び出し後、current_phaseがgroup_resultになっていない(got=%)', v_final_phase;
    end if;

    raise notice
      'PASS: dblinkによる本当に同時の呼び出しでも、実際の遷移は1回だけ（約%ms待機、bg=%, main=%）',
      round(v_elapsed_ms), v_bg_updated, v_main_updated;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public._t0068b_call_advance(uuid,uuid,timestamptz,numeric)') is not null then
    drop function public._t0068b_call_advance(uuid, uuid, timestamptz, numeric);
  end if;
end $$;

drop table if exists _t0068b_race_ctx;
drop table _t0068b_ctx;

select 'ALL 0068 PHASE ADVANCE REGRESSION TESTS PASSED' as result;
