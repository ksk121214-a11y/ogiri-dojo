-- 0070（ゲスト参加）レビュー対応：ゲスト（匿名）が通常会員として扱われてしまう
-- 残存経路を塞ぐ。設計原則は「participants.is_guestは表示用フラグに過ぎず
-- （0010の列GRANTにより理論上はjoin_live経由でなくても直接insertし得るため）、
-- 報酬・監査・通知除外などの『ゲスト本人を除外する』防御は、必ず
-- profiles.is_guest（handle_new_user()がauth.users.is_anonymousから複製する、
-- 本人が書き換え不可能な列、0070で revoke update (is_guest) on public.profiles
-- from authenticated 済み）をparticipants.user_id = profiles.idで結合して判定する」
-- こと。表示用の採番・アイコン等（participant_display_names、0070）は
-- participants.is_guestのままでよい。
--
-- 0001〜0070は一切書き換えない。CREATE OR REPLACEの基準本体は以下の通り
-- （grep -n "function public.<name>" で洗い出した「マイグレーション履歴上
-- 最新の」本体、0056/0068/0070の流儀にならいbegin/commitで1トランザクション）。
--   - handle_new_user(): 0070
--   - apply_live_rank_rewards(uuid): 0068
--   - set_sns_live_result_manager_best(uuid, uuid): 0068
--   - _compute_rank_reward_mismatches(): 0068
--   - log_share_click(text): 0045
--   - sns_author_names(uuid[]): 0033
--   - _guard_participants_guest_audience_only(): このファイル内で新規作成
--   - admin_apply_user_sanction(uuid, text, text, text, text, int, text): 0059
--   - sns_answer_likes_delete_own / sns_follows_delete_own /
--     sns_live_result_likes_delete_own: 0030 / 0030 / 0031
--   - answers_insert_own_as_player: 0053
--   - scores_insert_own_as_player: 0053
--   - randomize_groups(uuid): 0054
--   - begin_game(uuid): 0056
--
-- 再々レビュー対応（12番、参加登録経路の一本化）：
--   - participants_insert_self（0001）はDROPのみ（再作成しない）。
--   - participants への insert (live_id, user_id, preferred_role) 列GRANT（0010）は
--     REVOKEのみ（以後、参加登録はjoin_live経由のみに一本化する）。
--
-- 再々レビュー2回目対応（ゲスト観客の最終仕様確定）：
-- ゲストは本番・テストどちらのライブへも観客(audience)として参加できるように
-- 仕様変更した（0070のjoin_live本体を直接書き換え、GUEST_OFFICIAL_NOT_ALLOWEDを
-- 廃止しGUEST_AUDIENCE_ONLYへ）。これに伴い、このファイルに以前あった
-- 「officialライブにゲストが一切存在してはいけない」という旧不変条件トリガー
-- （_guard_official_transition_no_guest / _guard_participants_guest_official）は
-- 新仕様と矛盾するため削除し、「ゲストはプレイヤー化（preferred_role/role=
-- 'player'・組所属）できない」という新しい不変条件（_guard_participants_guest_
-- audience_only、7番）に作り直した。0070・0071はどちらもまだ本番未適用のため、
-- 旧トリガーは「作られなかったこと」にする（DROP文は書かない）。あわせて、
-- answers/scores（0053）のINSERT用RLSにis_guest_user()の直接チェックを追加し
-- （13番）、randomize_groups/begin_game（0054/0056）にもprofiles.is_guestに
-- よる多層防御を追加した（14番）。
--
-- 再々レビュー3回目対応（ゲスト判定を3つの情報源で統一）：
-- これまでのゲスト除外の多くはprofiles.is_guestのみ（一部はparticipants.is_guestとの
-- OR）で判定しており、匿名認証の一次情報源であるauth.users.is_anonymousを直接見ていない
-- 経路が残っていた（profiles.is_guestはhandle_new_user()がis_anonymousから複製する
-- 「写し」に過ぎず、理論上複製漏れ・不整合の余地がある）。新設した
-- public._is_guest_identity(uuid, boolean)（0番）で
-- 「participants.is_guest（渡された場合）／profiles.is_guest／auth.users.is_anonymous
-- のいずれか1つでもtrueならゲスト」に統一し、以下の全箇所に一貫して適用した：
-- _guard_participants_guest_audience_only・既存ゲスト行の補正UPDATE・
-- apply_live_rank_rewards・_compute_rank_reward_mismatches・randomize_groups・
-- begin_game・notificationsのゲスト宛て禁止・admin_apply_user_sanction。
-- 判定不能時（プロフィール行が無い等）はfalseへ倒さずfalse寄りにcoalesceしている
-- 既存の書式をそのまま踏襲しつつ、いずれかの情報源がtrueなら必ずゲスト側に倒れる
-- （安全側）設計にしている。
--
-- 再々レビュー3回目対応（eligible_judge_countの全経路からゲストを除外）：
-- 0071の14番はbegin_game内の初回計算にのみ多層防御を追加しており、
-- kick_participant/unkick_participant/resync_eligible_judge_counts（いずれも
-- 0054、resync_eligible_judge_countsは0055で戻り値にreasonを追加）が持つ
-- 「同じ計算式の再計算」には追加していなかった。15番でこの3つをCREATE OR REPLACEし、
-- 既存の採点中操作拒否・戻り値の型・kicked_at/group_id/live_id条件は一切変更せず、
-- 分母の集計クエリにだけ_is_guest_identity()による除外を追加する。
--
-- 再々レビュー3回目対応（participantsテーブル自体のSELECT範囲）：
-- 「一般ユーザーが他人・他ライブのparticipants行を直接取得でき、host_message等の
-- 非公開列が読める」問題は、0001〜0069を書き換えないという制約上このファイルでは
-- 直せない（0001のparticipants_select_allの削除が必要なため）。別ファイル
-- 0072_participants_read_lockdown.sqlで対応する。
--
-- 再々レビュー3回目対応（壊れたゲスト行の観客への正常化）：
-- 7番のトリガー・既存行補正UPDATEに加え、randomize_groups開始時にも
-- 「抽選対象から除外するだけでなく、preferred_role/role/group_idを観客側へ
-- 正規化する」防御を追加した（詳細は該当箇所のコメント参照）。
--
-- 実装の都合上、旧番号（1〜14）はそのまま維持し、新設分は0番（ヘルパー関数、
-- 他の全セクションより前に必要なため先頭に配置）と15番（kick/unkick/resync）
-- として追加する。

begin;

