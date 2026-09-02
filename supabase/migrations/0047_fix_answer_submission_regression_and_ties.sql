-- 実機ライブで発覚した重大バグへの対応。
--
-- 【1】回答が送信できない（新規の重大バグ、おそらく0042が原因）
-- 0042で answers_insert_own_as_player に追加した以下4条件のうち、いずれか
-- （current_turn_idの一致・answering_paused・phase_deadlineの猶予・
-- reveal_sequence_until）が、実際のライブ進行のタイミング（ネットワーク遅延・
-- 一時停止からの復帰タイミング等）と噛み合わず、正常な回答送信まで拒否して
-- しまっていたと考えられる。原因を1本に特定しきれておらず、初回開催が
-- 近いため、いったん0008時点の（実績のある、正しく動いていた）条件まで
-- 安全側に戻す。scoresの採点側も同様に0006時点の条件へ戻す。
-- 「回答表示前」「確定後」「別組player以外」「自己採点」等の基本的な不正防止は
-- 元々あったこれらの条件でも引き続き効いている。締切ちょうどの厳密な二重チェック
-- （直接API叩き対策）は、実際のライブでの通し稽古で安全に検証できるまでいったん見送る。

drop policy if exists "answers_insert_own_as_player" on public.answers;

create policy "answers_insert_own_as_player"
  on public.answers for insert
  with check (
    seq between 1 and 5
    and exists (
      select 1
      from public.participants p
      join public.turns t on t.id = turn_id
      join public.lives l on l.id = t.live_id
      where p.id = participant_id
        and p.user_id = auth.uid()
        and p.role = 'player'
        and p.group_id = t.group_id
        and t.status = 'active'
        and l.current_phase = 'answering'
    )
    and (
      select count(*) from public.answers a2
      where a2.turn_id = answers.turn_id
        and a2.participant_id = answers.participant_id
    ) < 5
  );

drop policy if exists "scores_insert_own_as_player" on public.scores;

create policy "scores_insert_own_as_player"
  on public.scores for insert
  with check (
    exists (
      select 1
      from public.answers a
      join public.turns t on t.id = a.turn_id
      join public.lives l on l.id = t.live_id
      join public.participants p on p.id = judge_participant_id
      where a.id = answer_id
        and p.user_id = auth.uid()
        and p.role = 'player'
        and t.status = 'active'
        and l.current_phase = 'answering'
        and a.participant_id <> judge_participant_id
        and p.group_id <> t.group_id
        and a.revealed_at is not null
        and a.resolved = false
    )
  );

-- 【2】同点なのに別々の順位（1位・2位…）になり、順位ボーナスも別々に付与されていた
-- row_number()は同点でも必ず連番を振ってしまう（joined_atで無理やり順位を割っていた）。
-- rank()に変更し、同点は同じ順位（例：1位が2人なら次は3位）として扱う。
-- 同点1位が複数いれば、全員がそのまま1位ボーナスを受け取る（分割はしない）。
create or replace function public.apply_live_rank_rewards(p_live_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_already boolean;
begin
  if auth.uid() is not null and not is_host() then raise exception 'not authorized'; end if;
  select rank_rewards_applied into v_already from public.lives where id = p_live_id for update;
  if v_already is null then return; end if;
  if v_already then return; end if;
  with player_totals as (
    select p.id as participant_id, p.user_id, p.joined_at,
           coalesce(sum(a.score_total), 0) as total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.live_id = p_live_id and p.role = 'player'
    group by p.id, p.user_id, p.joined_at
  ),
  ranked as (
    select *, rank() over (order by total_score desc) as rnk
    from player_totals
  ),
  gains as (
    select participant_id, user_id, total_score, rnk,
      10 + total_score + (case rnk when 1 then 100 when 2 then 60 when 3 then 30 else 0 end) as gain
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
    from gains g where pr.id = g.user_id
    returning pr.id as user_id, g.gain, g.rnk
  )
  insert into public.point_history (user_id, live_id, points, mastery, label)
  select upd.user_id, p_live_id, upd.gain, upd.gain,
    '第' || l.sequence_number || '回ライブ'
      || (case upd.rnk when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
  from upd, public.lives l where l.id = p_live_id;
  update public.lives set rank_rewards_applied = true where id = p_live_id;
end; $$;
