-- 本番リハに向けた実バックエンド接続（フェーズA）。
-- 司会役（is_host）が進行を管理し、回答者本人が自分のanswers行を投稿する設計にするための
-- 土台となる列を追加する。詳細な設計判断は /Users/keisuke/.claude/plans/typed-popping-cerf.md 参照。

-- 司会役フラグ。手動でSupabaseダッシュボードのTable Editorから該当ユーザーの行に
-- true を設定する想定（アプリからは変更不可。0006で書き込みポリシーを絞る）。
alter table public.profiles
  add column is_host boolean not null default false;

-- lives: フェーズ進行をクライアント間で同期するための情報。
-- phase_deadline: 現在のフェーズが終わる予定時刻（nullは「タイマー無し・司会の操作待ち」等）。
-- answering_paused: 回答受付中に審査サイクルへ入って一時停止しているか。
-- answering_remaining_ms: 一時停止した瞬間の残り時間のスナップショット
--   （再開時にphase_deadlineを計算し直すための元データ。司会クライアントの再読込からの
--   復帰にも使う）。
alter table public.lives
  add column phase_deadline timestamptz,
  add column answering_paused boolean not null default false,
  add column answering_remaining_ms int;

-- answers: 「投稿」と「表示（審査対象として見せる）」を分離するための列。
-- live_id: turnsからの非正規化（Realtimeのlive_id=eq.<id>フィルタで使うため）。
--   クライアントからは指定させず、トリガーで必ずturns.live_idから補完する。
-- revealed_at: nullなら「投稿済みだがまだ審査カードに出していない（司会のキュー待ち）」。
-- judging_ends_at: revealed_atと同時にセットする、その回答の審査締切時刻。
-- resolved: 採点が確定済みか。
alter table public.answers
  add column live_id uuid references public.lives (id) on delete cascade,
  add column revealed_at timestamptz,
  add column judging_ends_at timestamptz,
  add column resolved boolean not null default false;

create index answers_live_id_idx on public.answers (live_id);

-- 1ターンにつき「表示中(revealed_at is not null)かつ未確定(resolved=false)」の回答は
-- 最大1件であることをDBレベルで保証する。司会の二重タブ操作等があってもUPDATEが
-- 失敗するだけで済み、審査カードが2件同時に表示される事故を構造的に防ぐ。
create unique index answers_one_active_per_turn
  on public.answers (turn_id)
  where revealed_at is not null and resolved = false;

-- live_idはクライアントに任せず、必ずturnsから補完する。
create function public.set_answer_live_id()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  select t.live_id into new.live_id
  from public.turns t
  where t.id = new.turn_id;
  return new;
end;
$$;

create trigger set_answer_live_id_trigger
  before insert on public.answers
  for each row execute function public.set_answer_live_id();
