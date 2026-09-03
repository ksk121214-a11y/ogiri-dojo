-- 0053適用後の再レビューで見つかった残存問題の修正。
-- 0053は書き換えず、必要な関数をここで作り直す（0051・0052に対して0053がそう
-- したのと同じ手法）。

-- ============================================================
-- 1) apply_live_rank_rewardsのrank()回帰を修正する
-- ============================================================
-- 背景：0047で「同点は同じ順位（例：1位が2人なら次は3位）として扱う」ために
-- row_number()からrank()へ修正していたが、0053で関数を作り直した際に誤って
-- 0037時点のrow_number()版の本体をベースにしてしまい、rank()化が巻き戻って
-- いた（0053の主目的だったPUBLIC/anonのrevokeとclosed確認自体は正しく機能して
-- いるため、それらは維持する）。
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
    select p.id as participant_id, p.user_id,
           coalesce(sum(a.score_total), 0) as total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.live_id = p_live_id and p.role = 'player'
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

-- ------------------------------------------------------------
-- 1b) 0053適用中に既に付与されてしまった誤り（同点者が別順位扱い）の監査・補正
-- ------------------------------------------------------------
-- rank_rewards_applied=trueのライブについて、point_historyに記録された順位・
-- 獲得量を「rank()で計算し直した場合の正しい値」と突き合わせる。一致しない
-- 行だけが返るので、0が返れば影響なし。manager_best（運営ベスト）は
-- point_historyではなくnotificationsに記録される別経路のため混入しない。
create or replace function public.audit_rank_reward_mismatches()
returns table (
  live_id uuid,
  sequence_number int,
  user_id uuid,
  recorded_gain int,
  recorded_rank int,
  correct_gain int,
  correct_rank int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  return query
  with target_lives as (
    select id, sequence_number from public.lives where rank_rewards_applied = true
  ),
  player_totals as (
    select p.live_id, p.id as participant_id, p.user_id,
           coalesce(sum(a.score_total), 0) as total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.role = 'player' and p.live_id in (select id from target_lives)
    group by p.live_id, p.id, p.user_id
  ),
  ranked as (
    select *, rank() over (partition by live_id order by total_score desc) as rnk
    from player_totals
  ),
  correct as (
    select live_id, user_id,
      10 + total_score
        + (case rnk when 1 then 100 when 2 then 60 when 3 then 30 else 0 end) as correct_gain,
      rnk as correct_rank
    from ranked
  ),
  recorded as (
    -- 「訂正」ラベルの行（本関数の補正処理自体が挿入する行）は元の付与記録では
    -- ないので比較対象から除く。
    select live_id, user_id, points as recorded_gain,
      case
        when label like '%（1位）%' then 1
        when label like '%（2位）%' then 2
        when label like '%（3位）%' then 3
        else null
      end as recorded_rank
    from public.point_history
    where live_id in (select id from target_lives)
      and label not like '%訂正%'
  )
  select r.live_id, tl.sequence_number, r.user_id,
    r.recorded_gain, r.recorded_rank, c.correct_gain, c.correct_rank
  from recorded r
  join correct c on c.live_id = r.live_id and c.user_id = r.user_id
  join target_lives tl on tl.id = r.live_id
  where r.recorded_gain <> c.correct_gain
     or coalesce(r.recorded_rank, 0) <> coalesce(c.correct_rank, 0);
end;
$$;

grant execute on function public.audit_rank_reward_mismatches() to authenticated;
revoke execute on function public.audit_rank_reward_mismatches() from public;
revoke execute on function public.audit_rank_reward_mismatches() from anon;

-- 監査で見つかった差分だけをprofilesへ反映し、point_historyに訂正の行を残す
-- （既に訂正済みのライブに対する二重補正は防ぐ）。呼び方：
--   select * from public.audit_rank_reward_mismatches(); -- まず一覧を確認
--   select * from public.fix_rank_reward_mismatches('対象のlive_id');
create or replace function public.fix_rank_reward_mismatches(p_live_id uuid)
returns table (user_id uuid, delta int)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_already_fixed boolean;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select exists(
    select 1 from public.point_history
    where live_id = p_live_id and label like '%訂正%'
  ) into v_already_fixed;
  if v_already_fixed then
    raise exception 'ALREADY_FIXED';
  end if;

  for rec in
    select * from public.audit_rank_reward_mismatches() where live_id = p_live_id
  loop
    update public.profiles set
      mastery_meter = mastery_meter + (rec.correct_gain - rec.recorded_gain),
      total_points = total_points + (rec.correct_gain - rec.recorded_gain),
      points_balance = points_balance + (rec.correct_gain - rec.recorded_gain),
      award_count_first = award_count_first
        - (case when rec.recorded_rank = 1 then 1 else 0 end)
        + (case when rec.correct_rank = 1 then 1 else 0 end),
      award_count_second = award_count_second
        - (case when rec.recorded_rank = 2 then 1 else 0 end)
        + (case when rec.correct_rank = 2 then 1 else 0 end),
      award_count_third = award_count_third
        - (case when rec.recorded_rank = 3 then 1 else 0 end)
        + (case when rec.correct_rank = 3 then 1 else 0 end)
    where id = rec.user_id;

    insert into public.point_history (user_id, live_id, points, mastery, label)
    select rec.user_id, p_live_id, (rec.correct_gain - rec.recorded_gain), (rec.correct_gain - rec.recorded_gain),
      '第' || l.sequence_number || '回ライブ 順位ボーナス訂正（同点処理の誤り）'
    from public.lives l where l.id = p_live_id;

    user_id := rec.user_id;
    delta := rec.correct_gain - rec.recorded_gain;
    return next;
  end loop;
end;
$$;

grant execute on function public.fix_rank_reward_mismatches(uuid) to authenticated;
revoke execute on function public.fix_rank_reward_mismatches(uuid) from public;
revoke execute on function public.fix_rank_reward_mismatches(uuid) from anon;

-- ============================================================
-- 2) kick/unkickとeligible_judge_count更新を原子的にする
-- ============================================================
-- 従来はクライアント側で「participants.kicked_at更新→各turnsを1件ずつ個別に
-- update」という複数回のSupabase呼び出しに分かれており、後半のturns更新が
-- 一部だけ失敗する部分状態がありえた。さらに「最新状態を取得」は今のDBの値を
-- 読み直すだけで、間違ったeligible_judge_countそのものは直らない。
-- kick_participant/unkick_participantは1つのSECURITY DEFINER関数の中で
-- participants更新とturns再計算を両方行い、Postgresの関数呼び出し自体が
-- 1トランザクションになる性質を利用して、途中で失敗すれば何も変更されない
-- ようにする。加えて、過去に不整合が残っている場合のために、実際に再計算を
-- 行う独立した修復用RPC(resync_eligible_judge_counts)も用意する。
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

  -- 採点中（表示中の回答がまだ確定していない）は退場操作を禁止する
  -- （eligible_judge_countを審査サイクルの途中で変えると、既に表示済みの
  -- 玉数と新しい分母がクライアントによってズレる恐れがあるため）。
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
    )
    where t.live_id = v_live_id and t.status in ('pending', 'active');
  end if;

  return query select true, null::text;
