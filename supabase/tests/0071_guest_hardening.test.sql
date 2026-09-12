-- 0071 回帰テスト：0070（ゲスト参加）レビュー対応の権限境界・報酬除外の確認。
-- 実行方法は supabase/tests/run.sh 参照。
--
-- 【重要】設計原則の検証について：
-- participants.is_guestは「表示用フラグ」に過ぎず、0010の列GRANT
-- （grant insert (live_id, user_id, preferred_role) on public.participants）
-- により、is_guest/guest_number列を指定しない直接INSERTが技術的に可能なため、
-- 「is_guest=falseだが実際はゲスト（profiles.is_guest=true）」という参加者行が
-- 作られうる（このINSERT自体は0001の参加者テーブルの一般的な設計であり、今回の
-- タスクでは深追いしない）。本ファイルのテスト1・2・3は、まさにこの状態を意図的に
-- 作り、報酬付与・監査・運営ベスト選出がparticipants.is_guestではなく
-- profiles.is_guestで正しく判定していることを確認する（participants.is_guestだけを
-- 見る実装だと、これらのテストは失敗するはずである）。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id, is_anonymous) values
  ('c0000000-0000-0000-0000-00000000000f', false), -- host(admin)
  ('c0000000-0000-0000-0000-00000000000b', false)   -- xuser1（通常のXログインユーザー）
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'c0000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('c0100000-0000-0000-0000-000000000001', '0071テスト用お題1', 'text', true),
  ('c0100000-0000-0000-0000-000000000002', '0071テスト用お題2', 'text', true),
  ('c0100000-0000-0000-0000-000000000003', '0071テスト用お題3', 'text', true),
  ('c0100000-0000-0000-0000-000000000004', '0071テスト用お題4', 'text', true)
on conflict do nothing;

create temporary table _t0071_ctx (key text primary key, val text);

-- ============================================================
-- テスト1: apply_live_rank_rewards（close_live経由）は、participants.is_guestが
--          falseでもprofiles.is_guestがtrueなら報酬付与の対象から除外する。
--          通常のXユーザーには従来通り正しく付与される（過剰除外になっていないことも確認）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_p1 uuid := 'c0000000-0000-0000-0000-00000000000b'; -- 通常のXユーザー
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000001a1';
  v_participant1 uuid;
  v_guest_participant uuid;
  v_group_id uuid;
  v_turn_id uuid;
  v_close_result record;
  v_p1_before int;
  v_p1_after int;
  v_guest_before record;
  v_guest_after record;
  v_ph_count int;