-- ============================================================
-- 0) _is_guest_identity：ゲスト判定を3つの情報源で統一するヘルパー。
-- ============================================================
-- 「participants.is_guest（呼び出し元がparticipants行を既に持っている場合のみ
-- 渡す。持っていない場合はfalseを渡せば以下の2つだけで判定する）」
-- 「profiles.is_guest」「auth.users.is_anonymous」のいずれか1つでもtrueなら
-- ゲストと判定する（1つの情報源だけを信用しないfail-safe設計。is_guest_user()
-- （0070、auth.uid()＝呼び出し本人専用）と同じ考え方を、p_user_idを引数に取る
-- ことで「他人の行を判定する」用途にも使えるようにしたもの）。プロフィール行や
-- auth.users行が無い場合はfalseへcoalesceする（存在しないユーザーを誤ってゲスト
-- 扱いすることはないが、その場合は呼び出し元の他の条件——USER_NOT_FOUND等——で
-- 別途弾かれる設計を前提とする）。
create or replace function public._is_guest_identity(p_user_id uuid, p_participant_is_guest boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(p_participant_is_guest, false)
    or coalesce((select pr.is_guest from public.profiles pr where pr.id = p_user_id), false)
    or coalesce((select u.is_anonymous from auth.users u where u.id = p_user_id), false);
$$;

revoke execute on function public._is_guest_identity(uuid, boolean) from public, anon, authenticated;

-- ============================================================
-- 1) handle_new_user()：匿名ゲストの初期値を「ゲスト」らしい値にする。
-- ============================================================
-- 表示名は通常会員の初期値「名無しの弟子」と混同しないよう「ゲスト」固定にする。
-- 寄合券(tickets_count)は、列自体のデフォルトが5（0043、通常会員向け）のため、
-- このinsert文にtickets_countを明示的に含めないと匿名ゲストも5枚から始まって
-- しまう（ゲストは投稿できないため実際には消費できないが、マイページの表示上
-- 「寄合券 残り5/5」という通常会員と同じ見た目になってしまう＝今回の防止対象）。
-- Xログイン利用者向けの既存ロジック（raw_user_meta_dataからのdisplay_name/
-- x_username/avatar_url抽出）は一切変更しない。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, x_username, avatar_url, is_guest, tickets_count)
  values (
    new.id,
    case
      when coalesce(new.is_anonymous, false) then 'ゲスト'
      else coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'user_name', '名無しの弟子')
    end,
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.is_anonymous, false),
    case when coalesce(new.is_anonymous, false) then 0 else 5 end
  );
  return new;
end;
$$;

-- 既存のゲスト行（0070以降、本migration適用前に作られた行）も同じ基準へ補正する。
-- 通常会員(is_guest=false)の寄合券には一切触れないよう、条件をis_guest=trueに
-- 厳密に絞る。
update public.profiles set tickets_count = 0 where is_guest = true and tickets_count <> 0;

