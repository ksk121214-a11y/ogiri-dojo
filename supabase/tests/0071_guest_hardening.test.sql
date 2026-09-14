-- 0071 回帰テスト：0070（ゲスト参加）レビュー対応の権限境界・報酬除外の確認。
-- 実行方法は supabase/tests/run.sh 参照。
--
-- 【重要】設計原則の検証について：
-- participants.is_guestは「表示用フラグ」に過ぎず、0010の列GRANT
-- （grant insert (live_id, user_id, preferred_role) on public.participants）
-- により、is_guest/guest_number列を指定しない直接INSERTが技術的に可能なため、
-- 「is_guest=falseだが実際はゲスト（profiles.is_guest=true）」という参加者行が
-- 作られうる。本ファイルのテスト1・2・3は、まさにこの状態を意図的に
-- 作り、報酬付与・監査・運営ベスト選出がparticipants.is_guestではなく
-- profiles.is_guestで正しく判定していることを確認する（participants.is_guestだけを
-- 見る実装だと、これらのテストは失敗するはずである）。これらのテスト内の直接INSERTは
-- いずれも接続ロールのまま（authenticatedへ切り替えず）実行しており、その状態を
-- 意図的に再現する目的の操作であって、「authenticatedロールから実際にこれが可能」
-- という意味ではない（再々レビュー対応でauthenticated自身の直接INSERT経路は
-- 12番で完全に閉じ、テスト12で検証している）。
--
-- 【再々レビュー対応】以前は0010の列GRANTにより、authenticated（ゲストも含む）が
-- join_live()を経由せず直接participantsへINSERTでき、定員・フェーズ・利用停止・
-- キック済み等のjoin_live内の全チェックを回避できる状態だった。12番でこの列GRANTと
-- participants_insert_selfポリシーを両方とも撤去し、参加登録をjoin_live経由のみに
-- 一本化した。テスト4・4b・5b内の直接INSERT（トリガーの多層防御を検証する目的）は
-- 引き続き接続ロールのまま行うため12番の影響を受けないが、テスト12で
-- 「authenticated自身による直接INSERTは（ゲストか通常会員かに関わらず）権限エラーに
-- なり、join_liveは従来どおり機能する」ことを別途検証する。

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
  ('c0100000-0000-0000-0000-000000000004', '0071テスト用お題4', 'text', true),
  ('c0100000-0000-0000-0000-000000000005', '0071テスト用お題5', 'text', true),
  ('c0100000-0000-0000-0000-000000000006', '0071テスト用お題6', 'text', true),
  ('c0100000-0000-0000-0000-000000000007', '0071テスト用お題7', 'text', true)
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
  -- 再レビュー対応：_guard_participants_guest_audience_only（下記テスト4b/5bで
  -- 別途検証）がこの不整合な組み合わせ自体をトリガーで拒否するようになったため、
  -- 「トリガーをすり抜けて実際にこの行が出来てしまった場合」を想定した
  -- apply_live_rank_rewards側の独立した防御（このテストの本来の目的）を検証する
  -- ため、ここだけ一時的にトリガーを無効化して意図的に不整合行を作る。
  set session_replication_role = replica;
  insert into public.participants (live_id, user_id, preferred_role, role)
    values (v_live_id, v_guest_uid, 'player', 'player')
    returning id into v_guest_participant;
  set session_replication_role = origin;
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

  -- 再レビュー対応：ゲストの回答を「掲載候補(sns_live_result_answers)へ
  -- あらかじめ紐づけた状態」で拒否されることを確認する。以前はこの紐づけを
  -- 一切行っておらず、「sns_live_result_answersに該当行が無い」という別の理由で
  -- 拒否されていた可能性があった（＝ゲスト判定自体は検証できていなかった）ため、
  -- ここで明示的に紐づけてから呼び出し、拒否理由がゲスト判定によるものだと
  -- 確定させる。
  insert into public.sns_live_result_answers (live_result_id, answer_id, included)
    values (v_result_id, v_guest_answer_id, true);

  -- ゲストの回答を運営ベストに選ぼうとすると拒否される（再レビュー対応で
  -- 単一のANSWER_NOT_ELIGIBLE_FOR_MANAGER_BESTへ統一された）。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.set_sns_live_result_manager_best(v_result_id, v_guest_answer_id);
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'ANSWER_NOT_ELIGIBLE_FOR_MANAGER_BEST' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 掲載候補に紐づけ済みのゲストの回答が運営ベストに選べてしまった';
  end if;

  -- 拒否された場合、notifications・manager_best_answer_id・
  -- manager_best_bonus_grantedのどれも一切変化しない。
  select count(*) into v_notif_count from public.notifications where user_id = v_guest_uid and type = 'manager_best';
  if v_notif_count <> 0 then
    raise exception 'FAIL: 拒否されたはずのゲストにmanager_best通知が作られている';
  end if;
  if (select manager_best_answer_id from public.sns_live_results where id = v_result_id) is not null then
    raise exception 'FAIL: 拒否されたはずなのにmanager_best_answer_idが設定されている';
  end if;
  if (
    select manager_best_bonus_granted from public.sns_live_result_answers
    where live_result_id = v_result_id and answer_id = v_guest_answer_id
  ) is not false then
    raise exception 'FAIL: 拒否されたはずなのにゲストの回答のmanager_best_bonus_grantedがtrueになっている';
  end if;

  -- 再レビュー対応：p_answer_idはsns_live_result_answersに(live_result_id,
  -- answer_id)の組み合わせで存在することも必須条件のため、管理画面が実際に行う
  -- （掲載候補として upsert してから manager_best を設定する）手順を模した準備をする。
  insert into public.sns_live_result_answers (live_result_id, answer_id, included)
    values (v_result_id, v_xuser_answer_id, true);

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
  if (
    select manager_best_bonus_granted from public.sns_live_result_answers
    where live_result_id = v_result_id and answer_id = v_xuser_answer_id
  ) is not true then
    raise exception 'FAIL: 通常のXユーザーの回答でmanager_best_bonus_grantedがtrueにならなかった';
  end if;

  -- 再レビュー対応：同じ回答へ再実行しても二重付与されない（既存のdedup、
  -- manager_best_bonus_grantedによる回帰確認）。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.set_sns_live_result_manager_best(v_result_id, v_xuser_answer_id);
  reset role;
  select total_points into v_xuser_points_after from public.profiles where id = v_xuser_uid;
  if v_xuser_points_after - v_xuser_points_before <> 50 then
    raise exception 'FAIL: 同じ回答への再実行でポイントが二重付与された(差分=%)', v_xuser_points_after - v_xuser_points_before;
  end if;
  if (
    select manager_best_bonus_granted from public.sns_live_result_answers
    where live_result_id = v_result_id and answer_id = v_xuser_answer_id
  ) is not true then
    raise exception 'FAIL: 再実行後もmanager_best_bonus_grantedがtrueのままになっていない';
  end if;

  insert into _t0071_ctx (key, val) values
    ('manager_best_live_id', v_live_id::text),
    ('manager_best_result_id', v_result_id::text),
    ('manager_best_xuser_answer_id', v_xuser_answer_id::text);

  raise notice 'PASS: set_sns_live_result_manager_bestはゲストの回答（profiles.is_guest判定）を拒否し、通常のXユーザーの回答は従来どおり選べ、再実行しても二重付与されない';
