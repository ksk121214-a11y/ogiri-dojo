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

begin;

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
      -- 0071追加：ゲスト（profiles.is_guest）は集計・順位・報酬の対象から除外する。
      -- participants.is_guestではなくprofiles.is_guestで判定する理由は
      -- ファイル冒頭の設計原則コメント参照。
      and not exists (
        select 1 from public.profiles pr where pr.id = p.user_id and pr.is_guest
      )
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
-- 3) set_sns_live_result_manager_best：回答者がゲストの場合は運営ベストに
--    選べないようにする（+50ポイント・実績・notificationsの付与を防ぐ）。
-- ============================================================
-- 現行本体は0068（433〜495行目）。test_modeガード・二重付与防止
-- (manager_best_bonus_granted)・ホスト権限確認は一切変更しない。
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

  select l.live_mode into v_live_mode
  from public.sns_live_results r
  join public.lives l on l.id = r.live_id
  where r.id = p_live_result_id;

  if v_live_mode = 'test' then
    raise exception 'テストライブには運営ベストを設定できません（ポイント・実績には反映されません）';
  end if;

  if p_answer_id is not null then
    -- 0071追加：回答者（answers.participant_id→participants.user_id→
    -- profiles.is_guest）がゲストの場合は運営ベストに選べない。
    if exists (
      select 1
      from public.answers a
      join public.participants p on p.id = a.participant_id
      join public.profiles pr on pr.id = p.user_id
      where a.id = p_answer_id and pr.is_guest
    ) then
      raise exception 'ゲストの回答は運営ベストに選べません';
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
      -- 0071追加：報酬付与本体(apply_live_rank_rewards)と同じ基準で
      -- ゲスト(profiles.is_guest)を監査対象からも除外する。
      and not exists (
        select 1 from public.profiles pr where pr.id = p.user_id and pr.is_guest
      )
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
-- 7) 不変条件（多層防御）：テストライブにゲスト参加者がいる状態からofficialへ
--    変更できない。
-- ============================================================
-- フロントに live_mode の直接UPDATE呼び出しは存在しない（create_live_preparation
-- 呼び出し時に一度だけ決まる設計、grep済み）が、SQL Editor等からの直接UPDATEに
-- 備えた保険として、BEFORE UPDATEトリガーでDB自体が拒否するようにする。
create or replace function public._guard_official_transition_no_guest()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.live_mode = 'official' and old.live_mode <> 'official' then
    if exists (select 1 from public.participants where live_id = old.id and is_guest) then
      raise exception 'OFFICIAL_TRANSITION_BLOCKED_GUEST_PRESENT';
    end if;
  end if;
  return new;
end;
$$;

create trigger lives_guard_official_transition
  before update of live_mode on public.lives
  for each row execute function public._guard_official_transition_no_guest();

-- ============================================================
-- 8) 不変条件（多層防御）：officialライブへis_guest=trueのparticipantを
--    直接追加・変更できない。
-- ============================================================
-- 現状の列GRANT設計（0010でis_guest/guest_number列自体がinsert対象外、0060で
-- 参加者テーブルのUPDATE権限がほぼ全て剥奪済み）により、authenticatedロール
-- 経由では実質的に既に不可能だが、将来の設定ミスやSQL Editorでの直接操作にも
-- 備えた保険として、BEFORE INSERT OR UPDATEトリガーでDB自体が拒否するようにする。
create or replace function public._guard_participants_guest_official()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_live_mode text;
begin
  if new.is_guest then
    select live_mode into v_live_mode from public.lives where id = new.live_id;
    if v_live_mode = 'official' then
      raise exception 'GUEST_PARTICIPANT_NOT_ALLOWED_ON_OFFICIAL_LIVE';
    end if;
  end if;
  return new;
end;
$$;

create trigger participants_guard_guest_official
  before insert or update on public.participants
  for each row execute function public._guard_participants_guest_official();

-- トリガー専用関数はクライアントから直接呼ぶ用途が無いため、デフォルトの挙動だけに
-- 頼らず明示的にEXECUTEを剥奪する（0063のP1-7と同じ多層防御）。
revoke execute on function public._guard_official_transition_no_guest() from public, anon, authenticated;
revoke execute on function public._guard_participants_guest_official() from public, anon, authenticated;

commit;
