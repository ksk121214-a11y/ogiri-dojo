-- 機能1「司会コンソールに『テスト／本番』の選択を追加する」対応。
--
-- 背景：約200回の動作確認ライブがlives.sequence_number（0017で追加したレガシーの
-- 自動連番、liveTicketNo.tsで#0001形式に変換）を消費しており、本番開始時の表示を
-- #0001から始められない。sequence_number自体は削除・変更せずレガシー列として残し、
-- 新たに「本番ライブだけを対象にした専用の採番」を用意する。
--
-- 0065・0066・0067・およびそれ以前の全ファイルは一切書き換えない。本ファイルは
-- 新規追加のみ（CREATE OR REPLACEで関数本体を差し替える箇所は、grep -n
-- "function public.<name>"で洗い出した「マイグレーション履歴上最新の」本体を基準に
-- した上で、live_mode関連の分岐だけを追加している）。
--
-- 0056/0063の流儀にならい、begin/commitで1トランザクションにまとめ、途中の安全確認
-- （do $$ ... raise exception $$）でどこか1つでも止まれば、それより前の変更も含めて
-- 何も反映されない（全部成功するか、全く反映されないかのどちらか）ようにする。
begin;

-- ============================================================
-- 0) 安全確認：既存のlives行にresults_published=trueのものが無いことを確認する。
-- ============================================================
-- 本マイグレーションは既存の約200行すべてをlive_mode='test'として扱い、後段で
-- 「live_mode='test'のライブはresults_published=trueにできない」というCHECK制約を
-- 追加する。もし過去に実際にSNS公開まで行われた行が1件でもあれば、その制約追加が
-- 失敗する（＝このマイグレーション全体がロールバックされ、何も変わらない）ため
-- 実害は無いが、原因を推測で決めつけず、事前に機械的に検出してここで明示的に
-- 停止し、人が事情を確認できるようにする。
do $$
declare
  v_published_count int;
begin
  select count(*) into v_published_count from public.lives where results_published = true;
  if v_published_count > 0 then
    raise exception 'Found % existing live(s) with results_published=true. This migration marks ALL existing lives as live_mode=''test'' (per the requirement that ~200 prior verification lives are not official shows), which would conflict with the new constraint forbidding published results for test-mode lives. Resolve manually first (decide per-row whether it should become live_mode=''official'' with an official_sequence_number assigned via the official_live_counter, or have results_published unpublished) before re-running this migration. This migration made no changes.', v_published_count;
  end if;
end $$;

-- ============================================================
-- 1) lives.live_mode / lives.official_sequence_number を追加する。
-- ============================================================
-- live_mode: 'test'（既定値。動作確認用、開催番号・ポイント・実績に反映しない）
--            'official'（正式なライブ。開催番号が付与され、ポイント・実績に反映する）。
-- 既存のsequence_number（0017、nextval採番のレガシー列）はそのまま残す。
alter table public.lives
  add column live_mode text not null default 'test' check (live_mode in ('test', 'official'));

alter table public.lives
  add column official_sequence_number int;

-- 既存の約200行を明示的に移行する（過去の付与済みポイント・実績はこの移行だけでは
-- 減算・削除しない＝何もしない）。ADD COLUMN ... DEFAULT 'test'により新しい列は
-- 既存行に対してもすでに'test'/NULLとして振る舞うが、意図を明示するため、また
-- 将来この既定値だけに依存しない安全側の実装として、あえて明示的なUPDATEも行う
-- （0行が変わる場合でもエラーにはならない）。
update public.lives
set live_mode = 'test',
    official_sequence_number = null
where true;

-- ============================================================
-- 2) live_mode/official_sequence_numberの整合性をDB制約で強制する。
-- ============================================================
-- live_mode='test'ならofficial_sequence_numberは必ずnull、
-- live_mode='official'なら必ず non-null であることを強制する。
alter table public.lives
  add constraint lives_official_sequence_consistency_check
  check (
    (live_mode = 'test' and official_sequence_number is null)
    or (live_mode = 'official' and official_sequence_number is not null)
  );