begin
  -- 「認証済みゲスト（profiles.is_guest=true）」のauth.users/profiles行を用意する。
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;
  if (select is_guest from public.profiles where id = v_guest_uid) is not true then
    raise exception 'FAIL: テスト前提が崩れている（匿名ユーザーのprofiles.is_guestがtrueになっていない）';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-official報酬除外', 20, 1,
    array['c0100000-0000-0000-0000-000000000001']::uuid[], 'official'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  -- 通常のXユーザーはjoin_live経由で正規に参加する。
  set local role authenticated;
  perform set_config('myapp.uid', v_p1::text, true);
  perform public.join_live(v_live_id, 'player', null);
  reset role;
  select id into v_participant1 from public.participants where live_id = v_live_id and user_id = v_p1;
  -- randomize_groupsは経由しない簡略化のため、role='player'をここで直接確定させる
  -- （0068/0070テストと同じ考え方、採点集計対象はrole='player'のみ）。
  update public.participants set role = 'player' where id = v_participant1;

  -- 「ゲストがjoin_liveを経由せず直接participantsへINSERTした」状態を意図的に再現する
  -- （0010の列GRANTにより技術的に可能な経路、is_guest/guest_number列は指定できないため
  -- 常にis_guest=false・guest_number=nullになる＝ファイル冒頭コメント参照）。
  -- ここではRLSの対象外(superuser実行)で直接INSERTすることで、その状態を模擬する。
  insert into public.participants (live_id, user_id, preferred_role, role)
    values (v_live_id, v_guest_uid, 'player', 'player')
    returning id into v_guest_participant;
  if (select is_guest from public.participants where id = v_guest_participant) is not false then
    raise exception 'FAIL: テスト前提が崩れている（直接INSERTしたのにparticipants.is_guestがtrueになっている）';
  end if;

  -- randomize_groupsは経由せず、採点集計に必要な最小限のgroups/turns/answersだけを
  -- 直接用意する（0068/0070テストと同じ簡略化の考え方）。
  insert into public.groups (live_id, group_order) values (v_live_id, 1) returning id into v_group_id;
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (gen_random_uuid(), v_live_id, 1, v_group_id,
      (select id from public.topics where live_id = v_live_id limit 1),
      'done', 1)
    returning id into v_turn_id;

  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_participant1, 1, 'Xユーザーの回答', 80, true);
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_guest_participant, 1, 'ゲストの回答（is_guest=false参加者行）', 200, true);

  select mastery_meter into v_p1_before from public.profiles where id = v_p1;
  select mastery_meter, total_points, points_balance, live_count into v_guest_before
    from public.profiles where id = v_guest_uid;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select * into v_close_result from public.close_live(v_live_id);
  reset role;

  if v_close_result.rewards_applied is not true or v_close_result.rewards_error is not null then
    raise exception 'FAIL: 本番ライブのclose_liveが報酬付与に失敗した(applied=%, error=%)',
      v_close_result.rewards_applied, v_close_result.rewards_error;
  end if;

  -- Xユーザーは通常どおり付与される（得点80のみ、他に参加者がいないので1位扱い）。
  select mastery_meter into v_p1_after from public.profiles where id = v_p1;
  if v_p1_after - v_p1_before <> (10 + 80 + 100) then
    raise exception 'FAIL: 通常のXユーザーの獲得ポイントが想定と違う(想定=%, 実際=%)', 10 + 80 + 100, v_p1_after - v_p1_before;
  end if;

  -- ゲスト（participants.is_guest=falseだがprofiles.is_guest=true）は、得点200という
  -- 一番高い得点を出していても一切加算されない（participants.is_guestではなく
  -- profiles.is_guestで除外している証拠）。
  select mastery_meter, total_points, points_balance, live_count into v_guest_after
    from public.profiles where id = v_guest_uid;
  if v_guest_before.mastery_meter <> v_guest_after.mastery_meter
    or v_guest_before.total_points <> v_guest_after.total_points
    or v_guest_before.points_balance <> v_guest_after.points_balance
    or v_guest_before.live_count <> v_guest_after.live_count
  then
    raise exception 'FAIL: participants.is_guest=falseなゲスト（profiles.is_guest=true）に報酬が付与されてしまった';
  end if;

  select count(*) into v_ph_count from public.point_history where live_id = v_live_id and user_id = v_guest_uid;
  if v_ph_count <> 0 then
    raise exception 'FAIL: ゲストのpoint_historyが% 件作られている（0件のはず）', v_ph_count;
  end if;

  insert into _t0071_ctx (key, val) values
    ('reward_live_id', v_live_id::text),
    ('guest_uid', v_guest_uid::text),
    ('guest_participant', v_guest_participant::text),
    ('xuser_uid', v_p1::text);

  raise notice 'PASS: apply_live_rank_rewardsはprofiles.is_guestで判定し、participants.is_guest=falseのゲストも正しく除外する（通常のXユーザーには従来どおり付与）';
end $$;

-- ============================================================
-- テスト2: set_sns_live_result_manager_bestは、回答者がゲスト
--          （profiles.is_guest=true、participants.is_guest=falseの場合も含む）なら
--          運営ベストに選べない。通常のXユーザーの回答は従来どおり選べる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_guest_participant uuid;
  v_xuser_participant uuid;
  v_guest_uid uuid;
  v_xuser_uid uuid;
  v_result_id uuid;
  v_guest_answer_id uuid;
  v_xuser_answer_id uuid;
  v_turn_id uuid;
  v_failed boolean := false;
  v_notif_count int;
  v_xuser_points_before int;
  v_xuser_points_after int;