end;
$$;

grant execute on function public.unkick_participant(uuid) to authenticated;
revoke execute on function public.unkick_participant(uuid) from public;
revoke execute on function public.unkick_participant(uuid) from anon;

-- 過去の不整合（このマイグレーション以前の非原子的な処理で一部だけ更新漏れが
-- 残っている等）を、現在の参加者一覧から実際に再計算して直すための独立した
-- 修復コマンド。「最新状態を取得」（読み直すだけ）とは異なり、これはDBの値
-- そのものを書き換える。
create or replace function public.resync_eligible_judge_counts(p_live_id uuid)
returns table (ok boolean, updated_turns int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  update public.turns t
  set eligible_judge_count = (
    select count(*) from public.participants p
    where p.live_id = p_live_id and p.role = 'player' and p.kicked_at is null
      and p.group_id <> t.group_id
  )
  where t.live_id = p_live_id and t.status in ('pending', 'active');
  get diagnostics v_count = row_count;

  return query select true, v_count;
end;
$$;

grant execute on function public.resync_eligible_judge_counts(uuid) to authenticated;
revoke execute on function public.resync_eligible_judge_counts(uuid) from public;
revoke execute on function public.resync_eligible_judge_counts(uuid) from anon;

-- ============================================================
-- 3) 組数を減らした場合の古いgroups行の除外（begin_game）
-- ============================================================
-- 従来はDB内の実際のgroups件数をそのまま使っていたため、例えば3組→2組に
-- 変更した後も、既に作成済みの3組目のgroups行が残っていればそれも含めて
-- turnsを作ってしまっていた。lives.planned_group_countを正とし、
-- group_orderがそれ以内の組だけを対象にする（planned_group_countが未設定の
-- 古いライブでは、従来どおり実際の全groups件数を使う）。
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
  where live_id = p_live_id and role = 'player' and kicked_at is null;
  if v_player_count = 0 then
    return query select false, '組分けされたプレイヤーがいません', null::uuid;
    return;
  end if;

  select planned_group_count into v_planned_group_count
    from public.lives where id = p_live_id;

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

  -- (round, group_order)の順にturnsを作成する。group_orderがplanned_group_count
  -- を超える組（減らした後の古い組）は対象にしない。eligible_judge_countは
  -- 「その組以外のplayer数（退場済みを除く）」をここで1回だけ確定させる。
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
revoke execute on function public.begin_game(uuid) from public;
revoke execute on function public.begin_game(uuid) from anon;

