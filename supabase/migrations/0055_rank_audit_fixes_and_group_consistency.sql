-- 0054適用後（コミット59452fe）の再レビューで見つかった残存問題の修正。
-- 0054は書き換えず、必要な関数・テーブルをここで作り直す/追加する。

-- ============================================================
-- 1) audit_rank_reward_mismatches()の列名衝突（曖昧参照）を修正する
-- ============================================================
-- 背景：RETURNS TABLEの出力列名(live_id/sequence_number/user_id/...)が、
-- 関数本体のCTE内で使う同名のテーブル列（lives.sequence_number等）と
-- PL/pgSQLの名前空間上で衝突し、実際のPostgreSQL(16)で
-- 「column reference "sequence_number" is ambiguous」エラーになることを
-- ローカルで実際に関数を作成・呼び出して確認した。
-- 対策：出力列名をすべて out_ 接頭辞に変更し、テーブル由来の列と
-- 二度と同名にならないようにする（＝出力変数名の変更）。加えて、
-- 本体側もすべてのCTE・列を明示的にテーブルエイリアスで修飾する
-- （どちらか一方だけでなく両方行い、将来同様の事故が起きにくくする）。
drop function if exists public.fix_rank_reward_mismatches(uuid);
drop function if exists public.audit_rank_reward_mismatches();
drop function if exists public._compute_rank_reward_mismatches();