begin
  select val::uuid into v_live_id from _t0071_ctx where key = 'reward_live_id';
  select val::uuid into v_guest_participant from _t0071_ctx where key = 'guest_participant';
  select val::uuid into v_guest_uid from _t0071_ctx where key = 'guest_uid';
  select val::uuid into v_xuser_uid from _t0071_ctx where key = 'xuser_uid';
  select id into v_xuser_participant from public.participants where live_id = v_live_id and user_id = v_xuser_uid;

  insert into public.sns_live_results (id, live_id) values (gen_random_uuid(), v_live_id) returning id into v_result_id;

  select id into v_guest_answer_id from public.answers where turn_id in (
    select id from public.turns where live_id = v_live_id
  ) and participant_id = v_guest_participant limit 1;
  select id into v_xuser_answer_id from public.answers where turn_id in (
    select id from public.turns where live_id = v_live_id
  ) and participant_id = v_xuser_participant limit 1;

  select total_points into v_xuser_points_before from public.profiles where id = v_xuser_uid;

  -- ゲストの回答を運営ベストに選ぼうとすると拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.set_sns_live_result_manager_best(v_result_id, v_guest_answer_id);
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'ゲストの回答は運営ベストに選べません' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: ゲストの回答が運営ベストに選べてしまった';
  end if;

  -- 拒否された場合、notifications・manager_best_answer_idのどちらも変化しない。
  select count(*) into v_notif_count from public.notifications where user_id = v_guest_uid and type = 'manager_best';
  if v_notif_count <> 0 then
    raise exception 'FAIL: 拒否されたはずのゲストにmanager_best通知が作られている';
  end if;
  if (select manager_best_answer_id from public.sns_live_results where id = v_result_id) is not null then
    raise exception 'FAIL: 拒否されたはずなのにmanager_best_answer_idが設定されている';
  end if;

  -- 通常のXユーザーの回答は従来どおり運営ベストに選べる。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.set_sns_live_result_manager_best(v_result_id, v_xuser_answer_id);
  reset role;

  if (select manager_best_answer_id from public.sns_live_results where id = v_result_id) <> v_xuser_answer_id then
    raise exception 'FAIL: 通常のXユーザーの回答が運営ベストに設定されなかった';
  end if;
  select total_points into v_xuser_points_after from public.profiles where id = v_xuser_uid;
  if v_xuser_points_after - v_xuser_points_before <> 50 then
    raise exception 'FAIL: 通常のXユーザーが運営ベストで+50ポイント獲得しなかった(差分=%)', v_xuser_points_after - v_xuser_points_before;
  end if;

  raise notice 'PASS: set_sns_live_result_manager_bestはゲストの回答（profiles.is_guest判定）を拒否し、通常のXユーザーの回答は従来どおり選べる';
end $$;

-- ============================================================
-- テスト3: _compute_rank_reward_mismatches / fix_rank_reward_mismatchesは、
--          ゲストの取り消し忘れ（過去の誤った付与）を検知し、profiles.is_guestで
--          正しく除外する。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_guest_uid uuid;
  v_bogus_gain int := 999;
  v_mismatch record;
  v_found boolean := false;
  v_before record;
  v_after record;
  v_fix_row record;
  v_fix_found boolean := false;
