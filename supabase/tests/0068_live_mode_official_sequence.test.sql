-- 0068 回帰テスト：「テスト／本番」ライブ種別・本番専用の開催番号採番・
-- テストライブでは段位/ポイント/実績/SNS公開を一切行わないことの確認。
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('a8000000-0000-0000-0000-00000000000a'), -- player1
  ('a8000000-0000-0000-0000-00000000000b'), -- player2
  ('a8000000-0000-0000-0000-00000000000f')  -- admin(host)
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a8000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a8100000-0000-0000-0000-000000000001', '0068テスト用お題1', 'text', true),
  ('a8100000-0000-0000-0000-000000000002', '0068テスト用お題2', 'text', true),
  ('a8100000-0000-0000-0000-000000000003', '0068テスト用お題3', 'text', true),
  ('a8100000-0000-0000-0000-000000000004', '0068テスト用お題4', 'text', true)
on conflict do nothing;

-- ============================================================
-- テスト0: 直接INSERTした行（マイグレーション前から存在していた行の代理）は、
--          live_mode='test'・official_sequence_number=nullがデフォルトになる。
-- ============================================================
do $$
declare
  v_live_mode text;
  v_official_seq int;
begin
  insert into public.lives (
    scheduled_at, current_phase, title, max_players, planned_group_count, created_by
  ) values (
    now(), 'closed', '0068直接INSERTテスト', 10, 1, 'a8000000-0000-0000-0000-00000000000f'
  ) returning live_mode, official_sequence_number into v_live_mode, v_official_seq;

  if v_live_mode <> 'test' or v_official_seq is not null then
    raise exception 'FAIL: 列を明示しない新規lives行の既定値がtest/null担っていない(live_mode=%, official_sequence_number=%)', v_live_mode, v_official_seq;
  end if;
  raise notice 'PASS: live_mode/official_sequence_numberの既定値はtest/null（既存ライブが全てtestとして扱われることの土台）';
end $$;

-- ============================================================
-- テスト1: create_live_preparationのp_live_modeを省略するとtestになる
--          （初期値は必ずテストライブという要件のDB側の裏付け）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_live_mode text;
  v_official_seq int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);

  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068テスト-省略時test', 20, 1,
    array['a8100000-0000-0000-0000-000000000001']::uuid[]
  );
  select live_mode, official_sequence_number into v_live_mode, v_official_seq
    from public.lives where id = v_live_id;

  reset role;
  if v_live_mode <> 'test' or v_official_seq is not null then
    raise exception 'FAIL: p_live_mode省略時の既定値がtest/nullでない(live_mode=%, official_sequence_number=%)', v_live_mode, v_official_seq;
  end if;
  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: create_live_preparationはp_live_mode省略時、live_mode=testで作成する';
end $$;

-- ============================================================
-- テスト2: テストライブを複数回作成しても本番番号(official_live_counter)は
--          一切増えない。
-- ============================================================
do $$
declare
  v_before int;
  v_after int;
  v_live_id uuid;
  i int;
begin
  select last_value into v_before from public.official_live_counter where id = true;

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  for i in 1..3 loop
    select live_id into v_live_id from public.create_live_preparation(
      now(), format('0068テスト-test複数回-%s', i), 20, 1,
      array['a8100000-0000-0000-0000-000000000001']::uuid[],
      'test'
    );
    reset role;
    update public.lives set current_phase = 'closed' where id = v_live_id;
    set local role authenticated;
    perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  end loop;
  reset role;

  select last_value into v_after from public.official_live_counter where id = true;
  if v_after <> v_before then
    raise exception 'FAIL: テストライブ作成で本番カウンターが変化した(before=%, after=%)', v_before, v_after;
  end if;
  raise notice 'PASS: テストライブを複数回作成しても本番番号は増えない(counter=%のまま)', v_before;
end $$;

-- ============================================================
-- テスト3: 本番ライブを作ると、それまでの本番カウンター値+1がofficial_sequence_number
--          になる（「最初の本番が#0001になる」の一般化。他のテストファイルが既に
--          本番カウンターを消費している可能性があるため、絶対値の1ではなく
--          「直前の値からの+1」で検証する。まっさらな新規プロジェクトでは
--          この直前の値が0のため、実際に#0001から始まることに変わりはない）。
-- ============================================================
create temporary table _t0068_ctx (key text primary key, live_id uuid);

do $$
declare
  v_before int;
  v_live_id uuid;
  v_seq int;
