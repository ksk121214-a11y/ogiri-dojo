-- 「ゲームが始まってからでもプレイヤーとして入場登録できてしまう」不具合対策。
-- お題発表(topic_reveal)以降は新規のプレイヤー参加登録を受け付けず、観客としてのみ
-- 参加できるようにする（幕間・受付中(interlude/opening)は従来どおりプレイヤー参加可）。
-- 既存のjoin_live RPC（0018_join_live_rpc.sql）にフェーズ確認を追加するのみで、
-- 呼び出し方・戻り値の型は変更しない。

create or replace function public.join_live(p_live_id uuid, p_preferred_role text)
returns public.participants
language plpgsql
security definer set search_path = public
as $$
declare
  v_max int;
  v_count int;
  v_phase text;
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
