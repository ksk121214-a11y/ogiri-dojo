-- 集客施策の効果測定のための最小限の計測を仕込む（グロース部指摘：Xシェアボタンが
-- 何回押されたか、参加者がどこでライブを知ったかが今まで一切分からなかった）。
-- 新機能ではなく裏側の記録のみで、ユーザーの体験自体は変えない。

-- ============================================================
-- 1) Xシェアボタンのクリック計測
-- ============================================================
create table public.share_click_events (
  id uuid primary key default gen_random_uuid(),
  -- どのシェアボタンか（"live_schedule"=事前告知／"live_result"=事後ハイライト／
  -- "final_result"=個人の結果シェア）。
  context text not null,
  -- ログイン中なら記録、未ログインでの閲覧・クリックもあり得るためnull許容。
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.share_click_events enable row level security;

-- クリックの記録自体は誰でも（未ログインでも）できてよい。中身を読めるのは運営のみ。
create policy "share_click_events_insert_any"
  on public.share_click_events for insert
  with check (true);

create policy "share_click_events_select_host"
  on public.share_click_events for select
  using (is_host());

grant insert on public.share_click_events to authenticated, anon;
grant select on public.share_click_events to authenticated;

-- ============================================================
-- 2) 参加登録時の流入元（自己申告、任意）
-- ============================================================
alter table public.participants
  add column if not exists referral_source text;

-- 引数の数が変わる（2引数→3引数）ため、create or replaceでは別オーバーロードとして
-- 追加されてしまい既存の2引数版が残り続ける。混乱を避けるため明示的に先に削除する。
drop function if exists public.join_live(uuid, text);

create function public.join_live(p_live_id uuid, p_preferred_role text, p_referral_source text default null)
returns public.participants
language plpgsql
security definer set search_path = public
as $$
declare
  v_max int;
  v_count int;
  v_phase text;
  v_kicked timestamptz;
  v_suspended boolean;
  v_row public.participants;
begin
  if p_preferred_role not in ('player', 'audience') then
    raise exception 'INVALID_ROLE';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  select max_players, current_phase into v_max, v_phase
    from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;

  select kicked_at into v_kicked
    from public.participants
    where live_id = p_live_id and user_id = auth.uid();
  if v_kicked is not null then
    raise exception 'PARTICIPANT_KICKED';
  end if;

  if p_preferred_role = 'player' and v_phase not in ('interlude', 'opening') then
    raise exception 'PLAYER_JOIN_CLOSED';
  end if;

  if v_max is not null and p_preferred_role = 'player' then
    select count(*) into v_count
      from public.participants
      where live_id = p_live_id and preferred_role = 'player';
    if v_count >= v_max then
      raise exception 'PLAYER_LIMIT_REACHED';
    end if;
  end if;

  insert into public.participants (live_id, user_id, preferred_role, referral_source)
  values (p_live_id, auth.uid(), p_preferred_role, p_referral_source)
  on conflict (live_id, user_id) do update
    set preferred_role = excluded.preferred_role,
        -- 既に流入元が記録済みなら上書きしない（再度role変更で呼ばれた時に消さない）。
        referral_source = coalesce(public.participants.referral_source, excluded.referral_source)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.join_live(uuid, text, text) to authenticated;