-- 2026-09-04:「補正後は監査結果から消えるようにする」実装で、当初は
-- audit_rank_reward_mismatches()自身に「既に補正済みのライブを除外する」
-- 条件を入れていたが、それをfix_rank_reward_mismatches()からも呼び出すと、
-- fixが「補正済み」の目印(rank_reward_corrections行)を最初にinsertした
-- 直後にこの除外条件へ自分自身が引っかかり、本来直すべき対象が0件に
-- なって何も直らないという事故を、実際にローカルのPostgresで呼び出して
-- 発見した。「差分を計算するだけの内部関数」と「人が見る一覧
-- （補正済みを隠す）」を分離し、fix側は除外の入っていない内部関数を使う。
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
  valid_groups as (
    -- 2026-09-04:「eligible_judge_count・プレイヤー総数・ターン作成・最終順位の
    -- 対象を同じプレイヤー集合から計算する」対応。組数を減らした後の余剰groupは
    -- 対象外にする（begin_game・apply_live_rank_rewardsと同じ基準）。
    select g.id as vg_group_id, g.live_id as vg_live_id
    from public.groups g
    join public.lives l2 on l2.id = g.live_id
    where g.group_order <= coalesce(l2.planned_group_count, 2147483647)
  ),
  player_totals as (
    select
      p.live_id as pt_live_id,
      p.id as pt_participant_id,
      p.user_id as pt_user_id,
      -- sum(int)はPostgresの型昇格でbigintになる。RETURNS TABLEの列をintで
      -- 宣言しているため、ここで明示的にintへ戻しておく（実際にこの関数を
      -- 呼び出すと「Returned type bigint does not match expected type
      -- integer」で失敗することをローカルのPostgres 16で確認して修正した）。
      coalesce(sum(a.score_total), 0)::int as pt_total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.role = 'player'
      and p.kicked_at is null
      and p.live_id in (select tl.t_live_id from target_lives tl)
      and p.group_id in (select vg.vg_group_id from valid_groups vg)
    group by p.live_id, p.id, p.user_id
  ),
  ranked as (
    select
      pt.pt_live_id as rk_live_id,
      pt.pt_user_id as rk_user_id,
      pt.pt_total_score as rk_total_score,
      -- rank()の戻り値はbigint。RETURNS TABLEのcorrect_rank列(int)と型が
      -- 合わないと実行時に失敗するため、ここでintへ明示キャストしておく
      -- （実際にこの関数を呼び出して確認した）。
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
      -- 2026-09-04:「4位以下は順位ボーナスなしとして正常扱いにする」対応。
      -- 4位以降は全員「ボーナスなし」という1つの状態に正規化してから比較する
      -- （生の順位番号(4,5,6...)のまま比較すると、real 4位以下の人を毎回
      -- 誤検出してしまうため）。
      case when rk.rk_rnk <= 3 then rk.rk_rnk else null end as cr_rank_tier
    from ranked rk
  ),
  recorded as (
    -- 「訂正」ラベルの行（本関数の補正処理自体が挿入する行）は元の付与記録では
    -- ないので比較対象から除く。
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
    r.rd_live_id,
    tl3.t_sequence_number,
    r.rd_user_id,
    r.rd_gain,
    r.rd_rank,
    c.cr_gain,
    c.cr_rank,
    c.cr_gain - r.rd_gain
  from recorded r
  join correct c on c.cr_live_id = r.rd_live_id and c.cr_user_id = r.rd_user_id
  join target_lives tl3 on tl3.t_live_id = r.rd_live_id
  where r.rd_gain <> c.cr_gain
     or coalesce(r.rd_rank, 0) <> coalesce(c.cr_rank_tier, 0);
end;
$$;

-- _compute_rank_reward_mismatches()は内部専用（is_host()チェックはこれを
-- 呼び出す2つの公開関数側で行う）。authenticatedには一切grantしない
-- （同じ所有者のSECURITY DEFINER関数からの呼び出しはgrantが無くても行える）。
revoke execute on function public._compute_rank_reward_mismatches() from public;
revoke execute on function public._compute_rank_reward_mismatches() from anon;
revoke execute on function public._compute_rank_reward_mismatches() from authenticated;

-- 人が確認するための一覧。既に補正済み(rank_reward_corrections)のライブは
-- 除外し、「補正後は監査結果から消える」ようにする。
create or replace function public.audit_rank_reward_mismatches()
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
  if not is_host() then
    raise exception 'not authorized';
  end if;

  return query
  select m.*
  from public._compute_rank_reward_mismatches() m
  where not exists (
    select 1 from public.rank_reward_corrections rc where rc.live_id = m.out_live_id
  );
end;
$$;

grant execute on function public.audit_rank_reward_mismatches() to authenticated;
revoke execute on function public.audit_rank_reward_mismatches() from public;
revoke execute on function public.audit_rank_reward_mismatches() from anon;

-- ------------------------------------------------------------
-- 1b) 補正の冪等性をDB側で保証する専用テーブル
-- ------------------------------------------------------------
-- 「同じライブの補正が同時実行されても二重補正されない」ことを、
-- point_historyのラベル文字列の有無ではなく、このテーブルの主キー制約
-- （live_id 1件につき1行）で保証する。fix_rank_reward_mismatches()の
-- 最初の処理としてinsertし、既に補正済みなら主キー違反で即座に失敗する。
create table if not exists public.rank_reward_corrections (
  live_id uuid primary key references public.lives (id) on delete cascade,
  corrected_by uuid references public.profiles (id) on delete set null,
  corrected_at timestamptz not null default now()
);

alter table public.rank_reward_corrections enable row level security;

create policy "rank_reward_corrections_select_host"
  on public.rank_reward_corrections for select
  using (is_host());
-- insertは専用のSECURITY DEFINER関数からのみ（authenticatedへの直接grantはしない）。