begin
  select val::uuid into v_live_id from _t0071_ctx where key = 'reward_live_id';
  select val::uuid into v_guest_uid from _t0071_ctx where key = 'guest_uid';

  -- 「過去に誤ってゲストへ報酬が付与されてしまった」状態を模擬するため、
  -- point_historyへ直接不正な行を追加し、profilesへも同額加算しておく
  -- （superuser実行、監査・訂正ロジックの検証のためだけの意図的な不整合）。
  insert into public.point_history (user_id, live_id, points, mastery, label)
    values (v_guest_uid, v_live_id, v_bogus_gain, v_bogus_gain, '第1回ライブ（誤って付与された分）');
  update public.profiles set
    mastery_meter = mastery_meter + v_bogus_gain,
    total_points = total_points + v_bogus_gain,
    points_balance = points_balance + v_bogus_gain,
    live_count = live_count + 1
  where id = v_guest_uid;

  select before.mastery_meter, before.total_points, before.points_balance, before.live_count
    into v_before
    from public.profiles before where before.id = v_guest_uid;

  -- _compute_rank_reward_mismatches()はSQL Editor等での保守運用専用の関数
  -- （0057、authenticated/anon/publicいずれからもEXECUTE不可）のため、
  -- authenticatedロールへ切り替えず、接続ロールのまま（0068監査テストと同じ
  -- 「SQL Editor相当」の扱い）呼び出す。ゲストをcorrect（本来あるべき報酬）から
  -- 除外しているため、上で仕込んだrecorded分がまるごと「差分」として検出される。
  for v_mismatch in select * from public._compute_rank_reward_mismatches() where out_live_id = v_live_id and out_user_id = v_guest_uid loop
    v_found := true;
    if v_mismatch.out_correct_exists is not false then
      raise exception 'FAIL: ゲストなのにout_correct_existsがtrueになっている（監査からゲストが除外されていない）';
    end if;
    if v_mismatch.out_gain_delta <> -v_bogus_gain then
      raise exception 'FAIL: ゲストの訂正額が想定と違う(想定=%, 実際=%)', -v_bogus_gain, v_mismatch.out_gain_delta;
    end if;
  end loop;
  if not v_found then
    raise exception 'FAIL: 仕込んだゲストの不整合が_compute_rank_reward_mismatchesで検出されなかった';
  end if;

  -- fix_rank_reward_mismatchesを実行すると、仕込んだ分がちょうど打ち消される
  -- （最終的にテスト1終了時点の値に戻る）。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  for v_fix_row in select * from public.fix_rank_reward_mismatches(v_live_id) where out_user_id = v_guest_uid loop
    v_fix_found := true;
    if v_fix_row.out_delta <> -v_bogus_gain then
      raise exception 'FAIL: fix_rank_reward_mismatchesの訂正額が想定と違う(想定=%, 実際=%)', -v_bogus_gain, v_fix_row.out_delta;
    end if;
  end loop;
  reset role;
  if not v_fix_found then
    raise exception 'FAIL: fix_rank_reward_mismatchesがゲストの不整合を訂正しなかった';
  end if;

  select mastery_meter, total_points, points_balance, live_count into v_after
    from public.profiles where id = v_guest_uid;
  if v_after.mastery_meter <> v_before.mastery_meter - v_bogus_gain
    or v_after.total_points <> v_before.total_points - v_bogus_gain
    or v_after.points_balance <> v_before.points_balance - v_bogus_gain
  then
    raise exception 'FAIL: fix_rank_reward_mismatches後もゲストのポイントが正しく訂正されていない';
  end if;

  raise notice 'PASS: _compute_rank_reward_mismatches/fix_rank_reward_mismatchesはゲスト（profiles.is_guest）を監査対象から除外し、過去の誤付与を正しく訂正する';
end $$;

drop table _t0071_ctx;

-- ============================================================
-- テスト4: 不変条件（トリガー）：officialライブへis_guest=trueのparticipantを
--          直接追加できない。is_guest=falseの通常行は従来どおり追加できる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_failed boolean := false;
  v_p uuid := 'c0000000-0000-0000-0000-00000000000b';
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-official直接INSERT拒否', 20, 1,
    array['c0100000-0000-0000-0000-000000000002']::uuid[], 'official'
  );
  reset role;

  begin
    insert into public.participants (live_id, user_id, preferred_role, role, is_guest, guest_number)
      values (v_live_id, gen_random_uuid(), 'audience', 'audience', true, 1);
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PARTICIPANT_NOT_ALLOWED_ON_OFFICIAL_LIVE' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: officialライブへis_guest=trueのparticipantが直接追加できてしまった';
  end if;

  -- is_guest=falseの通常行は従来どおり追加できる（回帰確認）。
  insert into public.participants (live_id, user_id, preferred_role, role)
    values (v_live_id, v_p, 'audience', 'audience');
  if not exists (select 1 from public.participants where live_id = v_live_id and user_id = v_p and is_guest = false) then
    raise exception 'FAIL: is_guest=falseの通常行がofficialライブへ追加できなくなっている（過剰ブロック）';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: officialライブへのis_guest=true直接INSERTはトリガーで拒否され、is_guest=falseの通常行は従来どおり追加できる';
