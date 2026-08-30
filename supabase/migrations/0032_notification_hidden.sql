-- お知らせ配信（notifications, type='announcement'）を運営が後から非公開にできるようにする。
-- 1回の配信は全ユーザーぶんの行として保存されており(0023)、これまでは
-- notifications_update_own_read（本人のみ、既読フラグ用）しか更新ポリシーが無く、
-- 運営が他ユーザーの行をまとめて更新する手段が無かった。
alter table public.notifications add column if not exists is_hidden boolean not null default false;

drop policy if exists "notifications_update_host" on public.notifications;
create policy "notifications_update_host" on public.notifications for update
  using (is_host())
  with check (is_host());
