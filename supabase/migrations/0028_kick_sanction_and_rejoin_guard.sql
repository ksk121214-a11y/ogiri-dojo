-- 退場機能の仕様変更：
-- 1) 退場をuser_sanctionsに記録できるようにする（typeにkickedを追加）。
--    /admin/users/[id]の「警告・対応履歴」に自動で表示され、件数も見えるようになる。
-- 2) 退場済みの参加者は、観客としても含めそのライブに再入場できないようにする
--    （join_live RPCで拒否する。次のライブでは新しいparticipants行になるため
--    影響しない＝要件どおり次回からは参加できる）。

alter table public.user_sanctions
  drop constraint if exists user_sanctions_type_check;
alter table public.user_sanctions
  add constraint user_sanctions_type_check
  check (type in ('warning', 'suspend_temporary', 'suspend_permanent', 'lift', 'delete', 'kicked'));

create or replace function public.join_live(p_live_id uuid, p_preferred_role text)
returns public.participants
language plpgsql
security definer set search_path = public
as $$
declare
  v_max int;
  v_count int;
  v_phase text;
  v_kicked timestamptz;
  v_row public.participants;
begin
  if p_preferred_role not in ('player', 'audience') then
    raise exception 'INVALID_ROLE';
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

  insert into public.participants (live_id, user_id, preferred_role)
  values (p_live_id, auth.uid(), p_preferred_role)
  on conflict (live_id, user_id) do update set preferred_role = excluded.preferred_role
  returning * into v_row;

  return v_row;
end;
$$;