end $$;

-- ============================================================
-- テスト2b（再レビュー対応）：set_sns_live_result_manager_bestは、p_answer_idが
--          別ライブの回答IDだったり、掲載候補(sns_live_result_answers)に存在
--          しない回答IDだったりする場合も拒否する（ポイント・通知も一切付与されない）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_result_id uuid;
  v_xuser_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_other_live_id uuid;
  v_other_participant uuid;
  v_other_group_id uuid;
  v_other_turn_id uuid;
  v_other_answer_id uuid;
  v_no_row_turn_id uuid;
  v_no_row_answer_id uuid;
  v_failed boolean := false;
  v_points_before int;
  v_points_after int;
begin
  select val::uuid into v_live_id from _t0071_ctx where key = 'manager_best_live_id';
  select val::uuid into v_result_id from _t0071_ctx where key = 'manager_best_result_id';

  -- 「別ライブ」を1本用意し、そこにも通常Xユーザーの確定済み回答を1件作る。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_other_live_id from public.create_live_preparation(
    now(), '0071再レビュー-別ライブ(クロスライブ攻撃検証用)', 20, 1,
    array['c0100000-0000-0000-0000-000000000006']::uuid[], 'official'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_other_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  perform public.join_live(v_other_live_id, 'player', null);
  reset role;
  select id into v_other_participant from public.participants where live_id = v_other_live_id and user_id = v_xuser_uid;
  update public.participants set role = 'player' where id = v_other_participant;
  insert into public.groups (live_id, group_order) values (v_other_live_id, 1) returning id into v_other_group_id;
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (gen_random_uuid(), v_other_live_id, 1, v_other_group_id,
      (select id from public.topics where live_id = v_other_live_id limit 1),
      'done', 1)
    returning id into v_other_turn_id;
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_other_turn_id, v_other_live_id, v_other_participant, 1, '別ライブの回答', 999, true)
    returning id into v_other_answer_id;
  update public.lives set current_phase = 'closed' where id = v_other_live_id;

  select total_points into v_points_before from public.profiles where id = v_xuser_uid;

  -- 再レビュー対応：別ライブの回答を、意図的に「元のlive_resultの掲載候補」として
  -- 紐づけておく（管理画面のバグ・不正操作等で実際にこの行が出来てしまった状況を
  -- 模す）。この紐づけをしないと、「sns_live_result_answersに該当行が無い」という
  -- 別の理由で拒否されてしまい、live_id不一致の検証にならない。
  insert into public.sns_live_result_answers (live_result_id, answer_id, included)
    values (v_result_id, v_other_answer_id, true);

  -- 別ライブの回答ID（同じv_xuser_uid本人の回答だが、live_resultの対象ライブとは
  -- 別のライブに属する）をv_result_id（元のライブ）へ運営ベストとして渡すと拒否される。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.set_sns_live_result_manager_best(v_result_id, v_other_answer_id);
  exception
    when others then
      if sqlerrm = 'ANSWER_NOT_ELIGIBLE_FOR_MANAGER_BEST' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 別ライブの回答IDが運営ベストに設定できてしまった（クロスライブ攻撃が成立している）';
  end if;
  select total_points into v_points_after from public.profiles where id = v_xuser_uid;
  if v_points_after <> v_points_before then
    raise exception 'FAIL: 別ライブの回答IDが拒否されたはずなのにポイントが変化した(前=%, 後=%)', v_points_before, v_points_after;
  end if;
  if (
    select count(*) from public.notifications
    where user_id = v_xuser_uid and type = 'manager_best' and created_at > now() - interval '1 minute'
  ) > 1 then
    raise exception 'FAIL: 別ライブの回答IDが拒否されたはずなのにmanager_best通知が新たに作られた';
  end if;
  if (select manager_best_answer_id from public.sns_live_results where id = v_result_id) = v_other_answer_id then
    raise exception 'FAIL: 別ライブの回答IDがmanager_best_answer_idに設定されてしまった';
  end if;
  if (
    select manager_best_bonus_granted from public.sns_live_result_answers
    where live_result_id = v_result_id and answer_id = v_other_answer_id
  ) is not false then
    raise exception 'FAIL: 別ライブの回答が拒否されたはずなのにmanager_best_bonus_grantedがtrueになっている';
  end if;

  -- sns_live_result_answersに対応する行が無い回答ID（v_live_id内の確定済み・
  -- playerの回答だが、掲載候補として一度もupsertされていない）も同様に拒否される。
  -- v_live_id内の既存turnに、通常Xユーザーの2件目の回答として直接insertする
  -- （そもそも掲載候補にupsertしていない状態を再現するのが目的）。
  select t.id into v_no_row_turn_id from public.turns t where t.live_id = v_live_id limit 1;
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    select v_no_row_turn_id, v_live_id, p.id, 2, '掲載候補にしていない回答', 10, true
    from public.participants p
    where p.live_id = v_live_id and p.user_id = v_xuser_uid
    returning id into v_no_row_answer_id;

  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.set_sns_live_result_manager_best(v_result_id, v_no_row_answer_id);
  exception
    when others then
      if sqlerrm = 'ANSWER_NOT_ELIGIBLE_FOR_MANAGER_BEST' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: sns_live_result_answersに掲載候補として存在しない回答IDが運営ベストに設定できてしまった';
  end if;
  if (select manager_best_answer_id from public.sns_live_results where id = v_result_id) = v_no_row_answer_id then
    raise exception 'FAIL: 掲載候補外の回答IDがmanager_best_answer_idに設定されてしまった';
  end if;
  select total_points into v_points_after from public.profiles where id = v_xuser_uid;
  if v_points_after <> v_points_before then
    raise exception 'FAIL: 掲載候補外の回答IDが拒否されたはずなのにポイントが変化した(前=%, 後=%)', v_points_before, v_points_after;
  end if;

  raise notice 'PASS: set_sns_live_result_manager_bestは別ライブの回答ID・掲載候補に存在しない回答IDのどちらも拒否する（クロスライブ攻撃対策）';
end $$;

-- ============================================================
-- テスト2c（再レビュー対応）：set_sns_live_result_manager_bestは、存在しない
--          live_result_idを渡された場合、無言で成功せず制御されたエラーになる
--          （以前はp_answer_id=nullの場合に限り、最後のUPDATEが0件ヒットのまま
--          エラー無しで成功したように見えていた）。
-- ============================================================
do $$
declare
  v_bogus_id uuid := gen_random_uuid();
  v_failed boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.set_sns_live_result_manager_best(v_bogus_id, null);
  exception
    when others then
      if sqlerrm = 'LIVE_RESULT_NOT_FOUND' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 存在しないlive_result_idを渡しても無言で成功してしまった（p_answer_id=nullケース）';
  end if;

  -- p_answer_idを指定した場合も同様に、存在チェックの時点で拒否される。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.set_sns_live_result_manager_best(v_bogus_id, gen_random_uuid());
  exception
    when others then
      if sqlerrm = 'LIVE_RESULT_NOT_FOUND' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 存在しないlive_result_idを渡しても無言で成功してしまった（p_answer_id指定ケース）';
  end if;

  raise notice 'PASS: set_sns_live_result_manager_bestは存在しないlive_result_idを渡された場合、無言で成功せずLIVE_RESULT_NOT_FOUNDで拒否する';
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
-- テスト4（2026-09-13ゲスト観客対応で全面書き換え）：不変条件（トリガー）：
--          ゲスト（participants.is_guest=true）はpreferred_role/role='player'・
--          group_id指定のいずれでも直接INSERTできない（live_modeを問わない、
--          officialでも同じ結果になる）。observer(audience)・group_id無しでの
--          直接INSERTは通る（トリガーが無関係な行までブロックしていないことの
--          回帰確認）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_failed boolean := false;
  v_group_id uuid;
  -- FK制約(participants_user_id_fkey)を満たすため、gen_random_uuid()ではなく
  -- 実在するprofiles行（4件それぞれ別のauth.users）を使う。
  v_u1 uuid := 'c0000000-0000-0000-0000-00000000b401';
  v_u2 uuid := 'c0000000-0000-0000-0000-00000000b402';
  v_u3 uuid := 'c0000000-0000-0000-0000-00000000b403';
  v_u4 uuid := 'c0000000-0000-0000-0000-00000000b404';
