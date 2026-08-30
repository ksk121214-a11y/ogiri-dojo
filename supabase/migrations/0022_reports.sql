-- 運営者専用管理画面の追加（第3段階）。
-- 通報管理。通報時点の投稿内容をsnapshot_bodyに保存し、後から投稿が編集・削除
-- されても運営者が確認できるようにする。通報数だけで自動非表示・自動削除は行わず、
-- 運営者が内容を見て/admin/postsから個別に判断する。
-- reporter_id/target_author_idはon delete set nullにする。通報した/された本人が
-- 後日アカウント削除されても、通報記録（誰が悪いか判断した運営の記録）自体は残す。
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('sns_topic', 'sns_answer', 'sns_comment')),
  target_id uuid not null,
  target_author_id uuid references public.profiles (id) on delete set null,
  reason text not null,
  detail text,
  snapshot_body text not null,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'no_action')),
  admin_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "reports_insert_own"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

create policy "reports_all_host"
  on public.reports for all
  using (is_host())
  with check (is_host());
