-- 初回ライブ実開催前レビュー対応（5）：
-- ツッコミ/拍手はこれまでSupabase Realtimeの生のBroadcast（固定チャンネル名
-- "follower-tsukkomi"）で送受信しており、Realtime Authorization（private channel + RLS）
-- を設定していなかったため、チャンネル名さえ分かればサーバー側の検証を一切経由せず
-- 任意のliveId・kind・textを送信できた（送信間隔もブラウザ内の変数でしか制限していない）。
--
-- 対応方針：Broadcastの認可設定（realtime.messagesへのRLS）を新たに組むより、
-- このプロジェクトで既に4箇所（lives/participants/answers/scores）で実績のある
-- 「テーブルへのINSERT＋postgres_changes購読」パターンに寄せる方が、検証済みの
-- 仕組みの上に安全に積み増せる。送信は新設のsecurity definer RPC経由のみとし、
-- 参加登録・レート制限・kind/textの許可リストをすべてDB側で強制する。

-- ============================================================
-- 1) ツッコミ/拍手イベントの保存先テーブル
-- ============================================================
create table public.live_tsukkomi_events (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  kind text not null check (kind in ('clap', 'stamp')),
  text text not null,
  created_at timestamptz not null default now()
);

create index live_tsukkomi_events_live_id_idx on public.live_tsukkomi_events (live_id, created_at);

alter table public.live_tsukkomi_events enable row level security;

-- 閲覧はそのライブの参加者（player/audience問わず）と運営のみ。演出用の一過性データだが、
-- 誰でも読めるBroadcastより「そのライブに実際に入室した人だけ」に絞れて元の設計より厳しくなる。
create policy "live_tsukkomi_events_select_participant_or_host"
  on public.live_tsukkomi_events for select
  using (
    is_host()
    or exists (
      select 1 from public.participants p
      where p.live_id = live_tsukkomi_events.live_id and p.user_id = auth.uid()
    )
  );

-- 直接INSERTは禁止（RPC経由のみ）。ポリシーを作らないことで新規行の直接作成を拒否する。

-- レート制限用に、参加者ごとの最終送信時刻を持たせる。
alter table public.participants
  add column if not exists last_tsukkomi_at timestamptz;

-- ============================================================
-- 2) 送信RPC：ログイン済み・そのライブの参加者・許可されたkind/textの組み合わせのみ、
--    かつ1人1秒に1回まで（ブラウザ側のクールダウンと同じ1000msをDB側でも強制）。
-- ============================================================
create function public.send_tsukkomi(p_live_id uuid, p_kind text, p_text text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_participant_id uuid;
  v_last timestamptz;
begin
  -- kind/textの組み合わせは、実際に画面のボタンから送られる定型文と完全一致させる
  -- （src/data/liveDemoData.ts の TSUKKOMI_TEMPLATES ＋ AudienceAnsweringView.tsx の
  -- 「爆笑」「👏」）。自由入力は一切許可しない。
  if (p_kind, p_text) not in (
    ('stamp', 'なんでやねん'),
    ('stamp', 'そうはならんやろ'),
    ('stamp', 'ちょっと待って'),
    ('stamp', 'それは無理あるて'),
    ('stamp', '爆笑'),
    ('clap', '👏')
  ) then
    raise exception 'INVALID_TSUKKOMI';
  end if;

  select p.id, p.last_tsukkomi_at into v_participant_id, v_last
    from public.participants p
    where p.live_id = p_live_id and p.user_id = auth.uid()
    for update;

  if v_participant_id is null then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  if v_last is not null and now() - v_last < interval '1 second' then
    raise exception 'RATE_LIMITED';
  end if;

  update public.participants set last_tsukkomi_at = now() where id = v_participant_id;

  insert into public.live_tsukkomi_events (live_id, participant_id, kind, text)
    values (p_live_id, v_participant_id, p_kind, p_text);
end;
$$;

grant execute on function public.send_tsukkomi(uuid, text, text) to authenticated;

-- postgres_changes購読でクライアントに届くよう、Realtime配信対象に追加する（0007と同様）。
alter publication supabase_realtime add table public.live_tsukkomi_events;