begin
  insert into auth.users (id, is_anonymous) values
    (v_u1, true), (v_u2, true), (v_u3, true), (v_u4, true)
  on conflict do nothing;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-ゲストplayer直接INSERT拒否', 20, 1,
    array['c0100000-0000-0000-0000-000000000002']::uuid[], 'official'
  );
  reset role;
  insert into public.groups (live_id, group_order) values (v_live_id, 1) returning id into v_group_id;

  -- preferred_role='player'は拒否される。
  v_failed := false;
  begin
    insert into public.participants (live_id, user_id, preferred_role, role, is_guest, guest_number)
      values (v_live_id, v_u1, 'player', 'audience', true, 1);
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(preferred_role=player, %)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: is_guest=trueでpreferred_role=playerが直接INSERTできてしまった';
  end if;

  -- role='player'も拒否される。
  v_failed := false;
  begin
    insert into public.participants (live_id, user_id, preferred_role, role, is_guest, guest_number)
      values (v_live_id, v_u2, 'audience', 'player', true, 2);
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(role=player, %)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: is_guest=trueでrole=playerが直接INSERTできてしまった';
  end if;

  -- group_id指定も拒否される（role/preferred_roleがaudienceのままでも）。
  v_failed := false;
  begin
    insert into public.participants (live_id, user_id, preferred_role, role, group_id, is_guest, guest_number)
      values (v_live_id, v_u3, 'audience', 'audience', v_group_id, true, 3);
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(group_id指定, %)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: is_guest=trueでgroup_id指定が直接INSERTできてしまった';
  end if;

  -- audience/group_id無しでの直接INSERTは通る（過剰ブロックになっていないことの確認）。
  insert into public.participants (live_id, user_id, preferred_role, role, is_guest, guest_number)
    values (v_live_id, v_u4, 'audience', 'audience', true, 4);
  if not exists (
    select 1 from public.participants
    where live_id = v_live_id and is_guest = true and guest_number = 4 and role = 'audience' and group_id is null
  ) then
    raise exception 'FAIL: is_guest=trueのobserver行が直接INSERTできなくなっている（過剰ブロック）';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: is_guest=trueのparticipantはpreferred_role/role=player・group_id指定のいずれも直接INSERTできず、observer行は従来どおり作成できる';
end $$;

-- ============================================================
-- テスト4b: 不変条件（トリガー）：participants.is_guestを指定しない直接INSERT
--          （0010の列GRANTにより理論上はauthenticatedから可能だった経路の模擬）で、
--          profiles.is_guest=trueのユーザーをpreferred_role='player'として
--          追加しようとしても拒否される（is_guest=false（列デフォルト）だが
--          profiles.is_guest=trueという不整合を、トリガー自身がprofiles側まで
--          確認して検知する）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000006a6';
  v_failed boolean := false;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;
  if (select is_guest from public.profiles where id = v_guest_uid) is not true then
    raise exception 'FAIL: テスト前提が崩れている（匿名ユーザーのprofiles.is_guestがtrueになっていない）';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071再レビュー-player直接INSERT拒否(profiles.is_guest不整合)', 20, 1,
    array['c0100000-0000-0000-0000-000000000002']::uuid[], 'test'
  );
  reset role;

  -- is_guest列を指定せずに直接INSERTする（デフォルトfalse＝
  -- 「participants.is_guest=falseだがprofiles.is_guest=trueの参加者」を再現）。
  begin
    insert into public.participants (live_id, user_id, preferred_role, role)
      values (v_live_id, v_guest_uid, 'player', 'audience');
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: participants.is_guest=falseだがprofiles.is_guest=trueの参加者がpreferred_role=playerで追加できてしまった';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: participants.is_guestだけでなくprofiles.is_guestでも判定され、不整合な参加者のplayer化は拒否される';
end $$;

-- ============================================================
-- テスト5（2026-09-13ゲスト観客対応で全面書き換え）：不変条件（トリガー）：
--          ゲスト参加者の行を直接UPDATEしてpreferred_role/role='player'・
--          group_id指定へ変更することもできない。また、ゲスト観客がいる
--          テストライブをofficialへ変更すること自体は、新仕様では拒否されない
--          （「officialライブにゲストが存在すること自体を禁止する」旧仕様の
--          不変条件トリガーは、新仕様と矛盾するため廃止した）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000002a2';
  v_guest_participant uuid;
  v_group_id uuid;
  v_failed boolean := false;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-ゲストplayer直接UPDATE拒否', 20, 1,
    array['c0100000-0000-0000-0000-000000000003']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  perform public.join_live(v_live_id, 'audience', null);
  reset role;
  select id into v_guest_participant from public.participants where live_id = v_live_id and user_id = v_guest_uid;
  insert into public.groups (live_id, group_order) values (v_live_id, 1) returning id into v_group_id;

  -- 直接UPDATEでpreferred_role='player'に変更しようとすると拒否される。
  v_failed := false;
  begin
    update public.participants set preferred_role = 'player' where id = v_guest_participant;
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(preferred_role更新, %)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: ゲストのpreferred_roleをplayerへ直接UPDATEできてしまった';
  end if;

  -- role='player'への直接UPDATEも拒否される。
  v_failed := false;
  begin
    update public.participants set role = 'player' where id = v_guest_participant;
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(role更新, %)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: ゲストのroleをplayerへ直接UPDATEできてしまった';
  end if;

  -- group_idへの直接UPDATEも拒否される。
  v_failed := false;
  begin
    update public.participants set group_id = v_group_id where id = v_guest_participant;
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(group_id更新, %)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: ゲストのgroup_idを直接UPDATEできてしまった';
  end if;

  -- ゲスト観客がいる状態のまま、officialへの変更自体は拒否されない
  -- （新仕様：ゲストは本番ライブへも観客として参加できるため）。
  update public.lives
    set live_mode = 'official',
        official_sequence_number = (select coalesce(max(official_sequence_number), 0) + 1 from public.lives)
    where id = v_live_id;
  if (select live_mode from public.lives where id = v_live_id) <> 'official' then
    raise exception 'FAIL: ゲスト観客がいるライブをofficialへ変更できなかった（新仕様と矛盾する古い制限が残っている）';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: ゲスト参加者の行はpreferred_role/role/group_idのいずれも直接UPDATEでplayer化できず、ゲスト観客がいてもofficialへの変更自体は拒否されない';
