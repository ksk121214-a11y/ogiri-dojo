-- 0068「ポイント監査・訂正処理」の対象範囲・表示ラベルの回帰テスト。
-- audit_rank_reward_mismatches() / fix_rank_reward_mismatches(uuid) が
--   - live_mode='test'のライブ（rank_rewards_applied=trueの異常な状態を意図的に
--     作った場合も含む）を一切対象にしない
--   - live_mode='official'のライブの不整合は正しく検出・訂正する
--   - 戻り値out_sequence_number・point_historyラベルにレガシーのsequence_number
--     ではなくofficial_sequence_numberを使う
--   - 二重加算されない（同じライブに対する2回目のfixは0件）
--   - is_host()を満たさない一般ユーザーからは拒否される
--   - SQL Editor相当（auth.uid()がnullのロール）からは呼び出せる
-- ことを確認する。実行方法はsupabase/tests/run.sh参照（0001〜現在の全マイグレーション
-- 適用後の通常フローで実行できる）。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('a9000000-0000-0000-0000-00000000000a'), -- player1
  ('a9000000-0000-0000-0000-00000000000b'), -- player2
  ('a9000000-0000-0000-0000-00000000000c'), -- 一般ユーザー（host権限なし）
  ('a9000000-0000-0000-0000-00000000000f')  -- admin(host)
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a9000000-0000-0000-0000-00000000000f';
update public.profiles set role = 'user' where id = 'a9000000-0000-0000-0000-00000000000c';

insert into public.topic_bank (id, body, format, is_active) values
  ('a9100000-0000-0000-0000-000000000001', '0068監査テスト用お題1', 'text', true),
  ('a9100000-0000-0000-0000-000000000002', '0068監査テスト用お題2', 'text', true)
on conflict do nothing;

create temporary table _t0068_audit_ctx (key text primary key, live_id uuid, user_id uuid);

-- ============================================================
-- テスト1: rank_rewards_applied=trueのテストライブ（本来ありえない異常状態を
--          意図的に作る）を作っても、audit_rank_reward_mismatches()の結果に
--          一切出てこない。fix_rank_reward_mismatches()へ渡しても0件で、
--          プロフィール・point_historyも一切変化しない。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_p1 uuid := 'a9000000-0000-0000-0000-00000000000a';
  v_participant1 uuid;
  v_p1_before record;
  v_ph_count_before int;
  v_audit_count int;
  v_fix_count int;
  v_p1_after record;
  v_ph_count_after int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068監査テスト-test異常状態', 20, 1,
    array['a9100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_p1::text, true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;
  select id into v_participant1 from public.participants where live_id = v_live_id and user_id = v_p1;

  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (gen_random_uuid(), v_live_id, 1,
      (select id from public.groups where live_id = v_live_id limit 1),
      (select id from public.topics where live_id = v_live_id limit 1),
      'done', 1)
    returning id into v_turn_id;
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_participant1, 1, 'testライブ異常状態用回答', 100, true);

  update public.lives set current_phase = 'closed' where id = v_live_id;

  -- 本来close_live/apply_live_rank_rewards経由では起こり得ない異常状態
  -- （rank_rewards_applied=trueだが実際にはpoint_historyに何も記録されていない）
  -- を、テーブルを直接触って意図的に作る。それでも監査・訂正の対象範囲は
  -- live_modeで絞られているため、この状態が対象に含まれないことを確認する。
  update public.lives set rank_rewards_applied = true where id = v_live_id;
  insert into public.point_history (user_id, live_id, points, mastery, label)
    values (v_p1, v_live_id, 999, 999, 'テスト用の異常なpoint_history行（本来ありえない金額）');

  select mastery_meter, total_points, points_balance, live_count,
         award_count_first, award_count_second, award_count_third
    into v_p1_before from public.profiles where id = v_p1;
  select count(*) into v_ph_count_before from public.point_history where live_id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select count(*) into v_audit_count from public.audit_rank_reward_mismatches() where out_live_id = v_live_id;
  reset role;
  if v_audit_count <> 0 then
    raise exception 'FAIL: rank_rewards_applied=trueのテストライブがaudit_rank_reward_mismatches()に出てきた(件数=%)', v_audit_count;
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select count(*) into v_fix_count from public.fix_rank_reward_mismatches(v_live_id);
  reset role;
  if v_fix_count <> 0 then
    raise exception 'FAIL: テストライブに対するfix_rank_reward_mismatches()が0件を返さなかった(件数=%)', v_fix_count;
  end if;

  select mastery_meter, total_points, points_balance, live_count,
         award_count_first, award_count_second, award_count_third
    into v_p1_after from public.profiles where id = v_p1;
  select count(*) into v_ph_count_after from public.point_history where live_id = v_live_id;

  if v_p1_before.mastery_meter <> v_p1_after.mastery_meter
    or v_p1_before.total_points <> v_p1_after.total_points
    or v_p1_before.points_balance <> v_p1_after.points_balance
    or v_p1_before.live_count <> v_p1_after.live_count
    or v_p1_before.award_count_first <> v_p1_after.award_count_first
    or v_p1_before.award_count_second <> v_p1_after.award_count_second
    or v_p1_before.award_count_third <> v_p1_after.award_count_third
  then
    raise exception 'FAIL: テストライブに対するfix_rank_reward_mismatches()実行後にプロフィールが変化した';
  end if;
  if v_ph_count_after <> v_ph_count_before then
    raise exception 'FAIL: テストライブに対するfix_rank_reward_mismatches()実行後にpoint_historyの件数が変化した(前=%, 後=%)', v_ph_count_before, v_ph_count_after;
  end if;

  insert into _t0068_audit_ctx (key, live_id, user_id) values ('test_anomaly', v_live_id, v_p1);
  raise notice 'PASS: rank_rewards_applied=trueの異常なテストライブは監査・訂正の対象外（live_modeで絞られている）';