-- official_sequence_numberに一意制約（NULLは対象外の部分UNIQUE INDEX）。
create unique index lives_official_sequence_number_key
  on public.lives (official_sequence_number)
  where official_sequence_number is not null;

-- テストライブの結果をSNSへ公開できないことをDB制約レベルでも強制する
-- （RLS側は後段4)で追加で二重に絞るが、こちらは「そもそも管理画面から
-- results_published=trueへ更新すること自体」を拒否する最後の砦）。
alter table public.lives
  add constraint lives_results_published_official_only_check
  check (not (results_published and live_mode = 'test'));

-- ============================================================
-- 3) 本番ライブ専用の採番カウンター。
-- ============================================================
-- nextval()方式（シーケンスオブジェクト）だと、採番自体はトランザクションの
-- ロールバックの影響を受けない（＝関数呼び出し全体が失敗しても番号だけ進んで
-- しまう）ため、あえて使わない。単一行のテーブルをfor update相当の行ロック付き
-- UPDATEで直接インクリメントすることで、「作成処理全体が失敗した場合は
-- カウンターの増分も含めて丸ごとロールバックされる」ことを保証する。
create table public.official_live_counter (
  id boolean primary key default true,
  last_value int not null default 0,
  constraint official_live_counter_singleton check (id)
);

insert into public.official_live_counter (id, last_value) values (true, 0);

alter table public.official_live_counter enable row level security;

-- RLSだけに頼らず、テーブル権限自体も最小化する（Supabaseはデフォルトで新規
-- テーブルにanon/authenticatedへのselect/insert/update/deleteを自動付与するため、
-- それを前提にしない。0063 answering_cuesと同じ考え方）。この値は
-- create_live_preparation内のSECURITY DEFINER処理からのみ読み書きされ、
-- クライアントが直接読み書きする必要は無い（採番結果はlives.official_sequence_number
-- として返る）ため、select権限すら付与しない。
revoke all on table public.official_live_counter from public, anon, authenticated;

-- ============================================================
-- 4) create_live_preparation：ライブ種別パラメータを追加する。
-- ============================================================
-- 現行本体は0055（584〜658行目）にあり、advisory lock・お題数検証・重複チェック・
-- 「進行中のライブは常に1件」チェックは全てそのまま維持する。パラメータの個数
-- （引数の型シグネチャ）が変わるため、CREATE OR REPLACEでは既存の5引数版を
-- 置き換えられない（別オーバーロードとして共存してしまい、5引数のままの
-- 既存呼び出し・既存テスト（0063/0064/0065/0066）がlive_mode非対応の古い方の
-- 関数を呼び続けてしまう）。先に5引数版を明示的にdropしてから、6引数版
-- （p_live_modeにdefault 'test'を持たせ、5引数呼び出しにも後方互換）を作る。
drop function if exists public.create_live_preparation(timestamptz, text, int, int, uuid[]);