end $$;

-- ============================================================
-- テスト5b: 不変条件（トリガー）：participants.is_guest=falseのままでも、
--          profiles.is_guest=trueのユーザーの行を直接UPDATEしてplayer化・
--          組所属させることはできない（5番と同じ構図をprofiles結合で検知）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000007a7';
  v_participant_id uuid;
  v_group_id uuid;
  v_failed boolean := false;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;
  if (select is_guest from public.profiles where id = v_guest_uid) is not true then
    raise exception 'FAIL: テスト前提が崩れている（匿名ユーザーのprofiles.is_guestがtrueになっていない）';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071再レビュー-player直接UPDATE拒否(profiles.is_guest不整合)', 20, 1,
    array['c0100000-0000-0000-0000-000000000005']::uuid[], 'test'
  );
  reset role;

  -- is_guest列を指定せずに直接INSERTする（audience/group_id無しなので、
  -- 4b同様「不整合な参加者」自体はここでは問題なく作成できる）。
  insert into public.participants (live_id, user_id, preferred_role, role)
    values (v_live_id, v_guest_uid, 'audience', 'audience')
    returning id into v_participant_id;
  insert into public.groups (live_id, group_order) values (v_live_id, 1) returning id into v_group_id;

  v_failed := false;
  begin
    update public.participants set role = 'player', group_id = v_group_id where id = v_participant_id;
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: participants.is_guest=falseだがprofiles.is_guest=trueの参加者をplayer化・組所属させられてしまった';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: participants.is_guest=falseだがprofiles.is_guest=trueという不整合な参加者も、直接UPDATEでplayer化・組所属させられない';
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

-- ============================================================
-- テスト10（再レビュー対応）：notificationsの宛先がゲストなら、直接INSERT
--          （is_host()のRLS経由）でもSECURITY DEFINER関数
--          （admin_apply_user_sanction）経由でも拒否される。
--          admin_apply_user_sanctionはゲストを警告・利用停止・解除の対象にできない。
-- ============================================================
do $$
declare
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000008a8';
  v_xuser_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_failed boolean := false;
  v_xuser_notif_before int;
  v_xuser_notif_after int;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;

  -- 直接INSERT（notifications_insert_hostのRLSはis_host()を満たすため通過するが、
  -- 新設のBEFORE INSERTトリガーが宛先のprofiles.is_guestを見て拒否する）。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  begin
    insert into public.notifications (user_id, type, title, body)
      values (v_guest_uid, 'warning', 'テスト', 'テスト本文');
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'NOTIFICATION_TARGET_IS_GUEST' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: ゲスト宛のnotifications直接INSERTが成功してしまった';
  end if;

  -- admin_apply_user_sanction（SECURITY DEFINER、RLSを経由しない）でも、
  -- ゲストを警告対象にすると拒否される（notifications・user_sanctions・
  -- admin_action_logsのどれも一切作られない）。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  v_failed := false;
  begin
    perform public.admin_apply_user_sanction(v_guest_uid, 'warning', 'テスト理由', null, null, null, 'テスト本文');
  exception
    when others then
      if sqlerrm = 'ゲストユーザーには警告・利用停止を行えません' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: admin_apply_user_sanctionがゲストを対象にできてしまった';
  end if;
  if exists (select 1 from public.user_sanctions where user_id = v_guest_uid) then
    raise exception 'FAIL: 拒否されたはずなのにゲストのuser_sanctions行が作られている';
  end if;
  if exists (select 1 from public.notifications where user_id = v_guest_uid and type = 'warning') then
    raise exception 'FAIL: 拒否されたはずなのにゲストへの警告notificationsが作られている';
  end if;

  -- 通常のXユーザーへの警告は従来どおり成功する（過剰ブロックになっていないことの確認）。
  select count(*) into v_xuser_notif_before from public.notifications where user_id = v_xuser_uid and type = 'warning';
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.admin_apply_user_sanction(v_xuser_uid, 'warning', 'テスト理由', null, null, null, 'テスト本文');
  reset role;
  select count(*) into v_xuser_notif_after from public.notifications where user_id = v_xuser_uid and type = 'warning';
  if v_xuser_notif_after <> v_xuser_notif_before + 1 then
    raise exception 'FAIL: 通常のXユーザーへの警告が従来どおり送れなくなっている';
  end if;
  if not exists (select 1 from public.user_sanctions where user_id = v_xuser_uid and type = 'warning') then
    raise exception 'FAIL: 通常のXユーザーへの警告でuser_sanctions行が作られなかった';
  end if;

  raise notice 'PASS: notifications宛先・admin_apply_user_sanctionの対象のどちらもゲストは拒否され、通常のXユーザーは従来どおり警告できる';
end $$;