-- ============================================================
-- 2) apply_live_rank_rewards：ゲスト参加者を集計・順位・報酬付与の対象から
--    完全に除外する（profiles.is_guestで判定、上記の設計原則参照）。
-- ============================================================
-- 現行本体は0068（343〜421行目）。同点順位処理(rank())・二重付与防止
-- (rank_rewards_applied)・ホスト権限確認・test_modeガードは一切変更しない。
create or replace function public.apply_live_rank_rewards(p_live_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
  v_phase text;
  v_live_mode text;
begin
  if auth.uid() is not null and not is_host() then
    raise exception 'not authorized';
  end if;

  select rank_rewards_applied, current_phase, live_mode
    into v_already, v_phase, v_live_mode
    from public.lives where id = p_live_id for update;
  if v_already is null then
    return; -- ライブが存在しない
  end if;
  if v_already then
    return; -- 既に加算済み（二重付与防止）
  end if;
  if v_live_mode = 'test' then
    return;
  end if;
  if v_phase <> 'closed' then
    raise exception 'LIVE_NOT_CLOSED';
  end if;

  with player_totals as (
    select p.id as participant_id, p.user_id,
           coalesce(sum(a.score_total), 0) as total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.live_id = p_live_id
      and p.role = 'player'
      -- 0071追加（3回目レビュー対応でparticipants.is_guest/auth.users.is_anonymousも
      -- あわせて確認する統一判定へ変更、0番の_is_guest_identity参照）：
      -- ゲストは集計・順位・報酬の対象から除外する。
      and not public._is_guest_identity(p.user_id, p.is_guest)
    group by p.id, p.user_id
  ),
  ranked as (
    select *, rank() over (order by total_score desc) as rnk
    from player_totals
  ),
  gains as (
    select
      participant_id, user_id, total_score, rnk,
      10 + total_score
        + (case rnk when 1 then 100 when 2 then 60 when 3 then 30 else 0 end) as gain
    from ranked
  ),
  upd as (
    update public.profiles pr set
      mastery_meter = pr.mastery_meter + g.gain,
      total_points = pr.total_points + g.gain,
      points_balance = pr.points_balance + g.gain,
      live_count = pr.live_count + 1,
      award_count_first = pr.award_count_first + (case when g.rnk = 1 then 1 else 0 end),
      award_count_second = pr.award_count_second + (case when g.rnk = 2 then 1 else 0 end),
      award_count_third = pr.award_count_third + (case when g.rnk = 3 then 1 else 0 end)
    from gains g
    where pr.id = g.user_id
    returning pr.id as user_id, g.gain, g.rnk
  )
  insert into public.point_history (user_id, live_id, points, mastery, label)
  select
    upd.user_id, p_live_id, upd.gain, upd.gain,
    '第' || l.official_sequence_number || '回ライブ'
      || (case upd.rnk when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
  from upd, public.lives l
  where l.id = p_live_id;

  update public.lives set rank_rewards_applied = true where id = p_live_id;
end;
$$;

-- ============================================================
-- 3) set_sns_live_result_manager_best：p_answer_idが本当にp_live_result_idの
--    ライブに属する・掲載候補として存在する・確定済み・playerの回答・ゲストでない、
--    の全てを満たす場合にのみ運営ベストとして設定できるようにする。
-- ============================================================
-- 現行本体は0068（433〜495行目）。test_modeガード・二重付与防止
-- (manager_best_bonus_granted)・ホスト権限確認は一切変更しない。
--
-- 再レビュー対応：以前はゲスト判定（pr.is_guest）だけをチェックしており、
-- 「p_answer_idが別ライブの回答IDでも、answers/participants/profilesの結合条件
-- だけを満たせば通ってしまう（live_result_idとの対応や、掲載候補
-- (sns_live_result_answers)に含まれているか・確定済み(resolved)か・playerの
-- 回答か、を一切検証していなかった）」抜け穴があった。管理画面はUI上の候補
-- （managerBestOptions、resolvedAnswers由来）からしかp_answer_idを渡さないが、
-- RPC自体は任意のuuidを受け付けてしまうため、DB側で必ず全条件を検証する。
-- 条件を1つでも満たさなければ、ポイント・実績・通知・manager_best_answer_idの
-- どれも一切変更せず拒否する（unless節を通過するexists一発判定にすることで、
-- 「一部だけ検証して一部を見落とす」ような部分的なチェック漏れを防ぐ）。
--
-- 再レビュー対応2：p_live_result_idが存在しない場合、以前は
-- 「v_live_modeがnullのまま test判定を素通りし、p_answer_idがnull（運営ベストを
-- 『該当なし』に戻す操作）だと最後のupdateがヒット0件のまま無言で成功していた」
-- （＝存在しないIDを渡しても何もエラーにならず成功したかのように見えていた）。
-- 冒頭でp_live_result_id自体の存在を確認し、無ければ制御されたエラーにする。
create or replace function public.set_sns_live_result_manager_best(p_live_result_id uuid, p_answer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_granted boolean;
  v_new_user_id uuid;
  v_live_mode text;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from public.sns_live_results where id = p_live_result_id) then
    raise exception 'LIVE_RESULT_NOT_FOUND';
  end if;

  select l.live_mode into v_live_mode
  from public.sns_live_results r
  join public.lives l on l.id = r.live_id
  where r.id = p_live_result_id;

  if v_live_mode = 'test' then
    raise exception 'テストライブには運営ベストを設定できません（ポイント・実績には反映されません）';
  end if;

  if p_answer_id is not null then
    -- 再レビュー対応：p_answer_idが「p_live_result_idと同じライブの回答」
    -- 「sns_live_result_answersに(live_result_id, answer_id)の組み合わせで存在」
    -- 「resolved済み」「playerの回答」「profiles.is_guest=false」の全てを満たす
    -- 場合にのみ通す（別ライブの回答ID・掲載候補に無い回答・未確定回答・観客の
    -- 回答・ゲストの回答、のいずれも同じ1つの検証で一律に拒否する）。
    if not exists (
      select 1
      from public.sns_live_result_answers ra
      join public.sns_live_results r on r.id = ra.live_result_id
      join public.answers a on a.id = ra.answer_id
      join public.participants p on p.id = a.participant_id
      join public.profiles pr on pr.id = p.user_id
      where ra.live_result_id = p_live_result_id
        and ra.answer_id = p_answer_id
        and a.live_id = r.live_id
        and a.resolved
        and p.role = 'player'
        and not pr.is_guest
    ) then
      raise exception 'ANSWER_NOT_ELIGIBLE_FOR_MANAGER_BEST';
    end if;

    select manager_best_bonus_granted into v_already_granted
    from public.sns_live_result_answers
    where live_result_id = p_live_result_id and answer_id = p_answer_id
    for update;

    if v_already_granted is not true then
      select p.user_id into v_new_user_id
      from public.answers a join public.participants p on p.id = a.participant_id
      where a.id = p_answer_id;

      if v_new_user_id is not null then
        update public.profiles set
          mastery_meter = mastery_meter + 50,
          total_points = total_points + 50,
          points_balance = points_balance + 50,
          best_answer_count = best_answer_count + 1
        where id = v_new_user_id;

        insert into public.notifications (user_id, type, title, body)
        values (
          v_new_user_id,
          'manager_best',
          '運営ベストに選ばれました',
          '今回のライブの運営ベストに選ばれました。+50ポイント獲得しました。'
        );

        update public.sns_live_result_answers
          set manager_best_bonus_granted = true
          where live_result_id = p_live_result_id and answer_id = p_answer_id;
      end if;
    end if;
  end if;

  update public.sns_live_results
    set manager_best_answer_id = p_answer_id, updated_at = now()
    where id = p_live_result_id;
end;
$$;

-- ============================================================
-- 4) _compute_rank_reward_mismatches：監査対象の集計からもゲストを除外する
--    （fix_rank_reward_mismatchesはこの関数の結果をそのまま使うため、
--    このCREATE OR REPLACEだけで自動的に安全になる。fix側の本体は変更不要）。
-- ============================================================
-- 現行本体は0068（698〜822行目）。target_lives（live_mode='official'条件）・
-- recorded/recorded_latest_label（point_historyからの現状復元）・同点処理は
-- 一切変更しない。
create or replace function public._compute_rank_reward_mismatches()
returns table (
  out_live_id uuid,
  out_sequence_number int,
  out_user_id uuid,
  out_recorded_exists boolean,
  out_recorded_gain int,
  out_recorded_rank int,
  out_correct_exists boolean,
  out_correct_gain int,
  out_correct_rank int,
  out_gain_delta int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with target_lives as (
    select l.id as t_live_id, l.official_sequence_number as t_sequence_number
    from public.lives l
    where l.rank_rewards_applied = true
      and l.live_mode = 'official'
  ),
  player_totals as (
    select
      p.live_id as pt_live_id,
      p.id as pt_participant_id,
      p.user_id as pt_user_id,
      coalesce(sum(a.score_total), 0)::int as pt_total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.role = 'player'
      and p.live_id in (select tl.t_live_id from target_lives tl)
      -- 0071追加（3回目レビュー対応で統一判定へ変更）：報酬付与本体
      -- (apply_live_rank_rewards)と同じ基準でゲストを監査対象からも除外する。
      and not public._is_guest_identity(p.user_id, p.is_guest)
    group by p.live_id, p.id, p.user_id
  ),
  ranked as (
    select
      pt.pt_live_id as rk_live_id,
      pt.pt_user_id as rk_user_id,
      pt.pt_total_score as rk_total_score,
      (rank() over (partition by pt.pt_live_id order by pt.pt_total_score desc))::int as rk_rnk
    from player_totals pt
  ),
  correct as (
    select
      rk.rk_live_id as cr_live_id,
      rk.rk_user_id as cr_user_id,
      10 + rk.rk_total_score
        + (case rk.rk_rnk when 1 then 100 when 2 then 60 when 3 then 30 else 0 end) as cr_gain,
      case when rk.rk_rnk <= 3 then rk.rk_rnk else null end as cr_rank_tier
    from ranked rk
  ),
  recorded as (
    select
      ph.live_id as rd_live_id,
      ph.user_id as rd_user_id,
      sum(ph.points)::int as rd_total
    from public.point_history ph
    where ph.live_id in (select tl2.t_live_id from target_lives tl2)
    group by ph.live_id, ph.user_id
  ),
  recorded_latest_label as (
    select distinct on (ph.live_id, ph.user_id)
      ph.live_id as rl_live_id,
      ph.user_id as rl_user_id,
      case
        when ph.label like '%（1位）%' then 1
        when ph.label like '%（2位）%' then 2
        when ph.label like '%（3位）%' then 3
        else null
      end as rl_rank
    from public.point_history ph
    where ph.live_id in (select tl4.t_live_id from target_lives tl4)
    order by ph.live_id, ph.user_id, ph.created_at desc, ph.id desc
  ),
  recorded_with_rank as (
    select
      r.rd_live_id,
      r.rd_user_id,
      r.rd_total,
      rl.rl_rank as rd_rank
    from recorded r
    left join recorded_latest_label rl on rl.rl_live_id = r.rd_live_id and rl.rl_user_id = r.rd_user_id
  )
  select
    coalesce(rr.rd_live_id, c.cr_live_id),
    tl3.t_sequence_number,
    coalesce(rr.rd_user_id, c.cr_user_id),
    (rr.rd_user_id is not null),
    coalesce(rr.rd_total, 0),
    rr.rd_rank,
    (c.cr_user_id is not null),
    coalesce(c.cr_gain, 0),
    c.cr_rank_tier,
    coalesce(c.cr_gain, 0) - coalesce(rr.rd_total, 0)
  from recorded_with_rank rr
  full outer join correct c on c.cr_live_id = rr.rd_live_id and c.cr_user_id = rr.rd_user_id
  join target_lives tl3 on tl3.t_live_id = coalesce(rr.rd_live_id, c.cr_live_id)
  where coalesce(rr.rd_total, 0) <> coalesce(c.cr_gain, 0)
     or coalesce(rr.rd_rank, 0) <> coalesce(c.cr_rank_tier, 0);
end;
$$;

-- ============================================================
-- 5) log_share_click：ゲストの分析行は静かに作らない（エラーにせずUXは崩さない）。
-- ============================================================
-- 現行本体は0045（21〜48行目、0046/0062はrevoke/grantのみ）。連打抑制・
-- context検証・anonの匿名クリック計測は一切変更しない。
create or replace function public.log_share_click(p_context text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_context not in ('live_schedule', 'live_result', 'final_result') then
    raise exception 'INVALID_CONTEXT';
  end if;

  -- 0071追加：ゲスト（匿名）は分析データとして記録しない（多層防御。押した本人には
  -- 何もエラーを見せず、単に記録しないだけに留める）。
  if public.is_guest_user() then
    return;
  end if;

  if v_user_id is not null and exists (
    select 1 from public.share_click_events e
    where e.user_id = v_user_id
      and e.context = p_context
      and e.created_at > now() - interval '2 seconds'
  ) then
    return;
  end if;

  insert into public.share_click_events (context, user_id) values (p_context, v_user_id);
end;
$$;

-- ============================================================
-- 6) sns_author_names：ゲストのプロフィールは返さない。
-- ============================================================
-- 現行本体は0033（140〜148行目、0021は前身、0062はrevokeのみ）。ゲストは
-- そもそもSNS投稿ができないため通常は呼ばれないはずだが、多層防御として追加する。
create or replace function public.sns_author_names(p_ids uuid[])
returns table (id uuid, display_name text, avatar_icon text, avatar_color text, mastery_meter int, bio text)
language sql
security definer set search_path = public
as $$
  select pr.id, pr.display_name, pr.avatar_icon, pr.avatar_color, pr.mastery_meter, pr.bio
  from public.profiles pr
  where pr.id = any(p_ids)
    and not pr.is_guest;