begin
  select last_value into v_before from public.official_live_counter where id = true;

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068テスト-本番1回目', 20, 1,
    array['a8100000-0000-0000-0000-000000000002']::uuid[],
    'official'
  );
  select official_sequence_number into v_seq from public.lives where id = v_live_id;
  reset role;

  if v_seq <> v_before + 1 then
    raise exception 'FAIL: 本番ライブのofficial_sequence_numberが直前の値+1になっていない(before=%, got=%)', v_before, v_seq;
  end if;
  insert into _t0068_ctx (key, live_id) values ('official_1', v_live_id);
  raise notice 'PASS: 本番ライブのofficial_sequence_numberは直前の値+1になる（まっさらな環境なら#0001）';
end $$;

-- ============================================================
-- テスト4: そのライブを終了しても本番番号は変わらず、次の本番ライブが
--          さらに+1になる（テストライブを間に挟んでも影響しない）。
-- ============================================================
do $$
declare
  v_official_1 uuid;
  v_before int;
  v_live_id uuid;
  v_seq int;
begin
  select live_id into v_official_1 from _t0068_ctx where key = 'official_1';
  update public.lives set current_phase = 'closed' where id = v_official_1;
  select official_sequence_number into v_before from public.lives where id = v_official_1;

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  -- テストライブを間に挟む。
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068テスト-間に挟むtest', 20, 1,
    array['a8100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);

  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068テスト-本番2回目', 20, 1,
    array['a8100000-0000-0000-0000-000000000003']::uuid[], 'official'
  );
  select official_sequence_number into v_seq from public.lives where id = v_live_id;
  reset role;
  -- 後続のテストで新たにライブを作成できるよう、このライブも終了しておく
  -- （「進行中のライブは常に1件」制約のため）。
  update public.lives set current_phase = 'closed' where id = v_live_id;

  if v_seq <> v_before + 1 then
    raise exception 'FAIL: 2番目の本番ライブのofficial_sequence_numberが前回+1でない(前回=%, got=%)', v_before, v_seq;
  end if;
  insert into _t0068_ctx (key, live_id) values ('official_2', v_live_id);
  raise notice 'PASS: 次の本番ライブは前回+1のofficial_sequence_numberになる（間のテストライブは無関係）';
end $$;

-- ============================================================
-- テスト5: official_sequence_numberの一意制約・live_mode整合性制約が効く。
-- ============================================================
do $$
declare
  v_official_1 uuid;
  v_official_2_seq int;
  v_failed boolean := false;
begin
  select live_id into v_official_1 from _t0068_ctx where key = 'official_1';
  select official_sequence_number into v_official_2_seq
    from public.lives where id = (select live_id from _t0068_ctx where key = 'official_2');
  begin
    update public.lives set official_sequence_number = v_official_2_seq where id = v_official_1; -- 既にofficial_2が使用中
    raise exception 'FAIL: official_sequence_numberの重複がunique制約で拒否されなかった';
  exception
    when unique_violation then
      v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: 想定した一意制約違反が発生しなかった';
  end if;

  begin
    update public.lives set live_mode = 'test' where id = v_official_1; -- official_sequence_numberがnot nullのまま
    raise exception 'FAIL: live_mode=testなのにofficial_sequence_numberがnot nullな行がcheck制約で拒否されなかった';
  exception
    when check_violation then
      null; -- 期待通り
  end;
  raise notice 'PASS: official_sequence_numberの一意制約・live_mode整合性のcheck制約が効いている';
end $$;

-- ============================================================
-- テスト6: 作成失敗時（一部のお題が見つからない）は、不完全なライブが残らず、
--          本番カウンターも増えたままにならない（丸ごとロールバックされる）。
-- ============================================================
do $$
declare
  v_counter_before int;
  v_bogus_id uuid := gen_random_uuid();
  v_raised boolean := false;
  v_error_message text;
  v_live_count int;
begin
  select last_value into v_counter_before from public.official_live_counter where id = true;

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.create_live_preparation(
      now(), '0068テスト-作成失敗', 20, 2,
      array['a8100000-0000-0000-0000-000000000004', v_bogus_id]::uuid[], -- 2件必要中1件は存在しないID
      'official'
    );
    -- ここに到達した＝例外が飛ばなかった（v_raisedはfalseのまま、下のifで検出する）。
  exception
    when others then
      v_raised := true;
      v_error_message := sqlerrm;
  end;
  reset role;

  if not v_raised then
    raise exception 'FAIL: 一部のお題が存在しないのに、例外を投げずに作成が完了してしまった';
  end if;
  if v_error_message not like 'お題の登録に失敗しました%' then
    raise exception 'FAIL: 想定外のエラー内容(%)', v_error_message;
  end if;

  select count(*) into v_live_count from public.lives where title = '0068テスト-作成失敗';
  if v_live_count <> 0 then
    raise exception 'FAIL: 作成失敗にもかかわらず不完全なlives行が% 件残っている', v_live_count;
  end if;

  if (select last_value from public.official_live_counter where id = true) <> v_counter_before then
    raise exception 'FAIL: 作成失敗にもかかわらず本番カウンターが増えたままになっている(before=%, after=%)',
      v_counter_before, (select last_value from public.official_live_counter where id = true);
  end if;
  raise notice 'PASS: 作成処理が途中で失敗した場合、不完全なライブは残らず本番カウンターも進まない（丸ごとロールバック）';