-- ============================================================
-- テスト11（再レビュー対応）：sns_answer_likes/sns_follows/sns_live_result_likesの
--          DELETE（解除）ポリシーにもnot is_guest_user()が追加されており、
--          ゲスト名義の行（直接INSERTで意図的に用意したもの）はゲスト自身の
--          DELETEでは削除できない。通常のXユーザーは従来どおり解除できる。
--          寄合帳のお題投稿・回答投稿・ツッコミ投稿・削除・いいね・フォローの
--          RPC/直接INSERTをゲストが実行しても拒否されることも併せて確認する
--          （閲覧＝SELECTは許可されたままであることも確認する）。
-- ============================================================
do $$
declare
  v_guest_uid uuid := 'c0000000-0000-0000-0000-0000000009a9';
  v_xuser_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_host_uid uuid := 'c0000000-0000-0000-0000-00000000000f';
  v_topic_id uuid;
  v_answer_id uuid;
  v_live_id uuid;
  v_participant_id uuid;
  v_group_id uuid;
  v_turn_id uuid;
  v_live_answer_id uuid;
  v_result_id uuid;
  v_result_answer_row_id uuid;
  v_failed boolean := false;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;

  -- ---- 準備：通常のXユーザー名義で、いいね・フォロー対象となるお題・回答を作る。----
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  select id into v_topic_id from public.submit_sns_topic('0071テスト11用のお題投稿');
  select id into v_answer_id from public.submit_sns_answer(v_topic_id, '0071テスト11用の回答');
  reset role;

  -- ---- 準備：ライブ結果いいねの対象となる、確定済み・playerの回答を持つ
  --      公式ライブ（結果公開済み）を1本作る。----
  set local role authenticated;
  perform set_config('myapp.uid', v_host_uid::text, true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071再レビュー-DELETE policyテスト用ライブ', 20, 1,
    array['c0100000-0000-0000-0000-000000000007']::uuid[], 'official'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  perform public.join_live(v_live_id, 'player', null);
  reset role;
  select id into v_participant_id from public.participants where live_id = v_live_id and user_id = v_xuser_uid;
  update public.participants set role = 'player' where id = v_participant_id;
  insert into public.groups (live_id, group_order) values (v_live_id, 1) returning id into v_group_id;
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (gen_random_uuid(), v_live_id, 1, v_group_id,
      (select id from public.topics where live_id = v_live_id limit 1),
      'done', 1)
    returning id into v_turn_id;
  insert into public.answers (turn_id, live_id, participant_id, seq, body, score_total, resolved)
    values (v_turn_id, v_live_id, v_participant_id, 1, '0071テスト11用のライブ回答', 10, true)
    returning id into v_live_answer_id;
  update public.lives set current_phase = 'closed', results_published = true where id = v_live_id;
  insert into public.sns_live_results (id, live_id) values (gen_random_uuid(), v_live_id) returning id into v_result_id;
  insert into public.sns_live_result_answers (live_result_id, answer_id, included)
    values (v_result_id, v_live_answer_id, true)
    returning id into v_result_answer_row_id;

  -- ---- 1) sns_answer_likes：ゲスト名義の行はゲスト自身のDELETEでは削除できない。----
  insert into public.sns_answer_likes (answer_id, user_id) values (v_answer_id, v_guest_uid);
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  delete from public.sns_answer_likes where answer_id = v_answer_id and user_id = v_guest_uid;
  reset role;
  if not exists (select 1 from public.sns_answer_likes where answer_id = v_answer_id and user_id = v_guest_uid) then
    raise exception 'FAIL: ゲスト名義のsns_answer_likes行がゲスト自身のDELETEで削除できてしまった';
  end if;
  -- 通常のXユーザーは自分のいいねを従来どおり解除できる（回帰確認）。
  insert into public.sns_answer_likes (answer_id, user_id) values (v_answer_id, v_xuser_uid) on conflict do nothing;
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  delete from public.sns_answer_likes where answer_id = v_answer_id and user_id = v_xuser_uid;
  reset role;
  if exists (select 1 from public.sns_answer_likes where answer_id = v_answer_id and user_id = v_xuser_uid) then
    raise exception 'FAIL: 通常のXユーザーが自分のいいねを解除できなくなっている（過剰ブロック）';
  end if;

  -- ---- 2) sns_follows：ゲスト名義の行はゲスト自身のDELETEでは削除できない。----
  insert into public.sns_follows (follower_id, following_id) values (v_guest_uid, v_host_uid);
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  delete from public.sns_follows where follower_id = v_guest_uid and following_id = v_host_uid;
  reset role;
  if not exists (select 1 from public.sns_follows where follower_id = v_guest_uid and following_id = v_host_uid) then
    raise exception 'FAIL: ゲスト名義のsns_follows行がゲスト自身のDELETEで削除できてしまった';
  end if;
  insert into public.sns_follows (follower_id, following_id) values (v_xuser_uid, v_host_uid) on conflict do nothing;
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  delete from public.sns_follows where follower_id = v_xuser_uid and following_id = v_host_uid;
  reset role;
  if exists (select 1 from public.sns_follows where follower_id = v_xuser_uid and following_id = v_host_uid) then
    raise exception 'FAIL: 通常のXユーザーが自分のフォローを解除できなくなっている（過剰ブロック）';
  end if;

  -- ---- 3) sns_live_result_likes：ゲスト名義の行はゲスト自身のDELETEでは削除できない。----
  insert into public.sns_live_result_likes (result_answer_id, user_id) values (v_result_answer_row_id, v_guest_uid);
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  delete from public.sns_live_result_likes where result_answer_id = v_result_answer_row_id and user_id = v_guest_uid;
  reset role;
  if not exists (
    select 1 from public.sns_live_result_likes
    where result_answer_id = v_result_answer_row_id and user_id = v_guest_uid
  ) then
    raise exception 'FAIL: ゲスト名義のsns_live_result_likes行がゲスト自身のDELETEで削除できてしまった';
  end if;
  insert into public.sns_live_result_likes (result_answer_id, user_id) values (v_result_answer_row_id, v_xuser_uid)
    on conflict do nothing;
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  delete from public.sns_live_result_likes where result_answer_id = v_result_answer_row_id and user_id = v_xuser_uid;
  reset role;
  if exists (
    select 1 from public.sns_live_result_likes
    where result_answer_id = v_result_answer_row_id and user_id = v_xuser_uid
  ) then
    raise exception 'FAIL: 通常のXユーザーがライブ結果のいいねを解除できなくなっている（過剰ブロック）';
  end if;

  -- ---- 4) 寄合帳の変更操作：ゲストがRPC・直接INSERTを実行しても拒否される
  --      （0070で追加済みのGUEST_NOT_ALLOWED/RLSの回帰確認）。閲覧(SELECT)は許可のまま。----
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  v_failed := false;
  begin
    perform public.submit_sns_topic('ゲストが投稿しようとするお題');
  exception
    when others then
      if sqlerrm = 'GUEST_NOT_ALLOWED' then v_failed := true;
      else reset role; raise exception 'FAIL: submit_sns_topicの想定外のエラー(%)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsubmit_sns_topicできてしまった'; end if;

  v_failed := false;
  begin
    perform public.submit_sns_answer(v_topic_id, 'ゲストが投稿しようとする回答');
  exception
    when others then
      if sqlerrm = 'GUEST_NOT_ALLOWED' then v_failed := true;
      else reset role; raise exception 'FAIL: submit_sns_answerの想定外のエラー(%)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsubmit_sns_answerできてしまった'; end if;

  v_failed := false;
  begin
    perform public.submit_sns_comment(v_answer_id, 'ゲストが投稿しようとするツッコミ');
  exception
    when others then
      if sqlerrm = 'GUEST_NOT_ALLOWED' then v_failed := true;
      else reset role; raise exception 'FAIL: submit_sns_commentの想定外のエラー(%)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsubmit_sns_commentできてしまった'; end if;

  v_failed := false;
  begin
    perform public.delete_own_sns_answer(v_answer_id);
  exception
    when others then
      if sqlerrm = 'GUEST_NOT_ALLOWED' then v_failed := true;
      else reset role; raise exception 'FAIL: delete_own_sns_answerの想定外のエラー(%)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがdelete_own_sns_answerできてしまった'; end if;

  -- 直接INSERT（RLS経由）でのいいね・フォローもゲストは拒否される。
  v_failed := false;
  begin
    insert into public.sns_answer_likes (answer_id, user_id) values (v_answer_id, v_guest_uid);
  exception
    when others then v_failed := true;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsns_answer_likesへ直接INSERTできてしまった（RLS）'; end if;

  v_failed := false;
  begin
    insert into public.sns_follows (follower_id, following_id) values (v_guest_uid, v_host_uid);
  exception
    when others then v_failed := true;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsns_followsへ直接INSERTできてしまった（RLS）'; end if;

  -- 閲覧（SELECT）は引き続き許可されている（お題一覧が読める）。
  if not exists (select 1 from public.sns_topics where id = v_topic_id) then
    reset role;
    raise exception 'FAIL: ゲストがお題を閲覧(SELECT)できなくなっている（閲覧は許可のはず）';
  end if;
  reset role;

  raise notice 'PASS: いいね/フォロー/ライブ結果いいねのDELETEはゲスト名義の行でも拒否され、寄合帳の投稿・削除・いいね・フォローのRPC/直接INSERTもゲストは拒否されるが閲覧は引き続きできる';
end $$;