$$;

-- ============================================================
-- 7)（再々レビュー2回目対応：ゲスト観客の最終仕様に合わせて全面的に作り直し）
--    不変条件（多層防御）：ゲストはofficial・testのどちらのライブでも観客
--    (audience)としてのみ存在でき、プレイヤー化（preferred_role/role='player'
--    または組(group_id)への所属）は一切できない。
-- ============================================================
-- 【廃止した旧トリガーについて】以前はここに
-- _guard_official_transition_no_guest()（テストライブにゲスト参加者がいる状態
-- からofficialへの変更を一律拒否）と_guard_participants_guest_official()
-- （officialライブへのゲスト参加者の直接追加・変更を一律拒否）という、
-- 「ゲストはofficialライブに一切存在してはいけない」という旧仕様の不変条件
-- トリガーがあった。今回の最終仕様（ゲストは本番・テストどちらも観客として
-- 参加できる）はこれと真っ向から矛盾するため、両方とも削除し（0070・0071は
-- どちらもまだ本番未適用のため、DROPは行わず単にこのファイルの最終版に
-- 含めないことで「無かったこと」にする）、代わりに以下の新しい不変条件に
-- 作り直す。
--
-- 【新しい不変条件】live_modeを問わず、ゲスト（participants.is_guest=true、
-- または結合先のprofiles.is_guest=true——0010の列GRANTにより
-- participants.is_guestは直接INSERTでfalseのまま作られ得る「表示用フラグ」に
-- 過ぎないため、真の判定元は必ずprofiles.is_guestも併用する、このファイル冒頭の
-- 設計原則を踏襲）は、preferred_role='player'・role='player'・group_idが
-- non-nullのいずれにもなれない。BEFORE INSERT OR UPDATEトリガーでDB自体が
-- 拒否する（0010/0060の列GRANT設計により authenticated経由では実質的に既に
-- 不可能だが、将来の設定ミスやSQL Editorでの直接操作にも備えた保険）。
create or replace function public._guard_participants_guest_audience_only()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_is_guest boolean;
begin
  -- 3回目レビュー対応：participants.is_guest／profiles.is_guest／
  -- auth.users.is_anonymousの3つの情報源を統一判定するpublic._is_guest_identity
  -- （0番）を使う（以前はnew.is_guestとprofiles.is_guestの2つだけを見ていた）。
  v_is_guest := public._is_guest_identity(new.user_id, new.is_guest);
  if v_is_guest and (
    new.preferred_role = 'player' or new.role = 'player' or new.group_id is not null
  ) then
    raise exception 'GUEST_PLAYER_ROLE_NOT_ALLOWED';
  end if;
  return new;
end;
$$;

create trigger participants_guard_guest_audience_only
  before insert or update on public.participants
  for each row execute function public._guard_participants_guest_audience_only();

-- トリガー専用関数はクライアントから直接呼ぶ用途が無いため、デフォルトの挙動だけに
-- 頼らず明示的にEXECUTEを剥奪する（0063のP1-7と同じ多層防御）。
revoke execute on function public._guard_participants_guest_audience_only() from public, anon, authenticated;

-- 既存ゲスト行にplayer/組が入っている不整合（0070・0071適用前の別経路・
-- ローカル検証等で生じ得るもの）があれば、安全側（観客・組無し）へ補正する。
-- このUPDATE自体は補正後の値（audience/null）で書き込むため、上のトリガーには
-- 抵触しない。
update public.participants p
set preferred_role = 'audience', role = 'audience', group_id = null
where public._is_guest_identity(p.user_id, p.is_guest)
  and (p.preferred_role = 'player' or p.role = 'player' or p.group_id is not null);

-- ============================================================
-- 9) 不変条件（多層防御）：notificationsの宛先(user_id)がゲスト
--    （profiles.is_guest=true）なら一切INSERTできない。
-- ============================================================
-- notificationsへの直接INSERTはRLS（0023のnotifications_insert_host、is_host()限定）
-- が既にゲスト・非ホストからの直接INSERTを弾いているが、admin_apply_user_sanction
-- （0059、SECURITY DEFINER）やset_sns_live_result_manager_best（0068、SECURITY DEFINER）
-- はRLSを経由せずinsertするため、宛先の絞り込みを呼び出し元の実装（is_guest=false条件
-- 済みのユーザー一覧を渡す等）だけに頼っていた。BEFORE INSERTトリガーにすることで、
-- RLS・SECURITY DEFINER関数のどちらの経路でも、宛先がゲストなら必ずDB側で拒否される
-- ようにする（set_sns_live_result_manager_bestは3)の検証で既にゲスト除外済み、
-- admin_apply_user_sanctionは10)で対象自体を拒否するが、将来追加される通知insert
-- 経路の見落としに備えた最後の砦として機能する）。
create or replace function public._guard_notifications_no_guest_target()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- 3回目レビュー対応：profiles.is_guestだけでなくauth.users.is_anonymousも
  -- あわせて確認する統一判定に変更（0番のpublic._is_guest_identity参照）。
  if public._is_guest_identity(new.user_id, false) then
    raise exception 'NOTIFICATION_TARGET_IS_GUEST';
  end if;
  return new;
