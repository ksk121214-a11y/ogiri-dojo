-- 0055適用後の再レビューで見つかった残存問題の修正。
-- 0055は既に本番へ適用済みの可能性があるため書き換えず、ここで作り直す。
-- 0056自体はまだ未適用のため、このファイルは直接改訂している
-- （0055→0056の順で適用する前提。0055が未適用の環境では、先に0055を
-- 適用してからこの0056を適用すること）。

-- 2026-09-06：本ファイルは複数の安全確認(do $$ ... raise exception $$)を
-- 含む。個々のSQL文はデフォルトで自動コミットされるため、これらの確認を
-- 単体で置いただけでは「確認より前の変更（関数の作り直し等）は既に確定した
-- のに、確認で例外が飛んで残りが適用されない」という中途半端な状態になり
-- うることを実際に確認した。begin/commitで全体を1つのトランザクションに
-- まとめ、途中のどの安全確認で止まっても、それより前の変更も含めて
-- 何も反映されない（全部成功するか、全く反映されないかのどちらか）ようにする。
begin;

-- ============================================================
-- 0) 安全確認：rank_reward_correctionsに既存データが無いことを機械的に確認する
-- ============================================================
-- 本マイグレーションはrank_reward_correctionsのテーブル構造を作り直す
-- （後述の理由でcorrection_versionによるバージョン管理をやめ、よりシンプルで
-- 頑丈な設計に変える）。これは「まだfix_rank_reward_mismatches()が実際に
-- 実行されたことが無い（＝補正データが1件も無い）」ことが前提になる。
-- 推測で空と判断せず、既存データが1件でもあれば、このマイグレーション自体を
-- ここで止める（例外を投げて中断する）。もし止まった場合は、既存データを
-- 見ながら手動で移行方法を検討する必要がある（自動では何もしない）。
do $$
declare
  v_existing_rows int;
begin
  if to_regclass('public.rank_reward_corrections') is not null then
    execute 'select count(*) from public.rank_reward_corrections' into v_existing_rows;
    if v_existing_rows > 0 then
      raise exception 'rank_reward_corrections already has % row(s). This migration assumes it is empty (fix_rank_reward_mismatches has never been run for real). Stop and review manually before proceeding.', v_existing_rows;
    end if;
  end if;
end $$;

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

-- ============================================================
-- 1b) 補正の再設計：バージョン管理をやめ、「現在の合計」を正とする設計にする
-- ============================================================
-- 背景（今回の再レビューで発覚した重大バグ）：
-- 旧設計は「元の付与行（訂正を除く）」だけをrecorded_gainとして使っていた
-- ため、既に一度訂正済みのライブを再監査すると、訂正で足した/引いた分を
-- 二重に足す/引く事故が起きる（例：元170pt→v1で+40pt訂正→実際は210pt
-- なのに、v2の監査が「170pt」のまま比較してしまい、正解210ptとの差分
-- +40ptを再び加算し、最終的に250ptになってしまう）。
--
-- 対策：recorded_gainを「元の付与行だけ」ではなく「そのlive_id・user_idに
-- 記録されている全point_history.pointsの合計（訂正行も含む）」にする。
-- これは常に「現在profilesへ実際に反映されている金額」と一致するため、
-- 正解値との差分を取れば、訂正が何回積み重なっていても正しい差分（＝
-- 二重加算・二重減算されない差分）になる。この合計値を正とする設計に
-- することで、「このライブは既に補正済みだから除外する」というバージョン
-- 管理そのものが不要になる（一度正しく直ったライブは、以後の監査で
-- 自然に「差分なし」として出てこなくなるため）。
--
-- 受賞順位(award_count_first/second/third)についても同様に、「今
-- profilesに実際に反映されている順位」を「元のラベルだけ」から判断せず、
-- 現在の合計金額から逆算する：合計 = 参加10pt + 得点(total_score、
-- ライブが閉幕済みなので不変) + 順位ボーナス(100/60/30/0)。total_scoreは
-- 既知なので、合計からそれを引けば、これまで何回訂正が重なっていても
-- 現在award_count_*へ反映されているはずの順位が一意に復元できる
-- （どの訂正でも、金額の差分と受賞回数の差分を必ず同じrnk基準で連動させて
-- 適用しているため、この2つが食い違うことはない）。
--
-- rank_reward_correctionsは「補正済みかどうかを判定する」役割から、
-- 「誰がいつ何を直したかのログ」という役割だけに変える（判定には使わない）。
-- 既存データが無いことを冒頭のdoブロックで確認済みなので、作り直す。
drop table if exists public.rank_reward_corrections;