-- ============================================================
-- テスト12（再々レビュー対応・最優先）：participantsへの直接INSERT経路が
--          完全に閉じている。authenticated（通常会員・ゲストのどちらも）は
--          join_liveを経由せずparticipantsへ直接INSERTできず、権限エラーに
--          なる。join_liveは従来どおり正しい条件で参加できる（回帰確認）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_xuser_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_guest_uid uuid := 'c0000000-0000-0000-0000-000000000baa';
  v_failed boolean := false;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071再々レビュー-participants直接INSERT遮断', 20, 1,
    array['c0100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  -- 通常のXユーザーがauthenticatedとして直接INSERTしようとすると権限エラーに
  -- なる（join_live内の定員・フェーズ・利用停止等の全チェックを回避する経路が
  -- 存在しないことの確認、12番の対応）。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  begin
    insert into public.participants (live_id, user_id, preferred_role)
      values (v_live_id, v_xuser_uid, 'player');
  exception
    when insufficient_privilege then
      v_failed := true;
    when others then
      reset role;
      raise exception 'FAIL: 想定外のエラー内容(sqlstate=%, %)', sqlstate, sqlerrm;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 通常のXユーザーがauthenticatedとしてparticipantsへ直接INSERTできてしまった（join_live経由の一本化が崩れている）';
  end if;
  if exists (select 1 from public.participants where live_id = v_live_id and user_id = v_xuser_uid) then
    raise exception 'FAIL: 権限エラーになったはずなのにparticipants行が作られている';
  end if;

  -- ゲストが直接INSERTしようとしても同様に権限エラーになる。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  begin
    insert into public.participants (live_id, user_id, preferred_role)
      values (v_live_id, v_guest_uid, 'audience');
  exception
    when insufficient_privilege then
      v_failed := true;
    when others then
      reset role;
      raise exception 'FAIL: 想定外のエラー内容(sqlstate=%, %)', sqlstate, sqlerrm;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: ゲストがauthenticatedとしてparticipantsへ直接INSERTできてしまった';
  end if;
  if exists (select 1 from public.participants where live_id = v_live_id and user_id = v_guest_uid) then
    raise exception 'FAIL: 権限エラーになったはずなのにゲストのparticipants行が作られている';
  end if;

  -- join_liveは従来どおり機能する（回帰確認：通常会員・ゲストともに正しく参加できる）。
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser_uid::text, true);
  perform public.join_live(v_live_id, 'player', null);
  reset role;
  if not exists (
    select 1 from public.participants
    where live_id = v_live_id and user_id = v_xuser_uid and preferred_role = 'player'
  ) then
    raise exception 'FAIL: join_live経由での通常会員の参加が機能しなくなっている';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  perform public.join_live(v_live_id, 'audience', null);
  reset role;
  if not exists (
    select 1 from public.participants
    where live_id = v_live_id and user_id = v_guest_uid and is_guest = true and guest_number is not null
  ) then
    raise exception 'FAIL: join_live経由でのゲストの参加が機能しなくなっている';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: participantsへの直接INSERTはauthenticated（通常会員・ゲストとも）から権限エラーになり、join_liveは従来どおり機能する';
end $$;

-- ============================================================
-- テスト16（2026-09-13ゲスト観客対応・多層防御確認、3回目レビュー対応で
--          全面書き直し）：randomize_groups・begin_game・answers/scoresの
--          INSERT用RLSは、トリガーをすり抜けて「is_guest=false・role='player'
--          だがprofiles.is_guest=true」という壊れたparticipants行が万一
--          存在しても、統一判定(_is_guest_identity)で正しく除外・拒否する
--          （トリガー自体の検証はテスト4/4b/5/5bで別途確認済み。ここでは
--          トリガーが効かなかった場合の独立した防御を検証する）。
--
--          3回目レビュー対応：randomize_groups自身が「壊れたゲスト行を
--          audience/組無しへ正規化する」ようになった（0071の該当箇所参照）ため、
--          randomize_groups実行前に壊れた行を作ると、randomize_groupsの中で
--          即座に正規化されてしまい「begin_game/answers/scoresが壊れた行を
--          role='player'のまま独立して除外・拒否できているか」を検証できなく
--          なった。そこで本テストは (a) randomize_groupsの正規化そのものは
--          別の壊れた行で検証し、(b) begin_game/answers/scoresの独立した防御は
--          「randomize_groups実行後に新たに紛れ込んだ」想定の壊れた行で検証する
--          よう、2つの壊れた行に分けて構成する。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_guest_uid uuid := 'c0000000-0000-0000-0000-00000000b1a9';
  v_guest_participant uuid; -- (a) randomize_groups実行前に作る壊れた行
  v_guest_uid2 uuid := 'c0000000-0000-0000-0000-00000000b1ac';
  v_guest_participant2 uuid; -- (b) randomize_groups実行後に作る壊れた行
  v_xuser1_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_xuser_new_uid uuid := 'c0000000-0000-0000-0000-00000000b1aa';
  v_group_count int;
  v_player_count int;
  v_a_group_id uuid;
  v_turn_id uuid;
  v_eligible int;
  v_answer_id uuid;
  v_failed boolean := false;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;
  insert into auth.users (id, is_anonymous) values (v_guest_uid2, true) on conflict do nothing;
  insert into auth.users (id, is_anonymous) values (v_xuser_new_uid, false) on conflict do nothing;
  if (select is_guest from public.profiles where id = v_guest_uid) is not true
    or (select is_guest from public.profiles where id = v_guest_uid2) is not true then
    raise exception 'FAIL: テスト前提が崩れている（匿名ユーザーのprofiles.is_guestがtrueになっていない）';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-多層防御(壊れたゲスト行)', 20, 2,
    array['c0100000-0000-0000-0000-000000000006', 'c0100000-0000-0000-0000-000000000007']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  -- 2人の通常Xユーザーがプレイヤー希望で正規にjoin_liveする。
  set local role authenticated;
  perform set_config('myapp.uid', v_xuser1_uid::text, true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', v_xuser_new_uid::text, true);
  perform public.join_live(v_live_id, 'player', null);
  reset role;

  -- (a) randomize_groups実行「前」にトリガーをすり抜けて壊れた行を作る
  -- （is_guest=false・preferred_role/role='player'だがprofiles.is_guest=true）。
  set session_replication_role = replica;
  insert into public.participants (live_id, user_id, preferred_role, role)
    values (v_live_id, v_guest_uid, 'player', 'player')
    returning id into v_guest_participant;
  set session_replication_role = origin;

  -- randomize_groups：壊れたゲスト行(a)はプレイヤー抽選対象から除外され、
  -- 実在する2人のXユーザーだけが2組に振り分けられる。さらに3回目レビュー
  -- 対応の正規化ステップにより、壊れたゲスト行自体もaudience/組無しへ
  -- 補正される（単に抽選対象外にするだけでなく、行の状態自体を安全側に戻す）。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;

  select count(*) into v_group_count from public.groups where live_id = v_live_id;
  if v_group_count <> 2 then
    raise exception 'FAIL: randomize_groups後の組数が想定と違う(想定=2, 実際=%)', v_group_count;
  end if;
  if exists (
    select 1 from public.participants
    where id = v_guest_participant
      and (preferred_role <> 'audience' or role <> 'audience' or group_id is not null)
  ) then
    raise exception 'FAIL: 壊れたゲスト行(a)がrandomize_groupsによってaudience/組無しへ正規化されなかった';
  end if;
  raise notice 'PASS: randomize_groupsは壊れたゲスト行を単に抽選対象外にするだけでなく、preferred_role/role/group_idをaudience/nullへ正規化する';

  select count(*) into v_player_count from public.participants
    where live_id = v_live_id and role = 'player' and group_id is not null;
  if v_player_count <> 2 then
    raise exception 'FAIL: randomize_groups後、実際に組へ割り当てられたrole=player人数が想定と違う(想定=2、実際=%)', v_player_count;
  end if;

  select id into v_a_group_id from public.groups where live_id = v_live_id order by group_order limit 1;

  -- (b) randomize_groups「実行後」に、トリガーをすり抜けて新たな壊れた行を
  -- 作る（is_guest=false・role='player'・group_id=実在の組、preferred_roleも
  -- 'player'にしてトリガー自体もすり抜けた状態を模す）。これはrandomize_groups
  -- の正規化ステップが既に終わった後に混入したケースを想定しており、
  -- begin_game・answers/scoresそれぞれが独立してこの行を除外・拒否できるかを
  -- 検証する目的。
  set session_replication_role = replica;
  insert into public.participants (live_id, user_id, preferred_role, role, group_id)
    values (v_live_id, v_guest_uid2, 'player', 'player', v_a_group_id)
    returning id into v_guest_participant2;
  set session_replication_role = origin;

  -- begin_game：壊れたゲスト行(b)を数に入れず、2人のプレイヤー・2組として
  -- 正しく開始できる。eligible_judge_countは「全体2人−自組1人=1人」になる
  -- （壊れたゲスト行が誤って数えられていれば3人になり、この値は2になってしまう）。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.begin_game(v_live_id);
  reset role;

  select t.id, t.eligible_judge_count into v_turn_id, v_eligible
    from public.turns t where t.live_id = v_live_id and t.round = 1 limit 1;
  if v_eligible <> 1 then
    raise exception 'FAIL: begin_game後のeligible_judge_countが想定と違う(想定=1、実際=%、壊れたゲスト行が誤って数えられている疑い)', v_eligible;
  end if;
  raise notice 'PASS: begin_gameは、randomize_groups後に新たに混入した壊れたゲスト行(profiles.is_guest=true)を独立してプレイヤー人数・審査員の分母から除外する';

  -- answers/scores：壊れたゲスト行(b)がrole='player'のままでも、is_guest_user()の
  -- 直接チェックにより回答INSERT・採点INSERTのどちらも拒否される
  -- （begin_gameはparticipants.roleを書き換えないため、(b)はrole='player'の
  -- ままここに到達する＝RLSのis_guest_user()層を独立して検証できる）。
  update public.lives set current_phase = 'answering', current_turn_id = v_turn_id, answering_paused = false where id = v_live_id;
  update public.turns set status = 'active' where id = v_turn_id;
  v_guest_participant := v_guest_participant2;
  v_guest_uid := v_guest_uid2;

  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  begin
    insert into public.answers (turn_id, participant_id, seq, body)
      values (v_turn_id, v_guest_participant, 1, '壊れたゲスト行からの回答');
    v_failed := false;
  exception
    when others then
      if sqlerrm like '%row-level security%' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(壊れたゲスト行の回答INSERT, %)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: role=playerに壊れたゲスト行が回答をINSERTできてしまった（is_guest_user()の多層防御が効いていない）';
  end if;

  -- 採点対象を作るため、通常Xユーザーの回答を1件用意する（運営操作の代理、superuser実行）。
  insert into public.answers (turn_id, participant_id, seq, body, revealed_at)
    select v_turn_id, p.id, 1, '通常Xユーザーの回答', now()
    from public.participants p
    where p.live_id = v_live_id and p.role = 'player' and p.user_id in (v_xuser1_uid, v_xuser_new_uid)
    limit 1
    returning id into v_answer_id;

  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  begin
    insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_guest_participant, 3);
    v_failed := false;
  exception
    when others then
      if sqlerrm like '%row-level security%' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(壊れたゲスト行の採点INSERT, %)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: role=playerに壊れたゲスト行が採点をINSERTできてしまった（is_guest_user()の多層防御が効いていない）';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: answers/scoresのINSERT用RLSは、role=playerに壊れたゲスト行でもis_guest_user()により回答・採点のどちらも拒否する';
