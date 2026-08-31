-- 段位・ポイント・実績を実データ化する。
-- これまでmasteryMeter(段位進捗)・points(ポイント)・参加回数・表彰回数・
-- ベストアンサー回数はすべてuseUserStore.ts（ブラウザのlocalStorageのみ）で
-- 管理され、実際のライブ（useLiveHostStore.ts）が終了しても一切更新されていなかった。
-- ライブ終了時にこの関数(apply_live_rank_rewards)を呼び、既存のデモ版
-- （src/components/live-demo/FinalResultScreen.tsx）と同じ計算式で実データを加算する。
--
-- ポイントは「累計ポイント(total_points、消費されない・段位実績表示用)」と
-- 「ポイント残高(points_balance、将来ガチャ等で消費されうる)」を分けて持つ。
-- 同じ獲得ポイントを両方に加算し、累計は増える一方、残高は将来消費機能が
-- 実装されれば減っていく、という設計。今回は残高を消費する機能自体は追加しない
-- （ガチャは引き続きuseUserStore側のローカルダミー経済のまま。将来Supabase連携する
-- 際は、この列を減算するsecurity definer関数を別途追加する想定）。
alter table public.profiles
  add column if not exists bio text,
  add column if not exists mastery_meter int not null default 0,
  add column if not exists total_points int not null default 0,
  add column if not exists points_balance int not null default 0,
  add column if not exists live_count int not null default 0,
  add column if not exists award_count_first int not null default 0,
  add column if not exists award_count_second int not null default 0,
  add column if not exists award_count_third int not null default 0,
  add column if not exists best_answer_count int not null default 0;

-- bioは表示名と同じく本人が自由に編集してよい項目。0003/0015と同じ流儀で
-- 自己更新可能な列にだけ明示的にgrantする。
grant update (bio) on public.profiles to authenticated;
-- mastery_meter/total_points/points_balance/live_count/award_count_*/best_answer_countは
-- 意図的にgrantしない（authenticatedロールからの直接updateを一切許さない）。
-- ライブ終了時の加算は下記のsecurity definer関数からのみ行い、本人による
-- 自己ブースト（段位・ポイントの不正操作）を構造的に防ぐ。

-- 二重付与防止用のフラグ。
alter table public.lives add column if not exists rank_rewards_applied boolean not null default false;

-- ポイント獲得履歴（マイページの「ポイント獲得履歴」表示用）。
drop table if exists public.point_history cascade;
create table public.point_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  live_id uuid references public.lives (id) on delete set null,
  points int not null,
  mastery int not null,
  label text not null,
  created_at timestamptz not null default now()
);
alter table public.point_history enable row level security;
create index point_history_user_id_idx on public.point_history (user_id, created_at desc);

create policy "point_history_select_own" on public.point_history for select
  using (auth.uid() = user_id);
-- insertはsecurity definer関数からのみ（authenticatedへのgrantなし）。

-- ライブ終了時に、そのライブの各プレイヤーへ段位・ポイント・実績を加算する。
-- 計算式はsrc/data/collectionData.tsのMASTERY_GAIN/BONUS_BY_RANK/BEST_ANSWER_BONUS_POINTS
-- （デモ版ライブで既に使われているもの）をそのまま移植し、新しい式は作らない。
drop function if exists public.apply_live_rank_rewards(uuid);
create function public.apply_live_rank_rewards(p_live_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
  v_best_participant_id uuid;
begin
  if not is_host() then
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
  )
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
  where pr.id = g.user_id;

  insert into public.point_history (user_id, live_id, points, mastery, label)
  select
    g.user_id, p_live_id, g.points_gain, g.mastery_gain,
    '第' || l.sequence_number || '回ライブ'
      || (case g.rnk when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
      || (case when g.participant_id = v_best_participant_id then '・ベストアンサー' else '' end)
  from gains g, public.lives l
  where l.id = p_live_id;

  update public.lives set rank_rewards_applied = true where id = p_live_id;
end;
$$;

grant execute on function public.apply_live_rank_rewards(uuid) to authenticated;

-- 他ユーザーのプロフィール（寄合帳）で段位・一言コメントを表示できるよう、
-- sns_author_namesの戻り値にmastery_meter/bioを追加する（0021と同じ流儀で再作成）。
drop function if exists public.sns_author_names(uuid[]);
create function public.sns_author_names(p_ids uuid[])
returns table (id uuid, display_name text, avatar_icon text, avatar_color text, mastery_meter int, bio text)
language sql
security definer set search_path = public
as $$
  select pr.id, pr.display_name, pr.avatar_icon, pr.avatar_color, pr.mastery_meter, pr.bio
  from public.profiles pr
  where pr.id = any(p_ids);
$$;

grant execute on function public.sns_author_names(uuid[]) to authenticated, anon;