end $$;

-- ============================================================
-- テスト2: 本番ライブで意図的に不整合を作ると、監査結果に正しく出る。
--          out_sequence_numberはレガシーのsequence_numberではなく
--          official_sequence_numberになっている。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_p1 uuid := 'a9000000-0000-0000-0000-00000000000a';
  v_p2 uuid := 'a9000000-0000-0000-0000-00000000000b';
  v_participant1 uuid;
  v_participant2 uuid;
  v_close_result record;
  v_official_seq int;
  v_legacy_seq int;
  v_correct_gain int;
  v_corrupted_recorded int := 5; -- 訂正前のpoint_historyをこの金額に書き換えて不整合を作る
  v_audit_row record;
  v_audit_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0068監査テスト-official不整合', 20, 1,
    array['a9100000-0000-0000-0000-000000000002']::uuid[], 'official'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_p1::text, true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', v_p2::text, true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;

  select official_sequence_number, sequence_number into v_official_seq, v_legacy_seq
    from public.lives where id = v_live_id;
  select id into v_participant1 from public.participants where live_id = v_live_id and user_id = v_p1;
  select id into v_participant2 from public.participants where live_id = v_live_id and user_id = v_p2;

  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (gen_random_uuid(), v_live_id, 1,
      (select id from public.groups where live_id = v_live_id limit 1),
      (select id from public.topics where live_id = v_live_id limit 1),
      'done', 1)
    returning id into v_turn_id;
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_participant1, 1, '0068監査テスト-1位相当回答', 100, true);
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_participant2, 1, '0068監査テスト-2位相当回答', 50, true);

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select * into v_close_result from public.close_live(v_live_id);
  reset role;
  if v_close_result.rewards_applied is not true or v_close_result.rewards_error is not null then
    raise exception 'FAIL: 本番ライブのclose_liveが報酬付与に失敗した(applied=%, error=%)',
      v_close_result.rewards_applied, v_close_result.rewards_error;
  end if;

  v_correct_gain := 10 + 100 + 100; -- 参加10 + 得点100 + 1位ボーナス100
  -- 正しく付与された直後のpoint_historyを、意図的に食い違う金額へ書き換えて
  -- 「recorded(実際にpoint_historyに記録されている合計) <> correct(再計算結果)」
  -- という不整合を作る。
  update public.point_history
    set points = v_corrupted_recorded, mastery = v_corrupted_recorded
    where live_id = v_live_id and user_id = v_p1;
  -- profiles側も、その食い違った金額しか付与されていない状態に揃える
  -- （実運用でありうる「加算処理が一部失敗し中途半端な値になった」を模す）。
  update public.profiles set
    mastery_meter = mastery_meter - v_correct_gain + v_corrupted_recorded,
    total_points = total_points - v_correct_gain + v_corrupted_recorded,
    points_balance = points_balance - v_correct_gain + v_corrupted_recorded
  where id = v_p1;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select count(*) into v_audit_count from public.audit_rank_reward_mismatches() where out_live_id = v_live_id;
  select * into v_audit_row from public.audit_rank_reward_mismatches()
    where out_live_id = v_live_id and out_user_id = v_p1;
  reset role;

  if v_audit_count = 0 then
    raise exception 'FAIL: 本番ライブに意図的に作った不整合がaudit_rank_reward_mismatches()に出てこない';
  end if;
  if v_audit_row.out_gain_delta <> (v_correct_gain - v_corrupted_recorded) then
    raise exception 'FAIL: 不整合の差分(out_gain_delta)が想定と違う(想定=%, 実際=%)',
      v_correct_gain - v_corrupted_recorded, v_audit_row.out_gain_delta;
  end if;
  if v_audit_row.out_sequence_number <> v_official_seq then
    raise exception 'FAIL: out_sequence_numberがofficial_sequence_number(%)と一致しない(実際=%)',
      v_official_seq, v_audit_row.out_sequence_number;
  end if;
  if v_audit_row.out_sequence_number = v_legacy_seq and v_legacy_seq <> v_official_seq then
    raise exception 'FAIL: out_sequence_numberがレガシーのsequence_number(%)になっている（official_sequence_numberであるべき）', v_legacy_seq;
  end if;

  insert into _t0068_audit_ctx (key, live_id, user_id) values ('official_mismatch', v_live_id, v_p1);
  raise notice
    'PASS: 本番ライブの意図的な不整合は監査結果に正しく出て、out_sequence_number(%)はレガシーのsequence_number(%)ではなくofficial_sequence_numberになっている',
    v_audit_row.out_sequence_number, v_legacy_seq;