end $$;

-- ============================================================
-- テスト5: 不変条件（トリガー）：テストライブにゲスト参加者がいる状態から
--          officialへ変更できない。ゲストがいなければ従来どおり変更できる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_live_id_no_guest uuid;
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000002a2';
  v_failed boolean := false;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-test to official拒否', 20, 1,
    array['c0100000-0000-0000-0000-000000000003']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  perform public.join_live(v_live_id, 'audience', null);
  reset role;

  begin
    update public.lives set live_mode = 'official' where id = v_live_id;
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'OFFICIAL_TRANSITION_BLOCKED_GUEST_PRESENT' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: ゲスト参加者がいるテストライブがofficialへ変更できてしまった';
  end if;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  -- ゲストがいないテストライブは、従来どおりofficialへ変更できる（回帰確認、
  -- アプリのフロントは実際にはこの変更を行わないが、トリガーが無関係なケースまで
  -- ブロックしていないことを確認する）。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id_no_guest from public.create_live_preparation(
    now(), '0071テスト-ゲスト無しは変更可能', 20, 1,
    array['c0100000-0000-0000-0000-000000000004']::uuid[], 'test'
  );
  reset role;
  -- lives_official_sequence_consistency_check（0068）はlive_mode='official'なら
  -- official_sequence_numberが必須のため、このテストの主目的（トリガーが無関係な
  -- ケースまでブロックしていないことの確認）に必要な最小限として明示的に採番する。
  update public.lives
    set live_mode = 'official',
        official_sequence_number = (select coalesce(max(official_sequence_number), 0) + 1 from public.lives)
    where id = v_live_id_no_guest;
  if (select live_mode from public.lives where id = v_live_id_no_guest) <> 'official' then
    raise exception 'FAIL: ゲストがいないライブのlive_mode変更が想定外に拒否された';
  end if;
  update public.lives set current_phase = 'closed' where id = v_live_id_no_guest;

  raise notice 'PASS: ゲスト参加者がいるテストライブはofficialへ変更できず、ゲストがいなければ従来どおり変更できる';
end $$;

-- ============================================================
-- テスト6: ゲストの寄合券初期値は0（新規作成）。既存のゲスト行の補正
--          （0071のUPDATE文）は、is_guest=trueの行だけに安全に絞られている
--          （通常会員(is_guest=false)の寄合券には一切触れない）。
-- ============================================================
do $$
declare
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000003a3';
  v_xuser_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_guest_tickets int;
  v_xuser_tickets_before int;
  v_xuser_tickets_after int;
  v_guest_tickets_after int;
begin
  -- 新規作成：匿名ゲストのtickets_countは0（通常会員のデフォルト5ではない）。
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;
  select tickets_count into v_guest_tickets from public.profiles where id = v_guest_uid;
  if v_guest_tickets <> 0 then
    raise exception 'FAIL: 新規匿名ゲストのtickets_countが0ではない(実際=%)', v_guest_tickets;
  end if;

  -- 「0071適用前に作られた行」を模擬するため、ゲスト行のtickets_countを
  -- 手動で書き換えた上で、0071と全く同じ補正UPDATE文を再実行し、ゲストだけが
  -- 補正され、通常会員(is_guest=false)の寄合券には一切触れないことを確認する。
  update public.profiles set tickets_count = 3 where id = v_guest_uid;
  select tickets_count into v_xuser_tickets_before from public.profiles where id = v_xuser_uid;

  update public.profiles set tickets_count = 0 where is_guest = true and tickets_count <> 0;

  select tickets_count into v_guest_tickets_after from public.profiles where id = v_guest_uid;
  select tickets_count into v_xuser_tickets_after from public.profiles where id = v_xuser_uid;
  if v_guest_tickets_after <> 0 then
    raise exception 'FAIL: 補正UPDATE文の再実行後もゲストのtickets_countが0になっていない(実際=%)', v_guest_tickets_after;
  end if;
  if v_xuser_tickets_after <> v_xuser_tickets_before then
    raise exception 'FAIL: 補正UPDATE文が通常会員(is_guest=false)の寄合券に影響してしまった(前=%, 後=%)', v_xuser_tickets_before, v_xuser_tickets_after;
  end if;

  raise notice 'PASS: 新規匿名ゲストの寄合券は0が初期値であり、既存ゲスト行の補正UPDATE文はis_guest=trueの行だけに安全に絞られている';