-- 監査で見つかった差分だけをprofilesへ反映し、point_historyに訂正の行を残す。
-- 呼び方：
--   select * from public.audit_rank_reward_mismatches(); -- まず一覧を確認
--   select * from public.fix_rank_reward_mismatches('対象のlive_id');
create or replace function public.fix_rank_reward_mismatches(p_live_id uuid)
returns table (out_user_id uuid, out_delta int)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  -- 2026-09-04:「同じライブの補正が同時実行されても二重補正されない」対応。
  -- 主キー制約により、同じlive_idで2回目以降のinsertは即座に一意制約違反で
  -- 失敗し、この関数呼び出し全体（未実施のupdate/insertも含め）がロール
  -- バックされる。チェックしてからinsertする2段階ではなく、insert自体を
  -- 冪等性ゲートにすることで、チェックと実処理の間の競合状態を無くす。
  insert into public.rank_reward_corrections (live_id, corrected_by)
  values (p_live_id, auth.uid());

  -- 2026-09-04: ここは公開版のaudit_rank_reward_mismatches()ではなく、
  -- 補正済み除外の入っていない内部関数を使う（直前のinsertで自分自身が
  -- 「補正済み」になっているため、公開版を呼ぶと対象が0件になってしまう
  -- ことを実際に呼び出して確認した）。
  for rec in
    select * from public._compute_rank_reward_mismatches() where out_live_id = p_live_id
  loop
    -- 2026-09-04:「0ポイント差分の訂正履歴を作らない」対応
    -- （正規化後の比較ロジックにより通常は差分0の行は監査結果に出てこないが、
    -- 念のための防御）。
    if rec.out_gain_delta = 0 then
      continue;
    end if;

    update public.profiles set
      mastery_meter = mastery_meter + rec.out_gain_delta,
      total_points = total_points + rec.out_gain_delta,
      points_balance = points_balance + rec.out_gain_delta,
      award_count_first = award_count_first
        - (case when rec.out_recorded_rank = 1 then 1 else 0 end)
        + (case when rec.out_correct_rank = 1 then 1 else 0 end),
      award_count_second = award_count_second
        - (case when rec.out_recorded_rank = 2 then 1 else 0 end)
        + (case when rec.out_correct_rank = 2 then 1 else 0 end),
      award_count_third = award_count_third
        - (case when rec.out_recorded_rank = 3 then 1 else 0 end)
        + (case when rec.out_correct_rank = 3 then 1 else 0 end)
    where id = rec.out_user_id;

    insert into public.point_history (user_id, live_id, points, mastery, label)
    select rec.out_user_id, p_live_id, rec.out_gain_delta, rec.out_gain_delta,
      '第' || l.sequence_number || '回ライブ 順位ボーナス訂正（同点処理の誤り）'
    from public.lives l where l.id = p_live_id;

    out_user_id := rec.out_user_id;
    out_delta := rec.out_gain_delta;
    return next;
  end loop;
end;
$$;

grant execute on function public.fix_rank_reward_mismatches(uuid) to authenticated;
revoke execute on function public.fix_rank_reward_mismatches(uuid) from public;
revoke execute on function public.fix_rank_reward_mismatches(uuid) from anon;

-- ============================================================
-- 2) apply_live_rank_rewardsの対象プレイヤー集合を他と統一する
-- ============================================================
-- 従来はkicked_at・組の有効性を一切見ずに「role='player'」全員を対象に
-- していた。eligible_judge_count・begin_gameのプレイヤー総数・ターン作成と
-- 同じ基準（kicked_at is null、かつ組数を減らした後の余剰groupに残って
-- いない）に統一する。
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

  with valid_groups as (
    select g.id as vg_group_id
    from public.groups g
    join public.lives l0 on l0.id = g.live_id
    where g.live_id = p_live_id
      and g.group_order <= coalesce(l0.planned_group_count, 2147483647)
  ),
  player_totals as (
    select p.id as participant_id, p.user_id,
           coalesce(sum(a.score_total), 0) as total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.live_id = p_live_id
      and p.role = 'player'
      and p.kicked_at is null
      and p.group_id in (select vg.vg_group_id from valid_groups vg)
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

-- ============================================================
-- 3) begin_game：組分けと現在の組数が食い違ったままの開始を拒否する
-- ============================================================
-- 3組→2組に変更した後、「もう一度ランダムに振り分ける」を押さずに
-- 開始すると、旧3組目にまだ所属したままのプレイヤーがgroup_order超過で
-- turns作成の対象から除外され、その人だけ回答ターンが作られない不整合が
-- あった。kicked_at is nullかつrole='player'の全員が「今回使用する組
-- （group_order <= planned_group_count）」に所属しているかを検証し、
-- 1人でも所属していなければ開始を拒否する。
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

  -- 2026-09-04:「組分けと現在の組数が食い違ったままの開始を拒否する」対応。
  select count(*) into v_orphan_count
  from public.participants p
  where p.live_id = p_live_id and p.role = 'player' and p.kicked_at is null
    and (
      p.group_id is null
      or not exists (
        select 1 from public.groups g
        where g.id = p.group_id
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
-- 4) resync_eligible_judge_countsを採点中は拒否する
-- ============================================================
-- kick/unkick_participantと同じ基準（表示中で未確定の回答がある間）で
-- 分母の再計算そのものを拒否する。戻り値にreasonを追加するため、
-- 一度dropしてから作り直す。
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
  )
  where t.live_id = p_live_id and t.status in ('pending', 'active');
  get diagnostics v_count = row_count;

  return query select true, null::text, v_count;