end $$;

-- ============================================================
-- テスト7（同時作成でも番号が重複しない）：本番採番カウンターの行ロック＋
--          インクリメントを、dblinkを使った実際の並行呼び出しで検証する。
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
    raise notice 'SKIP: dblink拡張が利用できないため、並行採番テストを省略';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    return;
  end if;

  create or replace function public._t0068_increment_counter_then_hold(p_hold_seconds numeric)
  returns int
  language plpgsql
  as $f$
  declare
    v_seq int;
  begin
    update public.official_live_counter
      set last_value = last_value + 1
      where id = true
      returning last_value into v_seq;
    perform pg_sleep(p_hold_seconds);
    return v_seq;
  end;
  $f$;
end $$;

do $$
declare
  v_conn text := 'dbname=' || current_database();
  v_connected boolean := false;
  v_before int;
  v_started_at timestamptz;
  v_elapsed_ms numeric;
  v_bg_seq int;
  v_main_seq int;
  v_after int;
begin
  if to_regprocedure('public._t0068_increment_counter_then_hold(numeric)') is null then
    return; -- dblinkが使えずスキップ済み
  end if;

  select last_value into v_before from public.official_live_counter where id = true;

  begin
    perform dblink_connect('t0068bg', v_conn);
    v_connected := true;
  exception when others then
    raise notice 'SKIP: dblink接続に失敗したため、並行採番テストを省略 (%)', sqlerrm;
  end;

  if v_connected then
    -- 別セッションが採番し、コミット前に1.5秒だけ行ロックを保持し続ける。
    perform dblink_send_query('t0068bg', 'select public._t0068_increment_counter_then_hold(1.5)');
    perform pg_sleep(0.3); -- 別セッションが実際にUPDATEの行ロックを取るまで少し待つ

    -- 本セッションも同時に採番を試みる。別セッションのロックが解放されるまでブロックされるはず。
    v_started_at := clock_timestamp();
    v_main_seq := public._t0068_increment_counter_then_hold(0);
    v_elapsed_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

    select ok into v_bg_seq from dblink_get_result('t0068bg') as t(ok int);
    perform dblink_disconnect('t0068bg');

    if v_elapsed_ms < 800 then
      raise exception
        'FAIL: 採番の行ロックを待たずに完了した（約%ms、行ロックが効いていない疑い）', round(v_elapsed_ms);
    end if;

    if v_bg_seq = v_main_seq then
      raise exception 'FAIL: 同時採番で同じofficial_sequence_number(%)が2回発行された（重複）', v_bg_seq;
    end if;
    if least(v_bg_seq, v_main_seq) <> v_before + 1 or greatest(v_bg_seq, v_main_seq) <> v_before + 2 then
      raise exception 'FAIL: 同時採番の結果が連番になっていない(before=%, bg=%, main=%)', v_before, v_bg_seq, v_main_seq;
    end if;

    select last_value into v_after from public.official_live_counter where id = true;
    if v_after <> v_before + 2 then
      raise exception 'FAIL: 同時採番後のカウンター最終値が想定と違う(got=%, expected=%)', v_after, v_before + 2;
    end if;

    raise notice
      'PASS: dblinkによる実際の並行呼び出しでも採番が重複せず連番になる（約%ms待機、%→%,%）',
      round(v_elapsed_ms), v_before, v_bg_seq, v_main_seq;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public._t0068_increment_counter_then_hold(numeric)') is not null then
    drop function public._t0068_increment_counter_then_hold(numeric);
  end if;
end $$;