create table public.rank_reward_corrections (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  points_delta int not null,
  live_count_delta int not null,
  corrected_by uuid references public.profiles (id) on delete set null,
  corrected_at timestamptz not null default now()
);

alter table public.rank_reward_corrections enable row level security;

create policy "rank_reward_corrections_select_host"
  on public.rank_reward_corrections for select
  using (is_host());
-- insertは専用のSECURITY DEFINER関数からのみ（authenticatedへの直接grantはしない）。

drop function if exists public.fix_rank_reward_mismatches(uuid);
drop function if exists public.audit_rank_reward_mismatches();
drop function if exists public._compute_rank_reward_mismatches();
drop function if exists public._rank_reward_correction_version();

-- 各ライブ・各ユーザーについて「現在profilesに反映されている金額・順位」と
-- 「今のルールで計算し直した正しい金額・順位」を比較する内部関数。
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
      case when rk.rk_rnk <= 3 then rk.rk_rnk else null end as cr_rank_tier
    from ranked rk
  ),
  -- 2026-09-06:「付与漏れ訂正時の二重加算・二重減算」対応。「訂正」行を
  -- 除外せず、同じlive_id・user_idのpoint_history.pointsを全て合算する。
  -- これが「今実際にprofilesへ反映されている合計」そのものになる。
  recorded as (
    select
      ph.live_id as rd_live_id,
      ph.user_id as rd_user_id,
      sum(ph.points)::int as rd_total
    from public.point_history ph
    where ph.live_id in (select tl2.t_live_id from target_lives tl2)
    group by ph.live_id, ph.user_id
  ),
  -- 2026-09-06:「correct側に存在しないユーザーの元順位を復元できない」対応。
  -- 以前は「合計金額 - 参加10pt - 得点」から順位を逆算していたが、correctに
  -- 存在しないユーザー（もう採点対象外＝total_scoreの基準が無い）は必ず
  -- NULLになり、award_countを取り消せなかった。
  -- 代わりに「そのlive_id・user_idについて最後に書き込まれたpoint_history
  -- 行のラベル」から直接、現在反映されている順位を読み取る方式にする。
  -- apply_live_rank_rewards（元の付与）・fix_rank_reward_mismatches（本関数の
  -- 訂正、下で修正）のどちらも、その時点で確定した順位を必ずラベルに
  -- 書き込むようにするため、最新の1行のラベルは常に「今実際にaward_countへ
  -- 反映されている順位」と一致する。correctの有無・金額の逆算に依存しない
  -- ため、どちらのケースでも取りこぼさない。
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
    -- 2026-09-06: recorded_existsは「point_historyに何らかの行が
    -- （元の付与行・訂正行を問わず）既に存在するか」を表す。live_countは
    -- 「このlive_id・user_idの組み合わせに一度でも報酬が記録されたか」で
    -- 判断すべきで、「元の付与行だけがあるか」に絞ると、訂正で初めて
    -- 追加された人が将来また別の訂正の対象になった時に、live_countを
    -- 再び+1してしまう（二重加算）。point_historyに行が有る=既に
    -- カウント済み、という判定にすることでこれを避ける。
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

revoke execute on function public._compute_rank_reward_mismatches() from public;
revoke execute on function public._compute_rank_reward_mismatches() from anon;
revoke execute on function public._compute_rank_reward_mismatches() from authenticated;

-- ============================================================
-- 1c) 0054/0055由来の古い訂正履歴を安全に移行する
-- ============================================================
-- 背景：0054・0055のfix_rank_reward_mismatches()は、常に固定文言
-- 「第X回ライブ 順位ボーナス訂正（同点処理の誤り）」をラベルに書き込んで
-- おり、その訂正の結果どの順位になったかをラベルに含めていなかった。
-- 0054は本番へ適用済みのため、この文言の訂正行が実際に存在する可能性が
-- ある（0055・0056はまだ未適用のため、この文言を書けるのは0054だけ）。
-- 0056のrecorded_latest_labelは「最後に書き込まれたラベル」から現在の
-- 順位を読み取る設計のため、この文言の行が最新のユーザーは順位が
-- NULLとして読めてしまい、監査に「順位だけ不一致（差分0pt）」として
-- 永久に残り続ける（fixはgain_delta=0の行をcontinueでスキップするため）。
--
-- 対応：該当ユーザーごとに、現在の合計ポイント(_compute_rank_reward_
-- mismatchesのout_recorded_gain)が、今のルールで計算し直した正しい報酬額
-- (out_correct_gain)と既に一致している場合だけ「安全」と判断し、その
-- 最新の該当ラベルへ今の正しい順位表記をその場で補完する
-- （ポイント・受賞回数は一切変更しない。ラベルの文言だけを直す）。
-- 一致しない場合は「単純に順位NULL→現在の正解順位をもう一度加算すると
-- 受賞回数を二重加算してしまう」ため自動では判断せず、対象を報告して
-- マイグレーション全体を安全に停止する（begin/commitで包んでいるため、
-- ここで停止すれば0056の変更は何も反映されない）。
do $$
declare
  v_unsafe_count int;
