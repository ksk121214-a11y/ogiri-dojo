-- 「ベストアンサー」の決め方を、機械的な自動判定（そのライブ全体で最高得点、
-- 同点なら最速投稿）から、運営がSNS掲載（sns_live_results.manager_best_answer_id）で
-- 選ぶ「運営ベスト」に一本化する。
-- apply_live_rank_rewards()からベストアンサー判定・+50加算・best_answer_count加算を削除し、
-- 代わりに運営がライブ結果（SNS掲載）画面で運営ベストを選んだ/変更した/取り消した
-- タイミングでその場で+50を加算・取り消しするset_sns_live_result_manager_best()を新設する。
create or replace function public.apply_live_rank_rewards(p_live_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
begin
  if auth.uid() is not null and not is_host() then
    raise exception 'not authorized';
  end if;

  select rank_rewards_applied into v_already from public.lives where id = p_live_id for update;
  if v_already is null then
    return; -- ライブが存在しない
  end if;
  if v_already then
    return; -- 既に加算済み（二重付与防止）
  end if;

  with player_totals as (
    select p.id as participant_id, p.user_id, p.joined_at,
           coalesce(sum(a.score_total), 0) as total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.live_id = p_live_id and p.role = 'player'
    group by p.id, p.user_id, p.joined_at
  ),
  ranked as (
    select *, row_number() over (order by total_score desc, joined_at asc) as rnk
    from player_totals
  ),
  gains as (
    -- 参加+10、得点そのまま、順位ボーナス(1位100/2位60/3位30)。
    -- ベストアンサー分の加算はここでは行わない（運営ベスト選出時に別途加算する）。
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
    '第' || l.sequence_number || '回ライブ'
      || (case upd.rnk when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
  from upd, public.lives l
  where l.id = p_live_id;

  update public.lives set rank_rewards_applied = true where id = p_live_id;
end;
$$;

grant execute on function public.apply_live_rank_rewards(uuid) to authenticated;

-- 運営ベストの設定・変更・取り消し時に、+50ポイント/段位・best_answer_countを
-- その場で加算/取り消しし、選ばれた本人の通知ベルへお知らせする。
-- 既存の選出者から別の回答へ差し替えた場合・「該当なし」に戻した場合は、旧選出者ぶんを
-- 取り消してから新しい選出者へ付与する（同じ回答が選ばれ続けている場合は何もしない）。
drop function if exists public.set_sns_live_result_manager_best(uuid, uuid);
create function public.set_sns_live_result_manager_best(p_live_result_id uuid, p_answer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_answer_id uuid;
  v_old_user_id uuid;
  v_new_user_id uuid;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select manager_best_answer_id into v_old_answer_id
  from public.sns_live_results where id = p_live_result_id for update;

  if v_old_answer_id is not distinct from p_answer_id then
    return; -- 変化なし
  end if;

  if v_old_answer_id is not null then
    select p.user_id into v_old_user_id
    from public.answers a join public.participants p on p.id = a.participant_id
    where a.id = v_old_answer_id;
    if v_old_user_id is not null then
      update public.profiles set
        mastery_meter = greatest(0, mastery_meter - 50),
        total_points = greatest(0, total_points - 50),
        points_balance = greatest(0, points_balance - 50),
        best_answer_count = greatest(0, best_answer_count - 1)
      where id = v_old_user_id;
    end if;
  end if;

  if p_answer_id is not null then
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
    end if;
  end if;

  update public.sns_live_results
    set manager_best_answer_id = p_answer_id, updated_at = now()
    where id = p_live_result_id;
end;
$$;

grant execute on function public.set_sns_live_result_manager_best(uuid, uuid) to authenticated;