-- ============================================================
-- テスト8: テストライブを終了しても、段位・累計ポイント・ポイント残高・
--          参加回数・1〜3位実績は一切変化せず、point_historyも作られない。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_p1_before record;
  v_p1_after record;
  v_close_result record;
  v_ph_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068テスト-test終了時', 20, 1,
    array['a8100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  reset role;

  select mastery_meter, total_points, points_balance, live_count,
         award_count_first, award_count_second, award_count_third, best_answer_count
    into v_p1_before
    from public.profiles where id = 'a8000000-0000-0000-0000-00000000000a';

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  select * into v_close_result from public.close_live(v_live_id);
  reset role;

  if v_close_result.closed is not true then
    raise exception 'FAIL: close_liveがclosed=trueを返さなかった';
  end if;
  if v_close_result.rewards_applied is not true or v_close_result.rewards_error is not null then
    raise exception 'FAIL: テストライブのclose_liveがrewards_applied=true,rewards_error=nullを返さなかった(applied=%, error=%)',
      v_close_result.rewards_applied, v_close_result.rewards_error;
  end if;

  if (select rank_rewards_applied from public.lives where id = v_live_id) is not false then
    raise exception 'FAIL: テストライブなのにlives.rank_rewards_appliedがtrueになっている（実際には加算していないことの整合性が崩れている）';
  end if;

  select mastery_meter, total_points, points_balance, live_count,
         award_count_first, award_count_second, award_count_third, best_answer_count
    into v_p1_after
    from public.profiles where id = 'a8000000-0000-0000-0000-00000000000a';

  if v_p1_before.mastery_meter <> v_p1_after.mastery_meter
    or v_p1_before.total_points <> v_p1_after.total_points
    or v_p1_before.points_balance <> v_p1_after.points_balance
    or v_p1_before.live_count <> v_p1_after.live_count
    or v_p1_before.award_count_first <> v_p1_after.award_count_first
    or v_p1_before.award_count_second <> v_p1_after.award_count_second
    or v_p1_before.award_count_third <> v_p1_after.award_count_third
    or v_p1_before.best_answer_count <> v_p1_after.best_answer_count
  then
    raise exception 'FAIL: テストライブ終了で段位・ポイント・実績のいずれかが変化した';
  end if;

  select count(*) into v_ph_count from public.point_history where live_id = v_live_id;
  if v_ph_count <> 0 then
    raise exception 'FAIL: テストライブなのにpoint_historyが% 件作られている', v_ph_count;
  end if;

  -- 多層防御：apply_live_rank_rewards / retry_live_rank_rewardsを直接叩いても
  -- テストライブでは何もしない。
  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  perform public.apply_live_rank_rewards(v_live_id);
  reset role;
  if (select rank_rewards_applied from public.lives where id = v_live_id) is not false then
    raise exception 'FAIL: apply_live_rank_rewardsを直接呼んだテストライブでrank_rewards_appliedがtrueになった';
  end if;

  if v_p1_before.mastery_meter <> (select mastery_meter from public.profiles where id = 'a8000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: apply_live_rank_rewardsの直接呼び出し（多層防御）でテストライブなのにポイントが変化した';
  end if;

  raise notice 'PASS: テストライブ終了時、段位・ポイント・実績・point_historyは一切変化せず、多層防御も機能する';
end $$;

-- ============================================================
-- テスト9: テストライブの結果をSNSに公開しようとすると、DB制約レベルで拒否される。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_failed boolean := false;
begin
  select id into v_live_id from public.lives where title = '0068テスト-test終了時';

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  begin
    update public.lives set results_published = true where id = v_live_id;
    raise exception 'FAIL: テストライブのresults_published=trueへの更新がcheck制約で拒否されなかった';
  exception
    when check_violation then
      v_failed := true;
  end;
  reset role;

  if not v_failed then
    raise exception 'FAIL: 想定したcheck制約違反が発生しなかった';
  end if;
  raise notice 'PASS: テストライブの結果はDB制約レベルでもSNSに公開できない';
end $$;

-- ============================================================
-- テスト10: 本番ライブでは従来通り、終了時に一度だけ段位・ポイントが付与され、
--           point_historyのラベルにofficial_sequence_number（#0001形式の元になる
--           番号）が使われる。retryを呼んでも二重加算されない。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_p1 uuid := 'a8000000-0000-0000-0000-00000000000a';
  v_p2 uuid := 'a8000000-0000-0000-0000-00000000000b';
  v_participant1 uuid;
  v_participant2 uuid;
  v_close_result record;
  v_p1_gain int;
  v_p1_before int;
  v_p1_after int;
  v_ph_label text;
  v_official_seq int;
  v_retry_result record;
  v_p1_after_retry int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068テスト-official終了時', 20, 1,
    array['a8100000-0000-0000-0000-000000000002']::uuid[], 'official'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_p1::text, true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', v_p2::text, true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;

  select official_sequence_number into v_official_seq from public.lives where id = v_live_id;
  select id into v_participant1 from public.participants where live_id = v_live_id and user_id = v_p1;
  select id into v_participant2 from public.participants where live_id = v_live_id and user_id = v_p2;

  -- 実際の進行(begin_game等)は経由せず、採点集計に必要な最小限のresolved済み
  -- answersだけを直接用意する（0065/0066テストと同じ簡略化の考え方）。
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (gen_random_uuid(), v_live_id, 1,
      (select id from public.groups where live_id = v_live_id limit 1),
      (select id from public.topics where live_id = v_live_id limit 1),
      'done', 1)
    returning id into v_turn_id;
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_participant1, 1, '1位相当の回答', 100, true);
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_participant2, 1, '2位相当の回答', 50, true);

  select mastery_meter into v_p1_before from public.profiles where id = v_p1;

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  select * into v_close_result from public.close_live(v_live_id);
  reset role;

  if v_close_result.rewards_applied is not true or v_close_result.rewards_error is not null then
    raise exception 'FAIL: 本番ライブのclose_liveが報酬付与に失敗した(applied=%, error=%)',
      v_close_result.rewards_applied, v_close_result.rewards_error;
  end if;
  if (select rank_rewards_applied from public.lives where id = v_live_id) is not true then
    raise exception 'FAIL: 本番ライブなのにlives.rank_rewards_appliedがtrueになっていない';
  end if;

  select mastery_meter into v_p1_after from public.profiles where id = v_p1;
  v_p1_gain := 10 + 100 + 100; -- 参加10 + 得点100 + 1位ボーナス100
  if v_p1_after - v_p1_before <> v_p1_gain then
    raise exception 'FAIL: 本番ライブ1位の獲得ポイントが想定と違う(想定=%, 実際=%)', v_p1_gain, v_p1_after - v_p1_before;
  end if;

  select label into v_ph_label from public.point_history
    where live_id = v_live_id and user_id = v_p1
    order by created_at desc limit 1;
  if v_ph_label !~ ('^第' || v_official_seq || '回ライブ') then
    raise exception 'FAIL: point_historyのラベルに本番専用のofficial_sequence_number(%)が使われていない(label=%)', v_official_seq, v_ph_label;
  end if;

  -- retryを呼んでも二重加算されない（既存のrank_rewards_appliedガードのまま）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  select * into v_retry_result from public.retry_live_rank_rewards(v_live_id);
  reset role;
  select mastery_meter into v_p1_after_retry from public.profiles where id = v_p1;
  if v_p1_after_retry <> v_p1_after then
    raise exception 'FAIL: retry_live_rank_rewardsで本番ライブのポイントが二重加算された(前=%, 後=%)', v_p1_after, v_p1_after_retry;
  end if;

  raise notice 'PASS: 本番ライブでは従来通り一度だけ段位・ポイントが付与され、point_historyのラベルに本番専用番号が使われる';
