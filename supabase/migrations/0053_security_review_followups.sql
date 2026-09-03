-- 0051・0052の再レビューで見つかった残存問題の修正。
-- 0051・0052は書き換えず、必要な関数・ポリシーをここで作り直す（create or replace /
-- drop policy + create policyは既存のマイグレーションが使ってきたのと同じ手法）。

-- ============================================================
-- 1) apply_live_rank_rewardsの実行権限を最優先で確認・修正する
-- ============================================================
-- 背景：PostgreSQLは関数作成時、明示的にrevokeしない限りEXECUTE権限を
-- PUBLIC（＝anonを含む全ロール）に自動的に付与する。このリポジトリでは
-- 0033以降、apply_live_rank_rewards()に「grant execute ... to authenticated」は
-- 積み重ねてきたが、PUBLICからのrevokeは一度も行っていなかった。
-- さらに0034で、Supabaseダッシュボードのsql Editor（postgresロールで実行され
-- auth.uid()がnullになる）からの保守実行を通すため、
-- 「auth.uid() is not null and not is_host()」という、認証コンテキストが
-- 無い場合はis_host()チェック自体を素通りさせる条件に緩めていた。
-- この2つが組み合わさると、ログインしていない匿名(anon)クライアントが
-- anon keyだけでapply_live_rank_rewards(任意のlive_id)を直接呼び出せてしまい
-- （PostgRESTのrpcエンドポイントはEXECUTE権限があれば認証ヘッダ無しでも
-- 呼べる）、auth.uid() is nullによりis_host()チェックがスキップされる、
-- という重大な抜け道になっていた。
-- 対策：
--   (a) PUBLIC/anonからEXECUTEをrevokeし、authenticatedにだけ許可する
--       （SQL Editorはpostgresロールで実行されるため、この2ロールへの
--       revokeでは一切影響を受けず、保守実行の経路は維持される）。
--   (b) 対象ライブがcurrent_phase='closed'でなければ実行そのものを拒否する
--       （早すぎる加算・意図しない多重呼び出しを防ぐ）。closeLive/
--       retry_live_rank_rewards（0051）はどちらも「closed後にだけ」
--       apply_live_rank_rewardsを呼ぶ設計なので、この制約を追加しても
--       正規の呼び出し経路は一切壊れない。SQL Editorからの過去分一括反映
--       （既にclosedなライブが対象）も引き続き成功する。
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

revoke execute on function public.apply_live_rank_rewards(uuid) from public;
revoke execute on function public.apply_live_rank_rewards(uuid) from anon;
grant execute on function public.apply_live_rank_rewards(uuid) to authenticated;

-- 同じクラスの問題（PUBLICへの暗黙付与）は、0051で新設した他のSECURITY DEFINER
-- 関数にも共通して存在しうる。こちらはいずれも内部でis_host()を無条件に
-- チェックしており（auth.uid() is nullによる素通りは無い）実害は無いが、
-- 多層防御として同様にPUBLIC/anonからrevokeしておく。
revoke execute on function public.close_live(uuid) from public;
revoke execute on function public.close_live(uuid) from anon;
revoke execute on function public.retry_live_rank_rewards(uuid) from public;
revoke execute on function public.retry_live_rank_rewards(uuid) from anon;
revoke execute on function public.begin_game(uuid) from public;
revoke execute on function public.begin_game(uuid) from anon;
revoke execute on function public.join_live(uuid, text, text) from public;
revoke execute on function public.join_live(uuid, text, text) from anon;

-- retry_live_rank_rewards（0051）は、内部でapply_live_rank_rewardsを呼ぶだけで
-- 自身では対象ライブのcurrent_phaseを確認していなかった。上記(b)によって
-- apply_live_rank_rewards自体がclosed以外を拒否するようになったため、
-- retry_live_rank_rewardsは変更しなくてもDB側の確認が効くようになる
-- （拒否時はexception when othersで捕まえてrewards_errorに'LIVE_NOT_CLOSED'が
-- 入り、クライアントにはfalse/エラーとして返る＝安全側に倒れる）。