end;
$$;

create trigger notifications_guard_no_guest_target
  before insert on public.notifications
  for each row execute function public._guard_notifications_no_guest_target();

revoke execute on function public._guard_notifications_no_guest_target() from public, anon, authenticated;

-- ============================================================
-- 10) admin_apply_user_sanction：ゲストを警告・利用停止・解除の対象にできない
--     ようにする。
-- ============================================================
-- 現行本体は0059（122〜188行目）。reason空文字許容・suspend_temporary/
-- suspend_permanent/lift/warningの各分岐・user_sanctions/admin_action_logsへの
-- 記録（同一トランザクション）は一切変更しない。USER_NOT_FOUND判定を
-- 「is_guestを一緒に取得するselect」に置き換え、行が無い場合(v_target_is_guestが
-- null)は従来どおりUSER_NOT_FOUND、ゲストの場合は新しいエラーで拒否する。
create or replace function public.admin_apply_user_sanction(
  p_user_id uuid,
  p_type text,
  p_reason text,
  p_detail text default null,
  p_target_ref text default null,
  p_suspend_days int default null,
  p_notification_body text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_detail text;
  v_target_is_guest boolean;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;
  select is_guest into v_target_is_guest from public.profiles where id = p_user_id;
  if v_target_is_guest is null then
    raise exception 'USER_NOT_FOUND';
  end if;
  -- 0071追加（3回目レビュー対応でauth.users.is_anonymousもあわせて確認する
  -- 統一判定に変更、0番のpublic._is_guest_identity参照。USER_NOT_FOUND判定
  -- 自体は上のprofiles.is_guest単体のselectのままにする＝行の存在確認と
  -- ゲスト判定を分離し、存在しないユーザーを誤ってゲストと混同しない）：
  -- ゲスト（匿名参加者）は会員管理の対象外。警告・利用停止・解除のどれも
  -- 一切実行しない（notifications・user_sanctions・admin_action_logsの
  -- どの行も作られない）。
  if public._is_guest_identity(p_user_id, false) then
    raise exception 'ゲストユーザーには警告・利用停止を行えません';
  end if;
  if p_type not in ('warning', 'suspend_temporary', 'suspend_permanent', 'lift') then
    raise exception 'INVALID_TYPE';
  end if;
  -- reasonの空文字許容は既存の管理画面の挙動（window.prompt()が空文字を返しても
  -- そのまま記録していた）を変えないための意図的な措置。user_sanctions.reasonは
  -- not nullのため、nullそのものを渡した場合はDBの制約で自然に弾かれる。

  v_detail := p_detail;

  if p_type = 'suspend_temporary' then
    if p_suspend_days is null or p_suspend_days <= 0 then
      raise exception 'INVALID_DAYS';
    end if;
    update public.profiles
      set suspended_until = now() + (p_suspend_days || ' days')::interval
      where id = p_user_id;
    v_detail := coalesce(v_detail, p_suspend_days || '日間');
  elsif p_type = 'suspend_permanent' then
    update public.profiles set is_permanently_suspended = true where id = p_user_id;
  elsif p_type = 'lift' then
    update public.profiles
      set is_permanently_suspended = false, suspended_until = null
      where id = p_user_id;
  elsif p_type = 'warning' then
    -- warningはprofilesの停止列を書き換えず、本人の通知ベルにだけ送る。
    insert into public.notifications (user_id, type, title, body)
    values (p_user_id, 'warning', '運営からの警告', coalesce(nullif(p_notification_body, ''), p_reason));
  end if;

  insert into public.user_sanctions (user_id, type, reason, detail, target_ref, created_by)
  values (p_user_id, p_type, p_reason, v_detail, p_target_ref, auth.uid());

  insert into public.admin_action_logs (actor_id, action, target_type, target_id, reason, detail)
  values (
    auth.uid(), 'user_' || p_type, 'profiles', p_user_id::text, p_reason,
    jsonb_build_object('detail', v_detail, 'targetRef', p_target_ref, 'suspendDays', p_suspend_days)
  );
end;
$$;

grant execute on function public.admin_apply_user_sanction(uuid, text, text, text, text, int, text) to authenticated;
revoke execute on function public.admin_apply_user_sanction(uuid, text, text, text, text, int, text) from public;
revoke execute on function public.admin_apply_user_sanction(uuid, text, text, text, text, int, text) from anon;

-- ============================================================
-- 11) 解除（DELETE）系ポリシーにもゲスト拒否を追加する。
-- ============================================================
-- このファイルの10)（このファイル冒頭近くの「10) 直接テーブルINSERT用RLSポリシー」）
-- で、いいね・フォロー・ライブ結果いいねのINSERTポリシーには既にnot is_guest_user()を
-- 追加済みだったが、対になるDELETE（解除）側ポリシーには追加していなかった。
-- 現状の設計（INSERT側のガードとjoin_liveと同様の列GRANT制限）により、ゲストが
-- そもそも自分名義のいいね・フォロー行を持つことは無く実害は無いはずだが、
-- 将来の実装変更・設定ミスに備えた多層防御として、DELETE側にも同じ条件を追加する。
--
-- sns_answer_likes_delete_ownの現行本体は0030（47〜48行目）。
drop policy if exists "sns_answer_likes_delete_own" on public.sns_answer_likes;
create policy "sns_answer_likes_delete_own" on public.sns_answer_likes for delete
  using (auth.uid() = user_id and not is_guest_user());

-- sns_follows_delete_ownの現行本体は0030（101〜102行目）。
drop policy if exists "sns_follows_delete_own" on public.sns_follows;
create policy "sns_follows_delete_own" on public.sns_follows for delete
  using (auth.uid() = follower_id and not is_guest_user());

-- sns_live_result_likes_delete_ownの現行本体は0031（124〜125行目）。
drop policy if exists "sns_live_result_likes_delete_own" on public.sns_live_result_likes;
create policy "sns_live_result_likes_delete_own" on public.sns_live_result_likes for delete
  using (auth.uid() = user_id and not is_guest_user());