create or replace function public.create_live_preparation(
  p_scheduled_at timestamptz,
  p_title text,
  p_max_players int,
  p_planned_group_count int,
  p_topic_bank_ids uuid[],
  p_live_mode text default 'test'
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
  v_official_seq int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  if p_live_mode not in ('test', 'official') then
    return query select false, 'ライブ種別が不正です', null::uuid;
    return;
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

  -- (a) この関数の実行自体を直列化する（0055から変更なし）。
  perform pg_advisory_xact_lock(hashtext('create_live_preparation'));

  select id into v_existing_id from public.lives where current_phase <> 'closed' limit 1;
  if v_existing_id is not null then
    return query select false, '既に進行中のライブがあります', v_existing_id;
    return;
  end if;

  -- 0068追加：本番ライブの開催番号は、動作確認用のtest実行に一切消費されない
  -- 専用カウンター(official_live_counter、常に1行だけの単一行テーブル)から
  -- 採番する。行ロック(for update相当のUPDATE)＋インクリメントを、この関数と
  -- 同じトランザクション内で行う。この関数が後段（お題insert等）で失敗して
  -- 例外を投げれば、直前のこの更新も含めて丸ごとロールバックされるため、
  -- 「作成処理全体が失敗した場合に本番番号だけ進む」ことは無い
  -- （nextval()方式だとシーケンス自体はロールバックの対象外になるため、
  -- あえて使わない）。
  if p_live_mode = 'official' then
    update public.official_live_counter
      set last_value = last_value + 1
      where id = true
      returning last_value into v_official_seq;
  else
    v_official_seq := null;
  end if;

  insert into public.lives (
    scheduled_at, current_phase, title, description, max_players,
    planned_group_count, reception_starts_at, reception_ends_at, created_by,
    live_mode, official_sequence_number
  ) values (
    p_scheduled_at, 'scheduled', p_title, null, p_max_players,
    p_planned_group_count, null, null, auth.uid(),
    p_live_mode, v_official_seq
  )
  returning id into v_live_id;

  insert into public.topics (live_id, body, format, topic_bank_id)
  select v_live_id, tb.body, tb.format, tb.id
  from public.topic_bank tb
  where tb.id = any(p_topic_bank_ids);
  get diagnostics v_inserted_topics = row_count;

  if v_inserted_topics <> v_needed_topics then
    -- 例外を投げてこの関数呼び出し全体（lives作成・official_live_counterの
    -- 加算を含む）をロールバックする。
    raise exception 'お題の登録に失敗しました（一部のお題が見つかりません）';
  end if;

  return query select true, null::text, v_live_id;
end;
$$;

grant execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text) to authenticated;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text) from public;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text) from anon;

-- ============================================================
-- 5) close_live：live_mode='test'ならapply_live_rank_rewardsを一切呼ばない。
-- ============================================================
-- 現行本体は0051（95〜128行目、0053はgrant/revokeのみでbody再定義なし）。
-- 既存の「lives更新→（例外を握りつぶさない形で）apply_live_rank_rewards呼び出し」
-- という構成、二重終了時の挙動（v_closed=falseでも引き続き報酬付与を試みる、
-- 0051以来の既存挙動）は維持する。テストライブの場合だけ、報酬付与関数を
-- 一切呼ばずに rewards_applied=true, rewards_error=null を返す
-- （フロント側の「ポイント付与失敗」警告・再試行ボタンの分岐に一切
-- 引っかからないようにするため）。lives.rank_rewards_appliedというDB列自体は
-- 「実際に加算処理が完了したか」という意味を保つため、テストライブでは
-- 更新しない（false のまま）。管理画面側は live_mode='official' の場合だけ
-- この列を見て警告を出すようにする（フロント側の変更で対応）。
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
  v_live_mode text;
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

  select l.live_mode into v_live_mode from public.lives l where l.id = p_live_id;

  if v_live_mode = 'test' then
    -- 0068追加：テストライブは段位・累計ポイント・ポイント残高・参加回数・
    -- 1〜3位実績・point_history記録を一切行わない。apply_live_rank_rewards
    -- 自体を呼ばない（多層防御としてapply_live_rank_rewards側にも同じ
    -- ガードを入れているが、ここでは呼び出し自体を省略する）。
    v_rewards_applied := true;
    v_rewards_error := null;
  else
    begin
      perform public.apply_live_rank_rewards(p_live_id);
      select l.rank_rewards_applied into v_rewards_applied from public.lives l where l.id = p_live_id;
    exception when others then
      v_rewards_error := sqlerrm;
      v_rewards_applied := false;
    end;
  end if;

  return query select v_closed, v_rewards_applied, v_rewards_error;
end;
$$;

grant execute on function public.close_live(uuid) to authenticated;

