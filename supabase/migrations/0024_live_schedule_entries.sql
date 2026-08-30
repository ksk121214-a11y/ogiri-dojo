-- 運営者専用管理画面：「ライブ予定」の手動管理化。
-- 実際にゲームが進行するlivesテーブルとは完全に切り離した、表示専用の予定データ。
-- 1件の予定を「準備中/前回/今回/次回/ホームの次回ライブ」のどこに表示するかを
-- display_roleで管理する（'preparing'以外は同時に1件だけしか割り当てられない）。

create table public.live_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  start_time time not null,
  reception_time time not null,
  ticket_no text not null,
  display_role text not null default 'preparing'
    check (display_role in ('preparing', 'previous', 'current', 'upcoming', 'home_upcoming')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

-- 各表示先は同時に1件だけ（'preparing'は複数件あってよい：まだどこにも出さない予定を
-- 一覧に置いておくための状態のため）。
create unique index live_schedule_entries_role_unique
  on public.live_schedule_entries (display_role)
  where display_role <> 'preparing';

alter table public.live_schedule_entries enable row level security;

create policy "live_schedule_entries_select_all"
  on public.live_schedule_entries for select
  using (true);

create policy "live_schedule_entries_write_host"
  on public.live_schedule_entries for all
  using (is_host())
  with check (is_host());

-- 表示先の切り替えをアトミックに行うRPC。先に既存の同ロール保持者をpreparingへ戻して
-- から対象行を新ロールにすることで、UI側で2回updateする場合に起き得る一意制約違反を防ぐ。
create or replace function public.set_live_schedule_role(p_entry_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_host() then
    raise exception 'FORBIDDEN';
  end if;
  if p_role not in ('preparing', 'previous', 'current', 'upcoming', 'home_upcoming') then
    raise exception 'INVALID_ROLE';
  end if;

  if p_role <> 'preparing' then
    update public.live_schedule_entries
      set display_role = 'preparing', updated_at = now()
      where display_role = p_role and id <> p_entry_id;
  end if;

  update public.live_schedule_entries
    set display_role = p_role, updated_at = now()
    where id = p_entry_id;
end;
$$;

grant execute on function public.set_live_schedule_role(uuid, text) to authenticated;
