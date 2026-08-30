-- 運営者専用管理画面の追加（第1段階）。
-- ライブ準備・予定管理に必要な列を追加する。
--
-- sequence_number: 「第n回開催」を表す自動連番（#0001形式で表示に使う）。
-- DBのシーケンスで採番するため、同時にライブを作成しても重複しない。
create sequence public.live_sequence_number_seq start 1;

alter table public.lives
  add column sequence_number int not null default nextval('public.live_sequence_number_seq'),
  add column title text,
  add column description text,
  -- プレイヤーの最大参加人数。nullなら無制限（従来どおりの挙動を維持）。
  add column max_players int,
  add column planned_group_count int,
  add column reception_starts_at timestamptz,
  add column reception_ends_at timestamptz,
  -- 結果の一般公開は自動で行わず、運営者が確認してから明示的に切り替える。
  add column results_published boolean not null default false,
  add column ended_at timestamptz,
  -- プレイヤー全員（またはプレイヤー+観客）への運営メッセージ。
  add column announcement_message text,
  add column announcement_scope text check (announcement_scope in ('player', 'all')),
  add column announcement_sent_at timestamptz,
  -- 作成した運営者が後日アカウント削除されても、ライブの記録自体は残す。
  add column created_by uuid references public.profiles (id) on delete set null;

alter table public.lives
  add constraint lives_sequence_number_unique unique (sequence_number);