end $$;

-- ============================================================
-- テスト17（2026-09-13ゲスト観客対応）：send_tsukkomiはゲスト観客にも許可される
--          （0070/0071でsend_tsukkomi自体は変更していない＝role='player'を要求
--          しておらず、退場していない参加者なら誰でも送信できる設計のまま）。
--          1秒間隔のレート制限は引き続きゲストにも適用される。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_guest_uid uuid := 'c0000000-0000-0000-0000-00000000b1ab';
  v_failed boolean := false;
begin
  insert into auth.users (id, is_anonymous) values (v_guest_uid, true) on conflict do nothing;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-ゲストのリアクション', 20, 1,
    array['c0100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  perform public.join_live(v_live_id, 'audience', null);
  reset role;

  update public.lives set current_phase = 'answering' where id = v_live_id;

  -- ゲスト観客としてのリアクション送信は成功する。
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  perform public.send_tsukkomi(v_live_id, 'stamp', '爆笑');
  reset role;
  if not exists (
    select 1 from public.live_tsukkomi_events e
    join public.participants p on p.id = e.participant_id
    where p.live_id = v_live_id and p.user_id = v_guest_uid and e.kind = 'stamp' and e.text = '爆笑'
  ) then
    raise exception 'FAIL: ゲスト観客のsend_tsukkomiが記録されていない';
  end if;
  raise notice 'PASS: ゲスト観客はsend_tsukkomi（爆笑・ツッコミ・拍手）を送信できる';

  -- 1秒以内の連打はゲストにもレート制限される（RATE_LIMITED）。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', v_guest_uid::text, true);
  begin
    perform public.send_tsukkomi(v_live_id, 'clap', '👏');
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'RATE_LIMITED' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: ゲストの連打がレート制限されなかった';
  end if;
  raise notice 'PASS: ゲストのリアクション連打も従来どおり1秒間隔のレート制限が維持される';

  update public.lives set current_phase = 'closed' where id = v_live_id;
end $$;

-- ============================================================
-- テスト18（3回目レビュー対応）：ゲスト判定を3つの情報源で統一したことの検証。
--          auth.users.is_anonymous=trueだが、profiles.is_guestとparticipants.is_guestは
--          両方ともfalseという「is_anonymousだけが唯一の手がかり」の不整合状態
--          （以前の実装はprofiles.is_guestしか見ておらず、この状態を見落として
--          いた）でも、_guard_participants_guest_audience_onlyトリガー・
--          randomize_groups・begin_game・kick_participant・unkick_participant・
--          resync_eligible_judge_countsの全てが正しく拒否・除外することを確認する。
-- ============================================================
do $$
declare
  v_desync_uid uuid := 'c0000000-0000-0000-0000-00000000b1ad';
  v_xuser1_uid uuid := 'c0000000-0000-0000-0000-00000000000b';
  v_xuser_new_uid uuid := 'c0000000-0000-0000-0000-00000000b1ae';
  v_other_group_user uuid;
  v_live_id uuid;
  v_desync_participant uuid;
  v_failed boolean := false;
  v_group_count int;
  v_turn1_id uuid;
  v_eligible1 int;
  v_updated_turns int;
  v_resync_ok boolean;
  v_resync_reason text;
begin
  insert into auth.users (id, is_anonymous) values (v_desync_uid, true) on conflict do nothing;
  insert into auth.users (id, is_anonymous) values (v_xuser_new_uid, false) on conflict do nothing;
  -- 意図的な不整合を作る：is_anonymous=trueだがprofiles.is_guestはfalseへ書き換える
  -- （複製漏れ・過去データ不整合を模す。このUPDATEはテストスクリプト自身の権限
  -- （RLS対象外）で直接行っており、通常のauthenticatedからは不可能な操作）。
  update public.profiles set is_guest = false where id = v_desync_uid;
  if (select is_guest from public.profiles where id = v_desync_uid) is not false then
    raise exception 'FAIL: テスト前提が崩れている（profiles.is_guestをfalseへ書き換えられていない）';
  end if;
  if (select is_anonymous from auth.users where id = v_desync_uid) is not true then
    raise exception 'FAIL: テスト前提が崩れている（auth.users.is_anonymousがtrueになっていない）';
  end if;

  -- トリガー自体は、この不整合状態でもauth.users.is_anonymousを見て
  -- プレイヤー化を拒否する（is_guest=falseで直接INSERTしてもブロックされる）。
  begin
    insert into public.participants (live_id, user_id, preferred_role, role, is_guest)
      select id, v_desync_uid, 'player', 'player', false from public.lives limit 1;
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_PLAYER_ROLE_NOT_ALLOWED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(desyncユーザーの直接INSERT, %)', sqlerrm;
      end if;
  end;
  if not v_failed then
    raise exception 'FAIL: is_anonymous=trueだがis_guest列が全てfalseの不整合行が、トリガーをすり抜けてplayer化できてしまった';
  end if;
  raise notice 'PASS: _guard_participants_guest_audience_onlyはauth.users.is_anonymousだけを頼りにしてもゲストのplayer化を拒否する';

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0071テスト-ゲスト判定統一(is_anonymousのみ)', 20, 2,
    array['c0100000-0000-0000-0000-000000000001', 'c0100000-0000-0000-0000-000000000002']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_xuser1_uid::text, true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', v_xuser_new_uid::text, true);
  perform public.join_live(v_live_id, 'player', null);
  reset role;

  -- トリガーもすり抜けて、is_anonymous=trueだけが手がかりの壊れた行を作る。
  set session_replication_role = replica;
  insert into public.participants (live_id, user_id, preferred_role, role, is_guest)
    values (v_live_id, v_desync_uid, 'player', 'player', false)
    returning id into v_desync_participant;
  set session_replication_role = origin;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;

  if exists (
    select 1 from public.participants
    where id = v_desync_participant
      and (preferred_role <> 'audience' or role <> 'audience' or group_id is not null)
  ) then
    raise exception 'FAIL: is_anonymousのみが手がかりの壊れた行が、randomize_groupsによってaudience/組無しへ正規化されなかった';
  end if;

  select count(*) into v_group_count from public.groups where live_id = v_live_id;
  if v_group_count <> 2 then
    raise exception 'FAIL: randomize_groups後の組数が想定と違う(想定=2, 実際=%)', v_group_count;
  end if;
  raise notice 'PASS: randomize_groupsはauth.users.is_anonymousだけが手がかりの壊れた行も抽選対象から除外し、audience/組無しへ正規化する';

  -- 再度トリガーをすり抜けて、begin_game/kick/unkick/resyncを検証するための
  -- 壊れた行(role='player'のまま)を作る。
  set session_replication_role = replica;
  update public.participants set preferred_role = 'player', role = 'player'
    where id = v_desync_participant;
  set session_replication_role = origin;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.begin_game(v_live_id);
  reset role;

  select t.id, t.eligible_judge_count into v_turn1_id, v_eligible1
    from public.turns t
    join public.groups g on g.id = t.group_id
    where t.live_id = v_live_id and t.round = 1
    order by g.group_order asc limit 1;
  if v_eligible1 <> 1 then
    raise exception 'FAIL: begin_game直後のeligible_judge_countが想定と違う(想定=1、実際=%)', v_eligible1;
  end if;
  raise notice 'PASS: begin_gameはauth.users.is_anonymousだけが手がかりの壊れた行を審査員の分母から除外する';

  -- kick_participant/unkick_participant: v_turn1が属する組の「他組の実プレイヤー」
  -- （＝v_turn1の審査員として数えられている本人）を動的に特定してキック/解除する
  -- （randomize_groupsはランダム抽選のため、xuser1/xuser_newのどちらがv_turn1の
  -- 組に入るかは実行のたびに変わりうる。ここでは実際に審査員として数えられている
  -- 側を問い合わせて特定することで、組の割り当て結果に依存しないテストにする）。
  select p.user_id into v_other_group_user
    from public.participants p, public.turns t
    where t.id = v_turn1_id and p.live_id = v_live_id and p.role = 'player'
      and p.group_id <> t.group_id and p.user_id in (v_xuser1_uid, v_xuser_new_uid);
  if v_other_group_user is null then
    raise exception 'FAIL: テスト前提が崩れている（v_turn1の他組の実プレイヤーを特定できない）';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.kick_participant((
    select id from public.participants where live_id = v_live_id and user_id = v_other_group_user
  ));
  reset role;
  select eligible_judge_count into v_eligible1 from public.turns where id = v_turn1_id;
  if v_eligible1 <> 0 then
    raise exception 'FAIL: kick_participant後のeligible_judge_countが想定と違う(想定=0、実際=%、壊れたゲスト行が分母に混ざっている疑い)', v_eligible1;
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  perform public.unkick_participant((
    select id from public.participants where live_id = v_live_id and user_id = v_other_group_user
  ));
  reset role;
  select eligible_judge_count into v_eligible1 from public.turns where id = v_turn1_id;
  if v_eligible1 <> 1 then
    raise exception 'FAIL: unkick_participant後のeligible_judge_countが想定と違う(想定=1、実際=%)', v_eligible1;
  end if;
  raise notice 'PASS: kick_participant/unkick_participantは、壊れたゲスト行を審査員の分母から除外したままeligible_judge_countを再計算する';

  -- resync_eligible_judge_counts: 分母を意図的に壊してから再計算させても、
  -- 壊れたゲスト行を混ぜずに正しい値へ戻す。
  update public.turns set eligible_judge_count = 999 where live_id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000f', true);
  select ok, reason, updated_turns into v_resync_ok, v_resync_reason, v_updated_turns
    from public.resync_eligible_judge_counts(v_live_id);
  reset role;
  if v_resync_ok is not true then
    raise exception 'FAIL: resync_eligible_judge_countsが失敗した(reason=%)', v_resync_reason;
  end if;
  if v_updated_turns <> 2 then
    raise exception 'FAIL: resync_eligible_judge_countsが更新したturns件数が想定と違う(想定=2、実際=%)', v_updated_turns;
  end if;
  select eligible_judge_count into v_eligible1 from public.turns where id = v_turn1_id;
  if v_eligible1 <> 1 then
    raise exception 'FAIL: resync_eligible_judge_counts後のeligible_judge_countが想定と違う(想定=1、実際=%)', v_eligible1;
  end if;
  raise notice 'PASS: resync_eligible_judge_countsは、壊れたゲスト行を審査員の分母から除外したまま正しい値へ再計算する';

  update public.lives set current_phase = 'closed' where id = v_live_id;
end $$;

select 'ALL 0071 TESTS PASSED' as result;