-- ============================================================
-- 6) retry_live_rank_rewards：同じ多層防御をこちらにも入れる。
-- ============================================================
-- 現行本体は0051（132〜155行目）。通常のUIからは、管理画面の「段位・
-- ポイントの付与に失敗しています」カード自体をlive_mode==='official'の
-- 場合だけ表示するようにする（フロント側の変更）ため、この分岐が実際の
-- UIから呼ばれることは無い想定だが、直接RPCを叩かれた場合の多層防御として
-- 追加する。
create or replace function public.retry_live_rank_rewards(p_live_id uuid)
returns table (rewards_applied boolean, rewards_error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rewards_applied boolean := false;
  v_rewards_error text := null;
  v_live_mode text;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select live_mode into v_live_mode from public.lives where id = p_live_id;
  if v_live_mode = 'test' then
    return query select true, null::text;
    return;
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
-- 7) apply_live_rank_rewards：冒頭でlive_modeを確認する多層防御を追加する。
-- ============================================================
-- 現行本体は0056（52〜128行目、0056より後に本体を再定義しているファイルは
-- 無いことをgrepで確認済み）。既存の対象範囲（role='player'全員、kicked_at・
-- 組の有効性は見ない）・同点処理(rank())・二重付与防止(rank_rewards_applied)・
-- ホスト権限確認は全てそのまま維持する。live_mode='test'の場合は「何もせず
-- 正常終了」（rank_rewards_appliedはfalseのまま＝一切加算していないという
-- 意味を正しく保つ。management UIはlive_mode==='official'の場合だけこの列を
-- 見るようにする）。
-- 2026-XX（0068）：point_historyのラベルに使う開催回数の表示を、レガシーの
-- lives.sequence_number（test/official問わず増え続ける内部カウンター）から
-- lives.official_sequence_number（本番だけの#0001始まりの番号）に変更する。
-- このコード経路はlive_mode='test'なら上のガードで既に抜けているため、
-- ここに到達する時点でofficial_sequence_numberは必ずnot nullである
-- （lives_official_sequence_consistency_check制約により保証される）。
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
    -- 0068追加：多層防御。close_live側で既にapply_live_rank_rewards自体を
    -- 呼ばないようにしているが、直接このRPCを叩かれた場合に備え、
    -- テストライブでは何もせず正常終了する（rank_rewards_appliedは
    -- falseのまま＝実際には加算していない、という意味を保つ）。
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

grant execute on function public.apply_live_rank_rewards(uuid) to authenticated;
revoke execute on function public.apply_live_rank_rewards(uuid) from public;
revoke execute on function public.apply_live_rank_rewards(uuid) from anon;

-- ============================================================
-- 8) set_sns_live_result_manager_best：テストライブでは運営ベストを設定できない
--    ようにする（+50ポイント・実績・通知の付与経路がapply_live_rank_rewardsとは
--    完全に別系統のため、個別にガードする）。
-- ============================================================
-- 現行本体は0038（9〜64行目、0062はgrant/revokeのみでbody再定義なし）。
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

grant execute on function public.set_sns_live_result_manager_best(uuid, uuid) to authenticated;
revoke execute on function public.set_sns_live_result_manager_best(uuid, uuid) from public;
revoke execute on function public.set_sns_live_result_manager_best(uuid, uuid) from anon;

-- ============================================================
-- 9) 寄合帳（SNS）側のRLSポリシーに live_mode='official' 条件を追加する。
-- ============================================================
-- lives_results_published_official_only_check（上記2)）により、そもそも
-- live_mode='test'の行はresults_published=trueになり得ないため、以下は
-- 実害としては起こり得ないケースへの多層防御（DB制約が万一将来変わっても
-- RLS側で独立して安全であるようにする）。対象は「マイグレーション履歴上
-- 最新の」本体（sns_live_results_select等4つは0031から変更なし、
-- topics_select_revealed_or_host・answers_select_own_revealed_host_or_publishedは
-- 0063が最新）。