end $$;

-- ============================================================
-- テスト7: ゲストがlog_share_clickを呼んでも分析行が増えない
--          （エラーにはならず、静かに無視される）。通常のXユーザーは従来どおり記録される。
-- ============================================================
do $$
declare
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000004a4';
  v_xuser_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_guest_count int;
  v_xuser_count_before int;
  v_xuser_count_after int;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;

  select count(*) into v_xuser_count_before from public.share_click_events where user_id = v_xuser_uid;

  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  perform public.log_share_click('live_schedule');
  reset role;

  select count(*) into v_guest_count from public.share_click_events where user_id = v_guest_uid;
  if v_guest_count <> 0 then
    raise exception 'FAIL: ゲストのlog_share_clickで分析行が作られてしまった(件数=%)', v_guest_count;
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  perform public.log_share_click('live_schedule');
  reset role;

  select count(*) into v_xuser_count_after from public.share_click_events where user_id = v_xuser_uid;
  if v_xuser_count_after <> v_xuser_count_before + 1 then
    raise exception 'FAIL: 通常のXユーザーのlog_share_clickで分析行が記録されなかった(前=%, 後=%)', v_xuser_count_before, v_xuser_count_after;
  end if;

  raise notice 'PASS: ゲストのlog_share_clickは分析行を作らず静かに無視し、通常のXユーザーは従来どおり記録される';
end $$;

-- ============================================================
-- テスト8: sns_author_namesはゲストのプロフィールを返さない
--          （通常のXユーザーは従来どおり返る）。
-- ============================================================
do $$
declare
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000005a5';
  v_xuser_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_rows int;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;

  select count(*) into v_rows from public.sns_author_names(array[v_guest_uid, v_xuser_uid]);
  if v_rows <> 1 then
    raise exception 'FAIL: sns_author_namesがゲスト+Xユーザーの2件中%件返した（1件のはず）', v_rows;
  end if;
  if exists (select 1 from public.sns_author_names(array[v_guest_uid, v_xuser_uid]) where id = v_guest_uid) then
    raise exception 'FAIL: sns_author_namesがゲストのプロフィールを返してしまった';
  end if;
  if not exists (select 1 from public.sns_author_names(array[v_guest_uid, v_xuser_uid]) where id = v_xuser_uid) then
    raise exception 'FAIL: sns_author_namesが通常のXユーザーのプロフィールを返さなかった';
  end if;

  raise notice 'PASS: sns_author_namesはゲストのプロフィールを除外し、通常のXユーザーは従来どおり返す';
end $$;

-- ============================================================
-- テスト9（回帰確認）：通常のXユーザーはテストライブへも公式ライブへも従来どおり
--          参加でき、会員機能（SNS投稿・いいね・フォロー）も利用できる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_xuser_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_topic_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-Xユーザー回帰確認', 20, 1,
    array['c0100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  perform public.join_live(v_live_id, 'player', null);
  reset role;
  if not exists (select 1 from public.participants where live_id = v_live_id and user_id = v_xuser_uid) then
    raise exception 'FAIL: 通常のXユーザーがテストライブへ参加できなくなっている';
  end if;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  select id into v_topic_id from public.submit_sns_topic('0071回帰確認用のお題投稿');
  reset role;
  if v_topic_id is null then
    raise exception 'FAIL: 通常のXユーザーがsubmit_sns_topicできなくなっている';
  end if;

  raise notice 'PASS: 通常のXユーザーはテストライブへの参加・SNS投稿を従来どおり行える（回帰確認）';
end $$;

select 'ALL 0071 TESTS PASSED' as result;