-- ============================================================
-- 12) participantsへの直接INSERT経路を完全に閉じる（最優先）。
-- ============================================================
-- 0010の列GRANT（grant insert (live_id, user_id, preferred_role) on
-- public.participants to authenticated）と0001のparticipants_insert_selfポリシー
-- （with check (auth.uid() = user_id)のみ）の組み合わせにより、authenticated
-- （匿名ゲストもSupabaseでは同じauthenticatedロール）はjoin_live()を一切経由せず
-- 直接INSERTできる状態だった。これにより、join_live内の全チェック——
--   - ACCOUNT_SUSPENDED（利用停止確認）
--   - PARTICIPANT_KICKED（キック済み確認）
--   - ROLE_DOWNGRADE_NOT_ALLOWED（役割ダウングレード禁止）
--   - PLAYER_JOIN_CLOSED（player参加可能フェーズの確認）
--   - PLAYER_LIMIT_REACHED（定員確認）
--   - GUEST_AUDIENCE_ONLY（プレイヤー希望拒否）／ゲスト番号の採番／is_guestの
--     設定（0070）
-- を一切素通りしてparticipants行を直接作成できてしまう（ゲストに限らず、通常会員も
-- 定員超過・受付終了後のplayer参加が可能だった）。ゲストのプレイヤー化は7)の
-- トリガーで別途ブロック済みだが、テストライブでの定員・フェーズ無視は
-- 塞がれていなかった。
--
-- participants_insert_self（0001）・0010の列GRANTを両方とも撤去し、参加登録は
-- 必ずjoin_live（SECURITY DEFINER、関数所有者権限で実行されるためこのrevokeの
-- 影響を受けない）だけを経由するようにする。列GRANTのrevokeは、grant時と同じ列
-- リストを明示する必要がある（テーブル単位のrevokeでは列単位の権限は消えない）。
revoke insert (live_id, user_id, preferred_role) on public.participants from authenticated;
drop policy if exists "participants_insert_self" on public.participants;

-- ============================================================
-- 13)（再々レビュー2回目対応）：answers/scoresのINSERT用RLSに、
--     is_guest_user()による直接チェックを追加する（多層防御）。
-- ============================================================
-- どちらのポリシーも既に「p.role = 'player'」を要求しており、7)の新しい
-- 不変条件トリガー（_guard_participants_guest_audience_only）によりゲストの
-- participants.roleが'player'になることは無いはずだが、「participantが不正に
-- player化されていてもprofiles.is_guestなら拒否する」という多層防御を明示的に
-- 追加する（トリガーが将来変更・迂回された場合の最後の砦。それ以外の既存条件
-- ——seq範囲・同一ライブ確認・組確認・退場確認・フェーズ確認・締切猶予・
-- reveal_sequence猶予・answer_count_for_turn上限、採点側の自己採点禁止・
-- judging_ends_at猶予等——は一切変更しない）。
--
-- answers_insert_own_as_playerの現行本体は0053（142〜171行目）。
drop policy if exists "answers_insert_own_as_player" on public.answers;

create policy "answers_insert_own_as_player"
  on public.answers for insert
  with check (
    not is_guest_user()
    and seq between 1 and 5
    and exists (
      select 1
      from public.participants p
      join public.turns t on t.id = turn_id
      join public.lives l on l.id = t.live_id
      where p.id = participant_id
        and p.user_id = auth.uid()
        and p.role = 'player'
        and p.live_id = t.live_id
        and p.group_id = t.group_id
        and p.kicked_at is null
        and t.status = 'active'
        and t.id = l.current_turn_id
        and l.current_phase = 'answering'
        and l.answering_paused = false
        and (
          l.phase_deadline is null
          or now() <= l.phase_deadline + interval '500 milliseconds'
        )
        and (
          l.reveal_sequence_until is null
          or now() >= l.reveal_sequence_until
        )
    )
    and public.answer_count_for_turn(turn_id, participant_id) < 5
  );

-- scores_insert_own_as_playerの現行本体は0053（175〜201行目）。UPDATEは0012で
-- 既にauthenticatedから全面的に剥奪済み（ゲスト限定ではなく全員不可のため、
-- ここでの変更は不要）。
drop policy if exists "scores_insert_own_as_player" on public.scores;

create policy "scores_insert_own_as_player"
  on public.scores for insert
  with check (
    not is_guest_user()
    and exists (
      select 1
      from public.answers a
      join public.turns t on t.id = a.turn_id
      join public.lives l on l.id = t.live_id
      join public.participants p on p.id = judge_participant_id
      where a.id = answer_id
        and p.user_id = auth.uid()
        and p.role = 'player'
        and p.live_id = l.id
        and p.kicked_at is null
        and t.status = 'active'
        and t.id = l.current_turn_id
        and l.current_phase = 'answering'
        and a.participant_id <> judge_participant_id
        and p.group_id <> t.group_id
        and a.revealed_at is not null
        and a.resolved = false
        and (
          a.judging_ends_at is null
          or now() <= a.judging_ends_at + interval '400 milliseconds'
        )
    )
  );