begin
  select count(*) into v_unsafe_count
  from (
    select distinct on (ph.live_id, ph.user_id) ph.live_id, ph.user_id
    from public.point_history ph
    where ph.label like '%同点処理の誤り%'
    order by ph.live_id, ph.user_id, ph.created_at desc, ph.id desc
  ) legacy_latest
  join public._compute_rank_reward_mismatches() m
    on m.out_live_id = legacy_latest.live_id and m.out_user_id = legacy_latest.user_id
  where m.out_gain_delta <> 0;

  if v_unsafe_count > 0 then
    raise exception '% legacy (0054/0055-era) correction row(s) exist whose current point total does NOT yet match the freshly recomputed correct amount. Run: select * from public.audit_rank_reward_mismatches(); to see them, resolve manually, then re-run this migration. (This migration made no changes.)', v_unsafe_count;
  end if;
end $$;

-- 上のチェックを通過した（＝古い訂正行はあっても全て安全に判定できる）
-- 場合だけ、その最新の該当ラベルへ正しい順位表記を補完する。
with legacy_latest as (
  select distinct on (ph.live_id, ph.user_id)
    ph.id as row_id, ph.live_id, ph.user_id, ph.label
  from public.point_history ph
  where ph.label like '%同点処理の誤り%'
  order by ph.live_id, ph.user_id, ph.created_at desc, ph.id desc
)
update public.point_history ph
set label = ll.label
  || (case m.out_correct_rank when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
from legacy_latest ll
join public._compute_rank_reward_mismatches() m
  on m.out_live_id = ll.live_id and m.out_user_id = ll.user_id
where ph.id = ll.row_id;

-- 人が確認するための一覧。recorded_gainが既に「現在の合計」になっている
-- ため、一度正しく直ったライブ・ユーザーは自然に差分0になり、ここには
-- 出てこなくなる（＝バージョン管理をしなくても「補正済みは除外される」）。
create or replace function public.audit_rank_reward_mismatches()
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
  if not is_host() then
    raise exception 'not authorized';
  end if;

  return query select * from public._compute_rank_reward_mismatches();
end;
$$;

grant execute on function public.audit_rank_reward_mismatches() to authenticated;
revoke execute on function public.audit_rank_reward_mismatches() from public;
revoke execute on function public.audit_rank_reward_mismatches() from anon;

-- 監査で見つかった差分だけをprofilesへ反映し、point_historyに訂正の行を残す。
-- 呼び方：
--   select * from public.audit_rank_reward_mismatches(); -- まず一覧を確認
--   select * from public.fix_rank_reward_mismatches('対象のlive_id');
create or replace function public.fix_rank_reward_mismatches(p_live_id uuid)
returns table (out_user_id uuid, out_delta int, out_live_count_delta int)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_live_count_delta int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  -- 2026-09-06:「同じ訂正を二重実行できない」対応。対象ライブの行を
  -- ロックしてから処理する（トランザクション終了までロックが保持される
  -- ため、2件目は1件目がコミットするまで待たされる。1件目が既に
  -- profilesを直しているため、2件目が読み直す時点ではrecorded_gainが
  -- 既に正解値と一致しており、_compute_rank_reward_mismatches()は
  -- その差分を0件として返す＝2件目は何もしない、という形で自然に
  -- 冪等になる。バージョン番号を管理する必要が無い）。
  perform 1 from public.lives where id = p_live_id for update;

  for rec in
    select * from public._compute_rank_reward_mismatches() where out_live_id = p_live_id
  loop
    if rec.out_gain_delta = 0 then
      continue;
    end if;

    -- 2026-09-06:「付与漏れ訂正時にlive_countが直らない」対応。
    -- recorded_exists/correct_existsを明示的に見て判定する：
    --   元の記録が無く正しい報酬がある(付与漏れ) → live_count +1
    --   元の記録はあるが正しくは対象外(余分な付与) → live_count -1
    --   両方に記録がある通常の順位・金額の訂正       → live_countは変えない
    v_live_count_delta := 0;
    if not rec.out_recorded_exists and rec.out_correct_exists then
      v_live_count_delta := 1;
    elsif rec.out_recorded_exists and not rec.out_correct_exists then
      v_live_count_delta := -1;
    end if;

    update public.profiles set
      mastery_meter = mastery_meter + rec.out_gain_delta,
      total_points = total_points + rec.out_gain_delta,
      points_balance = points_balance + rec.out_gain_delta,
      live_count = greatest(0, live_count + v_live_count_delta),
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

    -- 2026-09-06:「訂正履歴のラベルが原因を限定した文言になっている」対応。
    -- 付与漏れ・順位訂正のどちらにも使うため、原因を限定しない文言にする。
    -- 加えて「correct側に存在しないユーザーの元順位を復元できない」対応の
    -- 一環として、この訂正の結果どの順位になったか(out_correct_rank)を
    -- 必ずラベルに書き込む（1〜3位以外・対象外ならラベルに順位を付けない）。
    -- これにより、次にこの関数が呼ばれた時、_compute_rank_reward_mismatches
    -- は「そのlive_id・user_idの最新のラベル」を見るだけで、correctに
    -- このユーザーが存在するかどうかに関わらず、現在反映されている順位を
    -- 正しく読み取れる。
    insert into public.point_history (user_id, live_id, points, mastery, label)
    select rec.out_user_id, p_live_id, rec.out_gain_delta, rec.out_gain_delta,
      '第' || l.sequence_number || '回ライブ ライブ報酬訂正'
        || (case rec.out_correct_rank when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
    from public.lives l where l.id = p_live_id;

    insert into public.rank_reward_corrections (live_id, user_id, corrected_by, points_delta, live_count_delta)
    values (p_live_id, rec.out_user_id, auth.uid(), rec.out_gain_delta, v_live_count_delta);

    out_user_id := rec.out_user_id;
    out_delta := rec.out_gain_delta;
    out_live_count_delta := v_live_count_delta;
    return next;
  end loop;
end;
$$;

grant execute on function public.fix_rank_reward_mismatches(uuid) to authenticated;
revoke execute on function public.fix_rank_reward_mismatches(uuid) from public;
revoke execute on function public.fix_rank_reward_mismatches(uuid) from anon;

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
-- 専用のSECURITY DEFINER関数に切り出し、group_idが指定されたライブと
-- 同じライブのgroupsに属するかを必ず検証する。
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

-- ============================================================
-- 4) DBレベルでparticipants.live_id = groups.live_idを複合外部キーで保証する
-- ============================================================
-- 背景：カスタムトリガー(BEFORE INSERT/UPDATE ON participants)は
-- participants側の変更しか検査できず、groups.live_idを後から変更する
-- 経路（万一そのような更新が起きた場合）は防げない。また、
-- 既存の不整合行があるかどうかも検査していなかった。
-- 複合外部キーpublic.participants(group_id, live_id)
--   references public.groups(id, live_id)
-- にすれば、参照側(participants)・被参照側(groups)どちらの変更でも
-- PostgreSQL自身が不変条件を強制する（groups側のid/live_idを更新して
-- 既存の参照と矛盾する状態になる操作は、既定のNO ACTIONにより自動的に
-- 拒否される）。group_idがnullの行（観客・未割当）は複合外部キーの
-- 対象外になる（片方でもnullなら制約は評価されないのがSQL標準の挙動）。
--
-- 複合外部キーを追加するには、参照先groups(id, live_id)がUNIQUEである
-- 必要がある（idだけは既にprimary keyだが、複合キーとしての一意性は
-- 別途必要）。追加する前に、既存データに不整合（別ライブのgroup_idを
-- 参照している行）が無いことを機械的に確認し、あれば自動修復せず
-- ここで例外を投げて安全に停止する。
do $$
declare
  v_bad_count int;
begin
  select count(*) into v_bad_count
  from public.participants p
  where p.group_id is not null
    and not exists (
      select 1 from public.groups g where g.id = p.group_id and g.live_id = p.live_id
    );
  if v_bad_count > 0 then
    raise exception 'Found % participants row(s) whose group_id belongs to a different live_id. Fix this data manually before adding the composite foreign key.', v_bad_count;
  end if;
end $$;

alter table public.groups
  add constraint groups_id_live_id_key unique (id, live_id);

alter table public.participants
  add constraint participants_group_live_fkey
  foreign key (group_id, live_id) references public.groups (id, live_id);

commit;