end $$;

-- ============================================================
-- テスト3: fix_rank_reward_mismatches()による訂正で、プロフィールが正しい値に
--          戻り、point_historyの訂正ラベルにもofficial_sequence_numberが
--          使われる（レガシー番号が使われていない）。2回連続で呼んでも
--          2回目は0件（二重加算されない）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_user_id uuid;
  v_official_seq int;
  v_legacy_seq int;
  v_p1_before_fix int;
  v_p1_after_fix int;
  v_fix_rows int;
  v_fix_row record;
  v_correction_label text;
  v_second_fix_rows int;
begin
  select live_id, user_id into v_live_id, v_user_id from _t0068_audit_ctx where key = 'official_mismatch';
  select official_sequence_number, sequence_number into v_official_seq, v_legacy_seq
    from public.lives where id = v_live_id;

  select mastery_meter into v_p1_before_fix from public.profiles where id = v_user_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select count(*) into v_fix_rows from public.fix_rank_reward_mismatches(v_live_id);
  reset role;
  if v_fix_rows <> 1 then
    raise exception 'FAIL: 本番ライブの不整合訂正が1件にならなかった(件数=%)', v_fix_rows;
  end if;

  select mastery_meter into v_p1_after_fix from public.profiles where id = v_user_id;
  -- out_gain_delta = correct(210) - corrupted_recorded(5) = 205 がそのまま加算されるはず。
  if v_p1_after_fix - v_p1_before_fix <> 205 then
    raise exception 'FAIL: fix_rank_reward_mismatches()実行後のポイント増分が想定と違う(想定=205, 実際=%)', v_p1_after_fix - v_p1_before_fix;
  end if;

  select label into v_correction_label from public.point_history
    where live_id = v_live_id and user_id = v_user_id and label like '%ライブ報酬訂正%'
    order by created_at desc limit 1;
  if v_correction_label !~ ('^第' || v_official_seq || '回ライブ ライブ報酬訂正') then
    raise exception 'FAIL: 訂正のpoint_historyラベルにofficial_sequence_number(%)が使われていない(label=%)', v_official_seq, v_correction_label;
  end if;
  if v_legacy_seq <> v_official_seq and v_correction_label like ('第' || v_legacy_seq || '回ライブ%') then
    raise exception 'FAIL: 訂正のpoint_historyラベルがレガシーのsequence_number(%)を使っている', v_legacy_seq;
  end if;

  -- 2回連続で呼んでも2回目は0件（二重加算されない）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select count(*) into v_second_fix_rows from public.fix_rank_reward_mismatches(v_live_id);
  reset role;
  if v_second_fix_rows <> 0 then
    raise exception 'FAIL: 同じ本番ライブへの2回目のfix_rank_reward_mismatches()が0件でない(件数=%)', v_second_fix_rows;
  end if;

  raise notice 'PASS: fix_rank_reward_mismatches()の訂正はofficial_sequence_numberをラベルに使い、2回目は0件（二重加算なし）';