-- ============================================================
-- 14)（再々レビュー2回目対応）：randomize_groups/begin_gameに、
--     profiles.is_guestによる多層防御を追加する。
-- ============================================================
-- どちらの関数も、プレイヤー選定・人数集計をparticipants.preferred_role/role=
-- 'player'を条件に行っており、7)の新しい不変条件トリガーによりゲストの
-- これらの列が'player'になることは無いはずだが、「壊れた古いparticipants行が
-- あっても、profiles.is_guestのゲストを除外する」多層防御を明示的に追加する。
--
-- randomize_groupsの現行本体は0054（531〜610行目）。組作成・既存groups行の
-- 再利用・プレイヤー希望者の一旦リセット・組振り分けアルゴリズムは一切変更せず、
-- 「プレイヤー希望者を抽選対象として集める」select文にだけ条件を追加する。
create or replace function public.randomize_groups(p_live_id uuid)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planned_group_count int;
  v_group_count int;
  v_player_ids uuid[];
  v_player_count int;
  v_base int;
  v_remainder int;
  v_cursor int := 1;
  v_group_ids uuid[];
  v_size int;
  i int;
  j int;
  n int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select planned_group_count into v_planned_group_count
    from public.lives where id = p_live_id;
  if not found then
    return query select false, 'ライブが見つかりません';
    return;
  end if;
  v_group_count := greatest(1, coalesce(v_planned_group_count, 1));

  -- 3回目レビュー対応（壊れたゲスト行の正常化）：抽選対象から除外するだけでなく、
  -- 「壊れたゲスト行」（is_guest=false・preferred_role/role='player'または
  -- group_idが入っているが、profiles.is_guestまたはauth.users.is_anonymousは
  -- trueの行）自体をここで観客/組無しへ正規化しておく。7)の不変条件トリガー
  -- （_guard_participants_guest_audience_only）に既に阻まれるはずの状態だが、
  -- 「実行の起点となるrandomize_groups自身も安全側へ倒す」多層防御として、
  -- このUPDATE自体は補正後の値（audience/null）を書き込むためトリガーには
  -- 抵触しない。
  update public.participants p
    set preferred_role = 'audience', role = 'audience', group_id = null
    where p.live_id = p_live_id
      and public._is_guest_identity(p.user_id, p.is_guest)
      and (p.preferred_role = 'player' or p.role = 'player' or p.group_id is not null);

  select array_agg(id order by random())
    into v_player_ids
    from public.participants p
    where p.live_id = p_live_id and p.preferred_role = 'player' and p.kicked_at is null
      -- 0071追加（3回目レビュー対応で統一判定へ変更）：ゲストは抽選対象から
      -- 除外する（多層防御。上の正規化ステップとあわせ、7)のトリガーにより
      -- 通常はpreferred_role='player'になり得ないゲストが、万一壊れたデータ
      -- として存在していても、プレイヤーへ組み込まれない）。
      and not public._is_guest_identity(p.user_id, p.is_guest);
  if v_player_ids is null or array_length(v_player_ids, 1) = 0 then
    return query select false, 'プレイヤー希望の参加者がいません';
    return;
  end if;
  v_player_count := array_length(v_player_ids, 1);

  -- 足りないgroups行だけ作る（既存行は再利用し、turns.group_idの参照を壊さない。
  -- 組数を減らした場合に既存の余剰groups行を削除はしない＝turnsから参照されて
  -- いる可能性を考慮し、単に「使わない」だけにする）。
  for n in 1..v_group_count loop
    insert into public.groups (live_id, group_order)
    select p_live_id, n
    where not exists (
      select 1 from public.groups where live_id = p_live_id and group_order = n
    );
  end loop;

  select array_agg(id order by group_order)
    into v_group_ids
    from public.groups
    where live_id = p_live_id and group_order <= v_group_count;

  -- まずプレイヤー希望者全員をaudience/group_id:nullへ一旦戻し、新しい割り当て
  -- だけを反映する（前回の手動変更・組数変更前の割り当てを確実に上書きする）。
  -- 0071追加：この一旦リセットの対象からもゲストは除外する（上の正規化ステップで
  -- 既にゲストのpreferred_roleは'audience'になっているため、通常はこのWHERE句
  -- 単体でも一致しなくなっているはずだが、統一判定への置き換えと合わせて
  -- 明示的な多層防御として残す。理由：このUPDATEがpreferred_role自体は変更
  -- しない（role/group_idのリセットのみ）ため、万一正規化前のゲスト行が
  -- 紛れ込んだ場合、7)の不変条件トリガーがnew.preferred_role='player'のままで
  -- あることを検知して例外を送出し、randomize_groups自体が失敗してしまうため）。
  update public.participants p
    set group_id = null, role = 'audience'
    where p.live_id = p_live_id and p.preferred_role = 'player' and p.kicked_at is null
      and not public._is_guest_identity(p.user_id, p.is_guest);

  v_base := v_player_count / v_group_count;
  v_remainder := v_player_count % v_group_count;
  v_cursor := 1;
  for i in 1..v_group_count loop
    v_size := v_base + (case when i <= v_remainder then 1 else 0 end);
    for j in 1..v_size loop
      update public.participants
        set group_id = v_group_ids[i], role = 'player'
        where id = v_player_ids[v_cursor];
      v_cursor := v_cursor + 1;
    end loop;
  end loop;

  return query select true, null::text;
end;
$$;

grant execute on function public.randomize_groups(uuid) to authenticated;
revoke execute on function public.randomize_groups(uuid) from public;
revoke execute on function public.randomize_groups(uuid) from anon;

-- begin_gameの現行本体は0056（510〜636行目、末尾のfirst_turn_id返却部分含む）。
-- お題の準備確認・turns作成・topics locked更新・最初のturn確定等は一切変更せず、
-- v_orphan_count／v_player_count／eligible_judge_countの各集計にだけ
-- profiles.is_guest除外を追加する。
create or replace function public.begin_game(p_live_id uuid)
returns table (ok boolean, reason text, first_turn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds constant int := 1;
  v_topic_reveal_ms constant int := 13000;
  v_planned_group_count int;
  v_player_count int;
  v_group_count int;
  v_orphan_count int;
  v_needed_topics int;
  v_topic_count int;
  v_updated_rows int;
  v_topic_ids uuid[];
  v_topic_cursor int := 1;
  v_first_turn_id uuid;
  rec record;
  round_no int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select planned_group_count into v_planned_group_count
    from public.lives where id = p_live_id;

  select count(*) into v_orphan_count
  from public.participants p
  where p.live_id = p_live_id and p.role = 'player' and p.kicked_at is null
    -- 0071追加（3回目レビュー対応で統一判定へ変更）：ゲストは組整合チェックの
    -- 対象外にする（多層防御。7)のトリガーにより通常はrole='player'になり得ない）。
    and not public._is_guest_identity(p.user_id, p.is_guest)
    and (
      p.group_id is null
      or not exists (
        select 1 from public.groups g
        where g.id = p.group_id
          and g.live_id = p_live_id
          and g.group_order <= coalesce(v_planned_group_count, 2147483647)
      )
    );
  if v_orphan_count > 0 then
    return query select
      false,
      '組分けが現在の組数と一致していません。「もう一度ランダムに振り分ける」を実行してから開始してください。',
      null::uuid;
    return;
  end if;

  select count(*) into v_player_count
  from public.participants p
  where p.live_id = p_live_id and p.role = 'player' and p.kicked_at is null
    -- 0071追加（3回目レビュー対応で統一判定へ変更）：ゲストはプレイヤー人数から
    -- 除外する（多層防御）。
    and not public._is_guest_identity(p.user_id, p.is_guest);
  if v_player_count = 0 then
    return query select false, '組分けされたプレイヤーがいません', null::uuid;
    return;
  end if;

  select count(*) into v_group_count
  from public.groups
  where live_id = p_live_id
    and group_order <= coalesce(v_planned_group_count, 2147483647);
  if v_group_count = 0 then
    return query select false, '組が作成されていません', null::uuid;
    return;
  end if;

  v_needed_topics := v_group_count * v_rounds;
  select count(*) into v_topic_count from public.topics where live_id = p_live_id;
  if v_topic_count < v_needed_topics then
    return query select false, 'お題の準備が不足しています', null::uuid;
    return;
  end if;

  update public.lives
  set current_phase = 'topic_reveal',
      phase_deadline = now() + (v_topic_reveal_ms::text || ' milliseconds')::interval
  where id = p_live_id
    and current_phase = 'opening'
    and current_turn_id is null;
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows = 0 then
    return query select false, 'ライブの状態が別の操作によって変更されています。最新状態を取得してください。', null::uuid;
    return;
  end if;

  select array_agg(id order by created_at asc) into v_topic_ids
  from public.topics where live_id = p_live_id;

  for round_no in 1..v_rounds loop
    for rec in
      select g.id as group_id,
        v_player_count - (
          select count(*) from public.participants p
          where p.live_id = p_live_id and p.role = 'player' and p.group_id = g.id
            and p.kicked_at is null
            -- 0071追加（3回目レビュー対応で統一判定へ変更）：ゲストは審査員の
            -- 分母から除外する（多層防御）。
            and not public._is_guest_identity(p.user_id, p.is_guest)
        ) as eligible_judge_count
      from public.groups g
      where g.live_id = p_live_id
        and g.group_order <= coalesce(v_planned_group_count, 2147483647)
      order by g.group_order asc
    loop
      insert into public.turns (live_id, round, group_id, topic_id, status, eligible_judge_count)
      values (p_live_id, round_no, rec.group_id, v_topic_ids[v_topic_cursor], 'pending', rec.eligible_judge_count);
      v_topic_cursor := v_topic_cursor + 1;
    end loop;
  end loop;

  update public.topics
  set locked = true
  where id = any(v_topic_ids[1:v_topic_cursor - 1]);

  select t.id into v_first_turn_id
  from public.turns t
  join public.groups g on g.id = t.group_id
  where t.live_id = p_live_id and t.round = 1
  order by g.group_order asc
  limit 1;

  update public.turns set status = 'active' where id = v_first_turn_id;

  update public.lives
  set current_turn_id = v_first_turn_id,
      answering_paused = false,
      answering_remaining_ms = null
  where id = p_live_id;

  return query select true, null::text, v_first_turn_id;
