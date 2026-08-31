-- apply_live_rank_rewards()のバグ修正：gains CTEはprofilesのupdate文の中でしか
-- 有効でないのに、続くpoint_historyへのinsert文でも参照してしまっており
-- （PostgreSQLのCTEは1つの文にしかスコープが及ばない）、
-- 「relation "gains" does not exist」で失敗していた。
-- update（データ変更CTE）にreturningを付け、そこからinsert ... select ...する
-- 1つの文にまとめることで、profilesの加算とpoint_historyへの記録を
-- 同じgains計算結果を使って atomic に行う。
create or replace function public.apply_live_rank_rewards(p_live_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
  v_best_participant_id uuid;
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

  -- ベストアンサー：そのライブ全体で最高得点の回答（同点は最も早い回答）。
  select a.participant_id into v_best_participant_id
  from public.answers a
  join public.turns t on t.id = a.turn_id
  where t.live_id = p_live_id and a.resolved = true
  order by a.score_total desc, a.created_at asc
  limit 1;

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
    select
      participant_id, user_id, total_score, rnk,
      10 + total_score
        + (case rnk when 1 then 100 when 2 then 60 when 3 then 30 else 0 end)
        + (case when participant_id = v_best_participant_id then 50 else 0 end) as mastery_gain,
      (case rnk when 1 then 300 when 2 then 200 when 3 then 100 else 30 end)
        + (case when participant_id = v_best_participant_id then 100 else 0 end) as points_gain
    from ranked
  ),
  upd as (
    update public.profiles pr set
      mastery_meter = pr.mastery_meter + g.mastery_gain,
      total_points = pr.total_points + g.points_gain,
      points_balance = pr.points_balance + g.points_gain,
      live_count = pr.live_count + 1,
      award_count_first = pr.award_count_first + (case when g.rnk = 1 then 1 else 0 end),
      award_count_second = pr.award_count_second + (case when g.rnk = 2 then 1 else 0 end),
      award_count_third = pr.award_count_third + (case when g.rnk = 3 then 1 else 0 end),
      best_answer_count = pr.best_answer_count + (case when g.participant_id = v_best_participant_id then 1 else 0 end)
    from gains g
    where pr.id = g.user_id
    returning pr.id as user_id, g.points_gain, g.mastery_gain, g.rnk, g.participant_id
  )
  insert into public.point_history (user_id, live_id, points, mastery, label)
  select
    upd.user_id, p_live_id, upd.points_gain, upd.mastery_gain,
    '第' || l.sequence_number || '回ライブ'
      || (case upd.rnk when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
      || (case when upd.participant_id = v_best_participant_id then '・ベストアンサー' else '' end)
  from upd, public.lives l
  where l.id = p_live_id;

  update public.lives set rank_rewards_applied = true where id = p_live_id;
end;
$$;

grant execute on function public.apply_live_rank_rewards(uuid) to authenticated;
