-- 0068「既存ライブの実移行」専用テスト。
-- supabase/tests/run_0068_migration_test.sh からのみ実行する想定
-- （0001〜0067適用 → 0068適用前seed投入 → 0068適用、という順序が前提のため、
-- 通常のsupabase/tests/run.sh、全マイグレーション適用後のフローとは別に
-- 実行する）。
--
-- ファイル名は*.test.sqlだが、あえてsupabase/tests/直下ではなくfixtures/配下に
-- 置いている。supabase/tests/run.sh（既存の「0001〜全件適用→*.test.sql全件実行」
-- フロー）は"$SCRIPT_DIR"/*.test.sql（直下のみ）をglobするため、fixtures/配下に
-- 置くことで誤って一般フロー側から実行されない（このテストが前提とする
-- 「0068適用前seedデータ」は一般フローのDBには存在せず、誤実行すると
-- 検証が空振りしてしまうため）。
--
-- supabase/tests/fixtures/0068_pre_migration_seed.sqlで作成した
-- 「0068適用前から存在していた本番ライブ」(id='b0680000-0000-0000-0000-0000000000aa')が、
-- 0068適用後に
--   - live_mode='test' / official_sequence_number=null / results_published=false
--     へ正しく移行されていること
--   - 紐づくanswers・sns_live_results・sns_live_result_answers・point_historyの行が
--     一切削除・変更されていないこと
--   - 該当プロフィールのポイント・実績が一切変化していないこと
--   - official_live_counter.last_value=0のまま（本番カウンターが一切消費されていない）
-- であることを確認する。

\set ON_ERROR_STOP on

do $$
declare
  v_live_id constant uuid := 'b0680000-0000-0000-0000-0000000000aa';
  v_p1 constant uuid := 'b0680000-0000-0000-0000-000000000001';
  v_p2 constant uuid := 'b0680000-0000-0000-0000-000000000002';
  v_live_mode text;
  v_official_seq int;
  v_results_published boolean;
begin
  select live_mode, official_sequence_number, results_published
    into v_live_mode, v_official_seq, v_results_published
    from public.lives where id = v_live_id;

  if v_live_mode <> 'test' then
    raise exception 'FAIL: 0068適用前から存在していたライブのlive_modeがtestになっていない(実際=%)', v_live_mode;
  end if;
  if v_official_seq is not null then
    raise exception 'FAIL: 0068適用前から存在していたライブのofficial_sequence_numberがnullになっていない(実際=%)', v_official_seq;
  end if;
  if v_results_published is not false then
    raise exception 'FAIL: 0068適用前から存在していたライブのresults_publishedがfalseになっていない(実際=%)', v_results_published;
  end if;
  raise notice 'PASS: 0068適用前から存在していたライブはlive_mode=test/official_sequence_number=null/results_published=falseへ移行される';
end $$;

do $$
declare
  v_live_id constant uuid := 'b0680000-0000-0000-0000-0000000000aa';
  v_answer_count int;
  v_result_count int;
  v_result_answer_count int;
  v_included_count int;
begin
  select count(*) into v_answer_count from public.answers where live_id = v_live_id;
  if v_answer_count <> 2 then
    raise exception 'FAIL: 0068適用後、移行前に作成したanswersの行数が変化した(想定=2, 実際=%)', v_answer_count;
  end if;

  select count(*) into v_result_count from public.sns_live_results where live_id = v_live_id;
  if v_result_count <> 1 then
    raise exception 'FAIL: 0068適用後、sns_live_resultsの行が消えている(想定=1, 実際=%)', v_result_count;
  end if;

  select count(*) into v_result_answer_count
    from public.sns_live_result_answers ra
    join public.sns_live_results r on r.id = ra.live_result_id
    where r.live_id = v_live_id;
  if v_result_answer_count <> 2 then
    raise exception 'FAIL: 0068適用後、sns_live_result_answersの行数が変化した(想定=2, 実際=%)', v_result_answer_count;
  end if;

  select count(*) into v_included_count
    from public.sns_live_result_answers ra
    join public.sns_live_results r on r.id = ra.live_result_id
    where r.live_id = v_live_id and ra.included = true;
  if v_included_count <> 2 then
    raise exception 'FAIL: 0068適用後、included=trueのsns_live_result_answersが消えた/変化した(想定=2, 実際=%)', v_included_count;
  end if;

  raise notice 'PASS: 0068適用後もanswers・sns_live_results・sns_live_result_answers(included含む)の行は一切削除・変更されていない';
end $$;

do $$
declare
  v_p1 constant uuid := 'b0680000-0000-0000-0000-000000000001';
  v_p2 constant uuid := 'b0680000-0000-0000-0000-000000000002';
  v_p1_row record;
  v_p2_row record;
begin
  select mastery_meter, total_points, points_balance, live_count,
         award_count_first, award_count_second, award_count_third, best_answer_count
    into v_p1_row from public.profiles where id = v_p1;
  if v_p1_row.mastery_meter <> 555 or v_p1_row.total_points <> 555 or v_p1_row.points_balance <> 555
    or v_p1_row.live_count <> 4 or v_p1_row.award_count_first <> 2 or v_p1_row.award_count_second <> 1
    or v_p1_row.award_count_third <> 0 or v_p1_row.best_answer_count <> 1
  then
    raise exception 'FAIL: 0068適用後、player1のポイント・実績がseed直後の値から変化した(実際=%)', v_p1_row;
  end if;

  select mastery_meter, total_points, points_balance, live_count,
         award_count_first, award_count_second, award_count_third, best_answer_count
    into v_p2_row from public.profiles where id = v_p2;
  if v_p2_row.mastery_meter <> 210 or v_p2_row.total_points <> 210 or v_p2_row.points_balance <> 210
    or v_p2_row.live_count <> 4 or v_p2_row.award_count_first <> 0 or v_p2_row.award_count_second <> 2
    or v_p2_row.award_count_third <> 1 or v_p2_row.best_answer_count <> 0
  then
    raise exception 'FAIL: 0068適用後、player2のポイント・実績がseed直後の値から変化した(実際=%)', v_p2_row;
  end if;

  raise notice 'PASS: 0068適用後も、既存プロフィールのポイント・実績はseed直後の値と完全一致する（一切変化していない）';
end $$;

do $$
declare
  v_live_id constant uuid := 'b0680000-0000-0000-0000-0000000000aa';
  v_ph_count int;
  v_ph_sum int;
  v_p1_label text;
  v_p2_label text;
begin
  select count(*), sum(points) into v_ph_count, v_ph_sum
    from public.point_history where live_id = v_live_id;
  if v_ph_count <> 2 then
    raise exception 'FAIL: 0068適用後、point_historyの行数が変化した(想定=2, 実際=%)', v_ph_count;
  end if;
  if v_ph_sum <> 280 then
    raise exception 'FAIL: 0068適用後、point_historyのpoints合計が変化した(想定=280, 実際=%)', v_ph_sum;
  end if;

  select label into v_p1_label from public.point_history
    where live_id = v_live_id and user_id = 'b0680000-0000-0000-0000-000000000001';
  select label into v_p2_label from public.point_history
    where live_id = v_live_id and user_id = 'b0680000-0000-0000-0000-000000000002';
  if v_p1_label <> '第12回ライブ（1位）' or v_p2_label <> '第12回ライブ（2位）' then
    raise exception 'FAIL: 0068適用後、point_historyのラベルが変化した(p1=%, p2=%)', v_p1_label, v_p2_label;
  end if;

  raise notice 'PASS: 0068適用後もpoint_historyの行・内容（件数・points・label）は一切削除・変更されていない';
end $$;

do $$
declare
  v_counter int;
begin
  select last_value into v_counter from public.official_live_counter where id = true;
  if v_counter <> 0 then
    raise exception 'FAIL: 0068適用（既存テストライブの移行）だけで本番カウンターが消費された(last_value=%)', v_counter;
  end if;
  raise notice 'PASS: 0068適用（既存ライブの移行）だけでは本番採番カウンター(official_live_counter.last_value)は0のまま';
end $$;

select 'ALL 0068 PRE-EXISTING MIGRATION TESTS PASSED' as result;