-- ============================================================
-- 2) scores_insert_own_as_playerに同一ライブ確認を追加する
-- ============================================================
-- 従来のポリシーは judge_participant_id から参加者行(p)を引いてくるだけで、
-- 「p.live_id が採点対象のanswerが属するライブと一致するか」を確認していな
-- かった。judge_participant_idはparticipants.idという単なるuuidであり、
-- 呼び出し元(auth.uid())が過去に別のライブで参加した際のparticipant.idを
-- 指定してscoresへINSERTしようとした場合、p.group_id <> t.group_id（自分の
-- 過去ライブでのgroup_idと今のturnのgroup_idはほぼ確実に一致しない）が
-- たまたま常に真になるだけで通ってしまい、他人のライブの採点に紛れ込める
-- 抜け道になっていた。p.live_id = l.id を必須にする。
-- answers側も同じ理由でp.live_id = t.live_idを明示的に追加する（group_idの
-- 一致だけに頼らない多層防御。0048のinfinite recursion対策には触れない）。
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
-- 4) 途中退場・退場解除とeligible_judge_countの整合（begin_game側）
-- ============================================================
-- begin_game（0051）はゲーム開始時点のプレイヤー数・各組の審査資格者数を
-- kicked_atを考慮せずに数えていた。ゲーム開始前に既に退場済みの参加者が
-- いた場合、その人数ぶんeligible_judge_countが過大になってしまう。
-- 退場者を最初から母数・組分けの対象外にする。
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
  where live_id = p_live_id and role = 'player' and kicked_at is null;
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
  -- 「その組以外のplayer数（退場済みを除く）」をここで1回だけ確定させる(0049と同じ考え方)。
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
-- 7) join_live：プレイヤー→観客への変更をRPC側でも拒否する
-- ============================================================
-- 仕様書_v2.md §2.1は「見学希望→プレイヤー希望」の変更のみ明記しており、
-- 逆方向（プレイヤー→観客）は想定されていない。UI(OpeningView.tsx)は既に
-- プレイヤー→観客のボタンを出していないが、RPC自体は従来
-- 「on conflict do update set preferred_role = excluded.preferred_role」で
-- 無条件に上書きしていたため、join_liveを直接呼べば（画面を介さなくても）
-- 一度プレイヤー登録した人が観客へ戻ることができてしまっていた。
-- 0052の自己除外ロジックはそのまま維持しつつ、この向きの変更だけをDB側でも拒否する。
create or replace function public.join_live(p_live_id uuid, p_preferred_role text, p_referral_source text default null)
returns public.participants
language plpgsql
security definer set search_path = public
as $$
declare
  v_max int;
  v_count int;
  v_phase text;
  v_kicked timestamptz;
  v_suspended boolean;
  v_existing_role text;
  v_row public.participants;
begin
  if p_preferred_role not in ('player', 'audience') then
    raise exception 'INVALID_ROLE';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  select max_players, current_phase into v_max, v_phase
    from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;

  select kicked_at into v_kicked
    from public.participants
    where live_id = p_live_id and user_id = auth.uid();
  if v_kicked is not null then
    raise exception 'PARTICIPANT_KICKED';
  end if;

  select preferred_role into v_existing_role
    from public.participants
    where live_id = p_live_id and user_id = auth.uid();
  if v_existing_role = 'player' and p_preferred_role = 'audience' then
    raise exception 'ROLE_DOWNGRADE_NOT_ALLOWED';
  end if;

  if p_preferred_role = 'player' and v_phase not in ('interlude', 'opening') then
    raise exception 'PLAYER_JOIN_CLOSED';
  end if;

  if v_max is not null and p_preferred_role = 'player' then
    select count(*) into v_count
      from public.participants
      where live_id = p_live_id
        and preferred_role = 'player'
        and user_id <> auth.uid();
    if v_count >= v_max then
      raise exception 'PLAYER_LIMIT_REACHED';
    end if;
  end if;

  insert into public.participants (live_id, user_id, preferred_role, referral_source)
  values (p_live_id, auth.uid(), p_preferred_role, p_referral_source)
  on conflict (live_id, user_id) do update
    set preferred_role = excluded.preferred_role,
        -- 既に流入元が記録済みなら上書きしない（再度role変更で呼ばれた時に消さない）。
        referral_source = coalesce(public.participants.referral_source, excluded.referral_source)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.join_live(uuid, text, text) to authenticated;
revoke execute on function public.join_live(uuid, text, text) from public;
revoke execute on function public.join_live(uuid, text, text) from anon;