drop policy if exists "sns_live_results_select" on public.sns_live_results;
create policy "sns_live_results_select" on public.sns_live_results for select
  using (
    is_host()
    or exists (
      select 1 from public.lives l
      where l.id = live_id and l.results_published and l.live_mode = 'official'
    )
  );

drop policy if exists "sns_live_result_answers_select" on public.sns_live_result_answers;
create policy "sns_live_result_answers_select" on public.sns_live_result_answers for select
  using (
    is_host()
    or (
      included
      and exists (
        select 1 from public.sns_live_results r
        join public.lives l on l.id = r.live_id
        where r.id = live_result_id and l.results_published and l.live_mode = 'official'
      )
    )
  );

drop policy if exists "sns_live_result_likes_insert_own" on public.sns_live_result_likes;
create policy "sns_live_result_likes_insert_own" on public.sns_live_result_likes for insert
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
    and exists (
      select 1 from public.sns_live_result_answers ra
      join public.sns_live_results r on r.id = ra.live_result_id
      join public.lives l on l.id = r.live_id
      where ra.id = result_answer_id and ra.included and l.results_published and l.live_mode = 'official'
    )
  );

drop policy if exists "sns_live_result_comments_select" on public.sns_live_result_comments;
create policy "sns_live_result_comments_select" on public.sns_live_result_comments for select
  using (
    is_host()
    or (
      not is_hidden
      and exists (
        select 1 from public.sns_live_result_answers ra
        join public.sns_live_results r on r.id = ra.live_result_id
        join public.lives l on l.id = r.live_id
        where ra.id = result_answer_id and ra.included and l.results_published and l.live_mode = 'official'
      )
    )
  );

drop policy if exists "sns_live_result_comments_insert_own" on public.sns_live_result_comments;
create policy "sns_live_result_comments_insert_own" on public.sns_live_result_comments for insert
  with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
    and exists (
      select 1 from public.sns_live_result_answers ra
      join public.sns_live_results r on r.id = ra.live_result_id
      join public.lives l on l.id = r.live_id
      where ra.id = result_answer_id and ra.included and l.results_published and l.live_mode = 'official'
    )
  );

drop policy if exists "topics_select_revealed_or_host" on public.topics;
create policy "topics_select_revealed_or_host"
  on public.topics for select
  using (
    is_host()
    or exists (
      select 1
      from public.turns t
      join public.lives l on l.id = t.live_id
      join public.participants p on p.live_id = l.id and p.user_id = auth.uid()
      where t.topic_id = topics.id
        and t.live_id = topics.live_id
        and p.kicked_at is null
        and (
          (t.status = 'active' and t.id = l.current_turn_id)
          or t.status = 'done'
        )
    )
    or exists (
      select 1
      from public.answers a
      join public.turns t2 on t2.id = a.turn_id
      join public.sns_live_result_answers sra on sra.answer_id = a.id
      join public.sns_live_results r on r.id = sra.live_result_id
      join public.lives l2 on l2.id = r.live_id
      where t2.topic_id = topics.id
        and sra.included
        and l2.results_published
        and l2.live_mode = 'official'
        and t2.live_id = r.live_id
        and topics.live_id = r.live_id
    )
  );

drop policy if exists "answers_select_own_revealed_host_or_published" on public.answers;
create policy "answers_select_own_revealed_host_or_published"
  on public.answers for select
  using (
    is_host()
    or exists (
      select 1
      from public.sns_live_result_answers sra
      join public.sns_live_results r on r.id = sra.live_result_id
      join public.lives l on l.id = r.live_id
      join public.turns t on t.id = answers.turn_id
      where sra.answer_id = answers.id
        and sra.included
        and l.results_published
        and l.live_mode = 'official'
        and r.live_id = answers.live_id
        and t.live_id = r.live_id
    )
    or exists (
      select 1 from public.participants p
      where p.live_id = answers.live_id
        and p.user_id = auth.uid()
        and p.kicked_at is null
        and (p.id = answers.participant_id or answers.revealed_at is not null)
    )
  );

commit;
