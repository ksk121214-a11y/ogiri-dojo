-- 運営者専用管理画面の追加（第1段階）。
-- 運営操作履歴（誰が・いつ・何を・何に対して・なぜ行ったか）を記録するテーブル。
-- 一覧表示UIは第3段階で作るが、記録自体は第1段階の各操作から行う。
create table public.admin_action_logs (
  id uuid primary key default gen_random_uuid(),
  -- 操作した運営者が後日アカウント削除されても、履歴自体は残す。
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_action_logs enable row level security;

create policy "admin_action_logs_all_host"
  on public.admin_action_logs for all
  using (is_host())
  with check (is_host());