end $$;

-- ============================================================
-- テスト11: set_sns_live_result_manager_bestはテストライブに対して拒否される。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_result_id uuid;
  v_answer_id uuid;
  v_participant1 uuid;
  v_turn_id uuid;
  v_failed boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068テスト-manager_best拒否', 20, 1,
    array['a8100000-0000-0000-0000-000000000003']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;
  select id into v_participant1 from public.participants where live_id = v_live_id and user_id = 'a8000000-0000-0000-0000-00000000000a';

  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (gen_random_uuid(), v_live_id, 1,
      (select id from public.groups where live_id = v_live_id limit 1),
      (select id from public.topics where live_id = v_live_id limit 1),
      'done', 1)
    returning id into v_turn_id;
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_participant1, 1, 'manager best候補', 10, true)
    returning id into v_answer_id;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  insert into public.sns_live_results (id, live_id) values (gen_random_uuid(), v_live_id) returning id into v_result_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a8000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.set_sns_live_result_manager_best(v_result_id, v_answer_id);
    raise exception 'FAIL: テストライブに対するset_sns_live_result_manager_bestが成功してしまった';
  exception
    when others then
      if sqlerrm like 'テストライブには運営ベストを設定できません%' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;

  if not v_failed then
    raise exception 'FAIL: 想定した例外が発生しなかった';
  end if;
  raise notice 'PASS: set_sns_live_result_manager_bestはテストライブに対して拒否される';
end $$;

drop table _t0068_ctx;

select 'ALL 0068 TESTS PASSED' as result;