end $$;

-- ============================================================
-- テスト4: 一般ユーザー（host権限なし）がaudit_rank_reward_mismatches()・
--          fix_rank_reward_mismatches()を呼ぶと拒否される。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_failed_audit boolean := false;
  v_failed_fix boolean := false;
begin
  select live_id into v_live_id from _t0068_audit_ctx where key = 'official_mismatch';

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000c', true);
  begin
    perform * from public.audit_rank_reward_mismatches();
    raise exception 'FAIL: 一般ユーザーによるaudit_rank_reward_mismatches()呼び出しが成功してしまった';
  exception
    when others then
      if sqlerrm = 'not authorized' then
        v_failed_audit := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(audit): %', sqlerrm;
      end if;
  end;

  begin
    perform * from public.fix_rank_reward_mismatches(v_live_id);
    raise exception 'FAIL: 一般ユーザーによるfix_rank_reward_mismatches()呼び出しが成功してしまった';
  exception
    when others then
      if sqlerrm = 'not authorized' then
        v_failed_fix := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(fix): %', sqlerrm;
      end if;
  end;
  reset role;

  if not v_failed_audit or not v_failed_fix then
    raise exception 'FAIL: 一般ユーザーからの呼び出しがnot authorizedで拒否されなかった';
  end if;
  raise notice 'PASS: host権限の無い一般ユーザーからのaudit/fix呼び出しはnot authorizedで拒否される';
end $$;

-- ============================================================
-- テスト5: SQL Editor相当（auth.uid()がnullのロール、0057で追加された保守用の
--          許可仕様）からは、is_host()を満たさなくても呼び出せる。
-- ============================================================
do $$
declare
  v_audit_count int;
begin
  -- role/myapp.uidを一切設定しない＝このセッションのデフォルト接続ロール
  -- （postgres、auth.uid()はnull）のまま呼び出す＝SQL Editorからの実行に相当。
  select count(*) into v_audit_count from public.audit_rank_reward_mismatches();
  -- 呼び出し自体が例外を投げないことがこのテストの主眼（結果の件数は
  -- 他のテストの実行順・既存データに依存するため、値そのものは検証しない）。
  perform public.fix_rank_reward_mismatches(gen_random_uuid()); -- 存在しないlive_idなので0件が期待値
  raise notice 'PASS: SQL Editor相当（auth.uid()がnull）からはaudit/fixのいずれも例外なく呼び出せる';
end $$;

drop table _t0068_audit_ctx;

select 'ALL 0068 RANK REWARD AUDIT SCOPE TESTS PASSED' as result;