end;
$$;

grant execute on function public.resync_eligible_judge_counts(uuid) to authenticated;
revoke execute on function public.resync_eligible_judge_counts(uuid) from public;
revoke execute on function public.resync_eligible_judge_counts(uuid) from anon;

-- ============================================================
-- 5) create_live_preparationの同時実行競合・お題数検証をDB側で保証する
-- ============================================================
-- (a) 複数タブからの同時実行対策：トランザクションアドバイザリロックで
--     この関数の実行自体を直列化する（同じロックキーを取り合うことで、
--     2件目は1件目のトランザクションが終わるまで待たされ、その後の
--     「既に進行中のライブがあります」チェックに正しく引っかかる）。
-- (b) 最後の砦として、DB制約でも「未終了(current_phase<>'closed')の
--     ライブは常に高々1件」を保証する（部分UNIQUE INDEX）。アプリの
--     バグでこの関数を経由せず直接insertされた場合でも壊れない。
-- (c) お題数の完全一致・重複IDが無いことをDB側でも検証する。
create unique index if not exists lives_one_active_idx
  on public.lives ((true))
  where current_phase <> 'closed';

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
  v_rounds_per_live constant int := 1; -- src/data/liveRoomTiming.tsのROUNDS_PER_LIVE_DEFAULTと必ず同じ値にすること
  v_existing_id uuid;
  v_live_id uuid;
  v_needed_topics int;
  v_distinct_count int;
  v_inserted_topics int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  if p_planned_group_count < 1 then
    return query select false, '組数は1以上にしてください', null::uuid;
    return;
  end if;

  v_needed_topics := p_planned_group_count * v_rounds_per_live;
  if p_topic_bank_ids is null or array_length(p_topic_bank_ids, 1) is distinct from v_needed_topics then
    return query select false, format('お題の数が一致しません（%s件必要）', v_needed_topics), null::uuid;
    return;
  end if;
  select count(distinct x) into v_distinct_count from unnest(p_topic_bank_ids) as x;
  if v_distinct_count <> array_length(p_topic_bank_ids, 1) then
    return query select false, 'お題が重複しています', null::uuid;
    return;
  end if;

  -- (a) この関数の実行自体を直列化する。ロックはトランザクション終了まで
  -- 保持される（pg_advisory_xact_lock）ため、複数タブから同時に呼ばれても
  -- 1件ずつ順番に処理され、後続は次の「既に進行中のライブがあります」
  -- チェックで正しく弾かれる。
  perform pg_advisory_xact_lock(hashtext('create_live_preparation'));

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

  if v_inserted_topics <> v_needed_topics then
    -- 例外を投げてこの関数呼び出し全体（lives作成含む）をロールバックする。
    raise exception 'お題の登録に失敗しました（一部のお題が見つかりません）';
  end if;

  return query select true, null::text, v_live_id;
end;
$$;

grant execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[]) to authenticated;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[]) from public;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[]) from anon;