-- ============================================================
-- 4) randomizeGroupsの原子化・エラー確認・planned_group_count限定
-- ============================================================
-- 従来はクライアント側で「（無ければ）groups作成→全員リセット→再割当」を
-- Promise.allで並列実行する複数回のSupabase呼び出しに分かれており、
-- update自体はネットワーク越しに失敗してもPromise.allが例外を投げるとは限らず
-- （Supabaseのupdateは失敗してもresult.errorになるだけ）、確認していなかった。
-- 一部だけaudience/group_id=nullのまま成功扱いになりうる状態だった。
-- randomize_groups()は1つのSECURITY DEFINER関数にまとめ、groups作成・全員
-- リセット・再割当を1トランザクションにする。使用する組もplanned_group_count
-- 件（group_order昇順の先頭からその件数）に限定する。
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

  select array_agg(id order by random())
    into v_player_ids
    from public.participants
    where live_id = p_live_id and preferred_role = 'player' and kicked_at is null;
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
  update public.participants
    set group_id = null, role = 'audience'
    where live_id = p_live_id and preferred_role = 'player' and kicked_at is null;

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

-- ============================================================
-- 5) createLivePreparationのトランザクション化
-- ============================================================
-- 従来はクライアント側で「lives作成→topics作成」の2回のSupabase呼び出しに
-- 分かれており、後者が失敗するとscheduledなライブだけが残ってしまっていた。
-- 1つのSECURITY DEFINER関数にまとめ、topics作成が失敗（お題が足りない等）
-- すれば例外でlives作成ごとロールバックされるようにする。お題のランダム抽選
-- 自体は従来どおりクライアント側(pickRandomTopicBankEntries)で行い、選んだ
-- topic_bank idの配列だけをここへ渡す（本文・formatはここでtopic_bankから
-- 取り直すため、クライアントから任意の本文を注入されることもない）。
create or replace function public.create_live_preparation(
  p_scheduled_at timestamptz,
  p_title text,
  p_max_players int,
  p_planned_group_count int,
  p_topic_bank_ids uuid[]
)
returns table (ok boolean, reason text, live_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_live_id uuid;
  v_inserted_topics int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  if p_planned_group_count < 1 then
    return query select false, '組数は1以上にしてください', null::uuid;
    return;
  end if;

  select id into v_existing_id from public.lives where current_phase <> 'closed' limit 1;
  if v_existing_id is not null then
    return query select false, '既に進行中のライブがあります', v_existing_id;
    return;
  end if;

  insert into public.lives (
    scheduled_at, current_phase, title, description, max_players,
    planned_group_count, reception_starts_at, reception_ends_at, created_by
  ) values (
    p_scheduled_at, 'scheduled', p_title, null, p_max_players,
    p_planned_group_count, null, null, auth.uid()
  )
  returning id into v_live_id;

  insert into public.topics (live_id, body, format, topic_bank_id)
  select v_live_id, tb.body, tb.format, tb.id
  from public.topic_bank tb
  where tb.id = any(p_topic_bank_ids);
  get diagnostics v_inserted_topics = row_count;

  if v_inserted_topics < coalesce(array_length(p_topic_bank_ids, 1), 0) then
    -- 例外を投げてこの関数呼び出し全体（lives作成含む）をロールバックする。
    raise exception 'お題の登録に失敗しました（一部のお題が見つかりません）';
  end if;

  return query select true, null::text, v_live_id;
end;
$$;

grant execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[]) to authenticated;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[]) from public;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[]) from anon;