end;
$$;

grant execute on function public.begin_game(uuid) to authenticated;
revoke execute on function public.begin_game(uuid) from public;
revoke execute on function public.begin_game(uuid) from anon;

-- ============================================================
-- 15)（3回目レビュー対応）：eligible_judge_countの再計算経路
--     kick_participant/unkick_participant/resync_eligible_judge_countsにも、
--     begin_gameと同じ統一ゲスト判定による多層防御を追加する。
-- ============================================================
-- 3つとも「採点中は操作を拒否する」既存ガード・戻り値の型（ok/reason/…）・
-- kicked_at/group_id/live_idの既存条件は一切変更せず、eligible_judge_countを
-- 再計算するselect文の分母にだけ_is_guest_identity()による除外を追加する。
--
-- kick_participant/unkick_participantの現行本体は0054（240〜354行目、以後未変更）。
create or replace function public.kick_participant(p_participant_id uuid)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live_id uuid;
  v_role text;
  v_user_id uuid;
  v_host_message text;
  v_current_phase text;
  v_busy boolean;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select live_id, role, user_id, host_message
    into v_live_id, v_role, v_user_id, v_host_message
    from public.participants where id = p_participant_id for update;
  if not found then
    return query select false, '参加者が見つかりません';
    return;
  end if;

  select current_phase into v_current_phase from public.lives where id = v_live_id;

  select exists (
    select 1 from public.answers a join public.turns t on t.id = a.turn_id
    where t.live_id = v_live_id and a.revealed_at is not null and a.resolved = false
  ) into v_busy;
  if v_current_phase = 'answering' and v_busy then
    return query select false, '採点中は退場操作ができません。今の回答への採点が終わってから操作してください。';
    return;
  end if;

  update public.participants set kicked_at = now() where id = p_participant_id;

  insert into public.user_sanctions (user_id, type, reason, target_ref, created_by)
  values (v_user_id, 'kicked', coalesce(v_host_message, ''), v_live_id::text, auth.uid());

  if v_role = 'player' then
    update public.turns t
    set eligible_judge_count = (
      select count(*) from public.participants p
      where p.live_id = v_live_id and p.role = 'player' and p.kicked_at is null
        and p.group_id <> t.group_id
        -- 0071追加：ゲストは審査員の分母から除外する（多層防御）。
        and not public._is_guest_identity(p.user_id, p.is_guest)
    )
    where t.live_id = v_live_id and t.status in ('pending', 'active');
  end if;

  return query select true, null::text;
end;
$$;

grant execute on function public.kick_participant(uuid) to authenticated;
revoke execute on function public.kick_participant(uuid) from public;
revoke execute on function public.kick_participant(uuid) from anon;

create or replace function public.unkick_participant(p_participant_id uuid)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live_id uuid;
  v_role text;
  v_current_phase text;
  v_busy boolean;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select live_id, role into v_live_id, v_role
    from public.participants where id = p_participant_id for update;
  if not found then
    return query select false, '参加者が見つかりません';
    return;
  end if;

  select current_phase into v_current_phase from public.lives where id = v_live_id;
  select exists (
    select 1 from public.answers a join public.turns t on t.id = a.turn_id
    where t.live_id = v_live_id and a.revealed_at is not null and a.resolved = false
  ) into v_busy;
  if v_current_phase = 'answering' and v_busy then
    return query select false, '採点中は退場解除ができません。今の回答への採点が終わってから操作してください。';
    return;
  end if;

  update public.participants set kicked_at = null where id = p_participant_id;

  if v_role = 'player' then
    update public.turns t
    set eligible_judge_count = (
      select count(*) from public.participants p
      where p.live_id = v_live_id and p.role = 'player' and p.kicked_at is null
        and p.group_id <> t.group_id
        -- 0071追加：ゲストは審査員の分母から除外する（多層防御）。
        and not public._is_guest_identity(p.user_id, p.is_guest)
    )
    where t.live_id = v_live_id and t.status in ('pending', 'active');
  end if;

  return query select true, null::text;
end;
$$;

grant execute on function public.unkick_participant(uuid) to authenticated;
revoke execute on function public.unkick_participant(uuid) from public;
revoke execute on function public.unkick_participant(uuid) from anon;

-- resync_eligible_judge_countsの現行本体は0055（527〜567行目、戻り値にreasonを
-- 追加した版。以後未変更）。
drop function if exists public.resync_eligible_judge_counts(uuid);

create or replace function public.resync_eligible_judge_counts(p_live_id uuid)
returns table (ok boolean, reason text, updated_turns int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_phase text;
  v_busy boolean;
  v_count int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select current_phase into v_current_phase from public.lives where id = p_live_id;
  select exists (
    select 1 from public.answers a join public.turns t on t.id = a.turn_id
    where t.live_id = p_live_id and a.revealed_at is not null and a.resolved = false
  ) into v_busy;
  if v_current_phase = 'answering' and v_busy then
    return query select false, '採点中は再計算できません。今の回答への採点が終わってから実行してください。', 0;
    return;
  end if;

  update public.turns t
  set eligible_judge_count = (
    select count(*) from public.participants p
    where p.live_id = p_live_id and p.role = 'player' and p.kicked_at is null
      and p.group_id <> t.group_id
      -- 0071追加：ゲストは審査員の分母から除外する（多層防御）。
      and not public._is_guest_identity(p.user_id, p.is_guest)
  )
  where t.live_id = p_live_id and t.status in ('pending', 'active');
  get diagnostics v_count = row_count;

  return query select true, null::text, v_count;
end;
$$;

grant execute on function public.resync_eligible_judge_counts(uuid) to authenticated;
revoke execute on function public.resync_eligible_judge_counts(uuid) from public;
revoke execute on function public.resync_eligible_judge_counts(uuid) from anon;

commit;
