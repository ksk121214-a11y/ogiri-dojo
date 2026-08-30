-- 運営者専用管理画面の追加（第3段階）。
-- ユーザー管理：警告・期限付き利用停止・永久停止・解除の記録と、
-- それを実際に機能させるための列（profiles.suspended_until / is_permanently_suspended）。
-- BAN/利用停止による制限はSNS投稿系のみに適用し、ライブ参加・回答・採点には
-- 適用しない（進行中のゲームプレイへの影響を避けるため、0021のinsertポリシーで
-- 既に参照している）。
alter table public.profiles
  add column suspended_until timestamptz,
  add column is_permanently_suspended boolean not null default false,
  add column admin_memo text;

-- 運営者が他ユーザーのroleや停止状態・運営メモを更新できるようにする。
-- 0003で本人の自己更新可能列を絞ったのと同じ考え方で、運営者にだけ
-- 追加の列への書き込みを許可し、行のUSING/CHECKはis_host()に限定する。
grant update (role, suspended_until, is_permanently_suspended, admin_memo)
  on public.profiles to authenticated;

create policy "profiles_update_host"
  on public.profiles for update
  using (is_host())
  with check (is_host());

-- user_idはon delete cascade（対象ユーザー削除時、この制裁履歴も一緒に消えてよい。
-- 「アカウント削除した」という事実自体はadmin_action_logsに別途残る）。
-- created_byは操作した運営者が後日削除されてもset null。
create table public.user_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('warning', 'suspend_temporary', 'suspend_permanent', 'lift', 'delete')),
  reason text not null,
  detail text,
  target_ref text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.user_sanctions enable row level security;

create policy "user_sanctions_all_host"
  on public.user_sanctions for all
  using (is_host())
  with check (is_host());

-- 警告等をアプリ内通知として表示するための最小限のテーブル。
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null default 'warning',
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "notifications_update_own_read"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notifications_insert_host"
  on public.notifications for insert
  with check (is_host());

-- 0021で作った基本形のinsertポリシーを、ここで初めて存在するようになった
-- is_permanently_suspended/suspended_until列を使った制限つきに差し替える
-- （利用停止中のアカウントはSNS投稿できないようにする。ライブ参加・回答・
-- 採点には適用しない）。
drop policy "sns_topics_insert_own" on public.sns_topics;
create policy "sns_topics_insert_own" on public.sns_topics for insert
  with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
  );

drop policy "sns_answers_insert_own" on public.sns_answers;
create policy "sns_answers_insert_own" on public.sns_answers for insert
  with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
  );

drop policy "sns_comments_insert_own" on public.sns_comments;
create policy "sns_comments_insert_own" on public.sns_comments for insert
  with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
  );
