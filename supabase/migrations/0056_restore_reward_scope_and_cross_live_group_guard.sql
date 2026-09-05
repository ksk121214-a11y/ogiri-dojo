-- 0055適用後の再レビューで見つかった残存問題の修正。
-- 0055は既に本番へ適用済みのため書き換えず、ここで作り直す。

-- ============================================================
-- 1) 退場者の除外を「今後の採点対象・eligible_judge_count」だけに戻す
-- ============================================================
-- 背景：0055でapply_live_rank_rewards/_compute_rank_reward_mismatchesの
-- 対象を「kicked_at is null、かつ組数を減らした後の余剰groupに残っていない」
-- に絞ってしまったが、src/lib/liveRoomSelectors.tsの結果画面（組結果・最終結果）
-- は一貫して「role='player'」の全員を対象にしており、kicked_at・group_orderは
-- 一切見ていない。現行の仕様書にも「退場者は順位ポイントを失う」とは書かれて
-- いないため、これは0055で勝手に仕様を変えてしまっていたことになる。
-- 結果画面（クライアント側の表示）が正であり、DB側の集計をそれに合わせる。
-- kicked_atの除外は、今後の採点対象を決めるeligible_judge_count関連
-- （begin_game・kick/unkick_participant・resync_eligible_judge_counts）
-- でのみ引き続き使用し、最終順位・参加ポイント・得点ポイント・順位ポイント
-- の対象は「role='player'」全員に戻す。
create or replace function public.apply_live_rank_rewards(p_live_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
  v_phase text;
begin
  if auth.uid() is not null and not is_host() then
    raise exception 'not authorized';
  end if;

  select rank_rewards_applied, current_phase into v_already, v_phase
    from public.lives where id = p_live_id for update;
  if v_already is null then
    return; -- ライブが存在しない
  end if;
  if v_already then
    return; -- 既に加算済み（二重付与防止）
  end if;
  if v_phase <> 'closed' then
    raise exception 'LIVE_NOT_CLOSED';
  end if;

  with player_totals as (
    -- 2026-09-05:「退場者の順位表示とポイント計算が一致していない」対応。
    -- src/lib/liveRoomSelectors.tsのgetOverallRanking()と同じ対象
    -- （role='player'の全員。kicked_at・組の有効性は見ない）に統一する。
    select p.id as participant_id, p.user_id,
           coalesce(sum(a.score_total), 0) as total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.live_id = p_live_id
      and p.role = 'player'
    group by p.id, p.user_id
  ),
  ranked as (
    -- rank()：同点は同じ順位になる（例：1位が2人なら次は3位）。row_number()は
    -- 同点でも必ず連番を振ってしまうため使わない（0047の修正を踏襲）。
    select *, rank() over (order by total_score desc) as rnk
    from player_totals
  ),
  gains as (
    -- 参加+10、得点そのまま、順位ボーナス(1位100/2位60/3位30)。
    -- 同点1位が複数いれば、全員がそのまま1位ボーナスを受け取る（分割はしない）。
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
revoke execute on function public.apply_live_rank_rewards(uuid) from public;
revoke execute on function public.apply_live_rank_rewards(uuid) from anon;

-- _compute_rank_reward_mismatches()も同じ対象者集合（role='player'全員）に
-- 揃える。加えて、0055時点で実際に運用されていた場合に備え、「recordedに
-- 行が無い（＝0055の実行中、退場者として丸ごと付与対象から除外されて
-- point_historyに一行も無い）」ケースも検出できるよう、内部結合ではなく
-- 完全外部結合にする（内部結合のままだと、付与自体が丸ごと漏れていた人を
-- 検出できない＝監査が不完全になるため）。
create or replace function public._compute_rank_reward_mismatches()
returns table (
  out_live_id uuid,
  out_sequence_number int,
  out_user_id uuid,
  out_recorded_gain int,
  out_recorded_rank int,
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
    select l.id as t_live_id, l.sequence_number as t_sequence_number
    from public.lives l
    where l.rank_rewards_applied = true
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
      rk.rk_rnk as cr_rank,
      case when rk.rk_rnk <= 3 then rk.rk_rnk else null end as cr_rank_tier
    from ranked rk
  ),
  recorded as (
    select
      ph.live_id as rd_live_id,
      ph.user_id as rd_user_id,
      ph.points as rd_gain,
      case
        when ph.label like '%（1位）%' then 1
        when ph.label like '%（2位）%' then 2
        when ph.label like '%（3位）%' then 3
        else null
      end as rd_rank
    from public.point_history ph
    where ph.live_id in (select tl2.t_live_id from target_lives tl2)
      and ph.label not like '%訂正%'
  )
  select
    coalesce(r.rd_live_id, c.cr_live_id),
    tl3.t_sequence_number,
    coalesce(r.rd_user_id, c.cr_user_id),
    coalesce(r.rd_gain, 0),
    r.rd_rank,
    coalesce(c.cr_gain, 0),
    c.cr_rank,
    coalesce(c.cr_gain, 0) - coalesce(r.rd_gain, 0)
  from recorded r
  full outer join correct c on c.cr_live_id = r.rd_live_id and c.cr_user_id = r.rd_user_id
  join target_lives tl3 on tl3.t_live_id = coalesce(r.rd_live_id, c.cr_live_id)
  where coalesce(r.rd_gain, 0) <> coalesce(c.cr_gain, 0)
     or coalesce(r.rd_rank, 0) <> coalesce(c.cr_rank_tier, 0);
end;
$$;

revoke execute on function public._compute_rank_reward_mismatches() from public;
revoke execute on function public._compute_rank_reward_mismatches() from anon;
revoke execute on function public._compute_rank_reward_mismatches() from authenticated;

-- ============================================================
-- 2) begin_gameのグループ整合性チェックにlive_id一致を追加する
-- ============================================================
-- 従来はgroups.idの存在とgroup_orderだけを確認しており、万一
-- participants.group_idに別ライブのgroups.idが入っている異常状態でも
-- （そのgroup_orderがたまたまplanned_group_count以内なら）検出できなかった。
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
  from public.participants
  where live_id = p_live_id and role = 'player' and kicked_at is null;
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
-- 3) 参加者の組変更にも「participant.live_idとgroup.live_idが同じ」不変条件を追加する
-- ============================================================
-- 従来は管理画面から直接participantsをupdateしており（UIは常に現在のライブの
-- groupsしか選択肢に出さないため実害は無いが）、DB側では別ライブのgroup_idを
-- 弾く手段が無かった。専用のSECURITY DEFINER関数に切り出し、group_idが
-- 指定されたライブと同じライブのgroupsに属するかを必ず検証する。
create or replace function public.set_participant_group(p_participant_id uuid, p_group_id uuid)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live_id uuid;
  v_group_live_id uuid;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select live_id into v_live_id from public.participants where id = p_participant_id for update;
  if not found then
    return query select false, '参加者が見つかりません';
    return;
  end if;

  if p_group_id is not null then
    select live_id into v_group_live_id from public.groups where id = p_group_id;
    if v_group_live_id is null then
      return query select false, '組が見つかりません';
      return;
    end if;
    if v_group_live_id <> v_live_id then
      return query select false, '別のライブの組は指定できません';
      return;
    end if;
  end if;

  update public.participants
    set group_id = p_group_id,
        role = (case when p_group_id is null then 'audience' else 'player' end)
    where id = p_participant_id;

  return query select true, null::text;
end;
$$;

grant execute on function public.set_participant_group(uuid, uuid) to authenticated;
revoke execute on function public.set_participant_group(uuid, uuid) from public;
revoke execute on function public.set_participant_group(uuid, uuid) from anon;
