-- 「爆笑スタジアム」残存バグの修正（仕様書_v2.mdを正とする）。
-- 採点方式(0〜3点の4段階)・同点順位(rank())・turns.eligible_judge_count・
-- DB確定値による満点判定は一切変更しない。

-- ============================================================
-- 1) answers/scoresのRLSを再強化する
-- ============================================================
-- 背景：0042でこれらの条件を一度追加したが、実機ライブで「回答を送信すると
-- infinite recursion detected in policy for relation "answers"」というエラーが
-- 発生し、0047でいったん0008/0006時点の条件まで戻していた。原因は0042の
-- 条件そのものではなく、answers_insert_own_as_playerの「同一ターン・同一
-- 参加者の既存回答数」チェックが answers テーブル自身への自己参照
-- サブクエリだったこと（0040でanswersのSELECTポリシーが複雑化したことと
-- 組み合わさって循環と判定されていた）。0048でこの自己参照をsecurity definer
-- 関数(answer_count_for_turn)に切り出し、根本原因は既に解消済み。
-- ここでは0048の対策はそのまま維持しつつ、0042で追加され0047で一時撤回して
-- いた「締切・一時停止・演出中・現在ターン一致」等の時刻/状態チェックを
-- 再度追加する。これらはいずれもanswers自身を自己参照しないため、0048で
-- 修正済みの循環を再発させることはない。
-- 追加で、kicked_at（途中退場）が入っている参加者からの回答・採点も拒否する。

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
-- 2) closeLiveのポイント取りこぼし対策
-- ============================================================
-- 従来はクライアント側で「lives更新→apply_live_rank_rewards呼び出し」の
-- 2回のSupabase呼び出しに分かれており、後者が失敗してもconsole.warnで
-- 握りつぶされ、運営が気づく手段も再試行する手段も無かった。
-- close_live()は1つのSECURITY DEFINER関数の中で両方行い、ポイント付与側だけ
-- 例外が起きても（plpgsqlのexceptionブロック＝内部セーブポイント）ライブの
-- 終了自体はロールバックさせず、成功/失敗を戻り値としてクライアントに返す。
-- retry_live_rank_rewards()は、closed後いつでも単独で再試行できるようにする
-- （apply_live_rank_rewards自体は既存のrank_rewards_appliedガードにより
-- 二重付与しない設計のまま変更していない）。
create or replace function public.close_live(p_live_id uuid)
returns table (closed boolean, rewards_applied boolean, rewards_error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed boolean := false;
  v_rewards_applied boolean := false;
  v_rewards_error text := null;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  update public.lives
  set current_phase = 'closed',
      phase_deadline = null,
      ended_at = coalesce(ended_at, now())
  where id = p_live_id
    and current_phase <> 'closed';
  v_closed := found;

  begin
    perform public.apply_live_rank_rewards(p_live_id);
    select l.rank_rewards_applied into v_rewards_applied from public.lives l where l.id = p_live_id;
  exception when others then
    v_rewards_error := sqlerrm;
    v_rewards_applied := false;
  end;

  return query select v_closed, v_rewards_applied, v_rewards_error;
end;
$$;

grant execute on function public.close_live(uuid) to authenticated;

create or replace function public.retry_live_rank_rewards(p_live_id uuid)
returns table (rewards_applied boolean, rewards_error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rewards_applied boolean := false;
  v_rewards_error text := null;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  begin
    perform public.apply_live_rank_rewards(p_live_id);
    select l.rank_rewards_applied into v_rewards_applied from public.lives l where l.id = p_live_id;
  exception when others then
    v_rewards_error := sqlerrm;
  end;

  return query select v_rewards_applied, v_rewards_error;
end;
$$;

grant execute on function public.retry_live_rank_rewards(uuid) to authenticated;

-- ============================================================
-- 3) beginGameの部分成功防止
-- ============================================================
-- 従来はクライアント側で「lives更新(topic_reveal)→turns一括作成→topics施錠→
-- 最初のturn有効化→lives.current_turn_id確定」の5回のSupabase呼び出しに
-- 分かれており、後半3つはエラーを一切確認していなかった。途中で失敗すると
-- current_phase='topic_reveal'なのにcurrent_turn_idがnullという不整合な
-- 状態のまま「ゲームを開始しました」と表示されうる状態だった。
-- begin_game()は1つのSECURITY DEFINER関数にまとめ、Postgresの関数呼び出し
-- 自体が1トランザクションになる性質を利用して、途中のどこで失敗しても
-- 何も変更されず(=自動的にopeningへ戻ったのと同じ状態)にする。
-- v_rounds/v_topic_reveal_msは、クライアント側の定数
-- (src/data/liveRoomTiming.tsのROUNDS_PER_LIVE_DEFAULT / topicRevealMs)と
-- 必ず同じ値にすること。
create or replace function public.begin_game(p_live_id uuid)
returns table (ok boolean, reason text, first_turn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds constant int := 1;
  v_topic_reveal_ms constant int := 13000;
  v_player_count int;
  v_group_count int;
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

  select count(*) into v_player_count
  from public.participants
  where live_id = p_live_id and role = 'player';
  if v_player_count = 0 then
    return query select false, '組分けされたプレイヤーがいません', null::uuid;
    return;
  end if;

  select count(*) into v_group_count from public.groups where live_id = p_live_id;
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

  -- 事故防止：連打・複数タブからの同時実行でturns等が重複作成されないための関所。
  -- 「opening・かつまだturnsが割り当てられていない(current_turn_id is null)」
  -- 状態からしか離脱できないガード付きupdateにし、成功できるのは最初の1回だけになる。
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

  -- 使用する順に並べたtopic idを配列で確保（created_at昇順、既存クライアント側と同じ）。
  select array_agg(id order by created_at asc) into v_topic_ids
  from public.topics where live_id = p_live_id;

  -- (round, group_order)の順にturnsを作成する。eligible_judge_countは
  -- 「その組以外のplayer数」をここで1回だけ確定させる(0049と同じ考え方)。
  for round_no in 1..v_rounds loop
    for rec in
      select g.id as group_id,
        v_player_count - (
          select count(*) from public.participants p
          where p.live_id = p_live_id and p.role = 'player' and p.group_id = g.id
        ) as eligible_judge_count
      from public.groups g
      where g.live_id = p_live_id
      order by g.group_order asc
    loop
      insert into public.turns (live_id, round, group_id, topic_id, status, eligible_judge_count)
      values (p_live_id, round_no, rec.group_id, v_topic_ids[v_topic_cursor], 'pending', rec.eligible_judge_count);
      v_topic_cursor := v_topic_cursor + 1;
    end loop;
  end loop;

  -- 使用が確定したお題だけlocked=trueにする。
  update public.topics
  set locked = true
  where id = any(v_topic_ids[1:v_topic_cursor - 1]);

  -- 最初のturn（round=1・group_order最小）を確定させて有効化する。
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
