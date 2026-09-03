-- 仕様書_v2.md §2.1「一度『見学希望』で登録した人が後から『プレイヤー希望』に
-- 変更することも、上限内であれば可能」に対応するUI変更（OpeningView.tsx）に
-- あわせて、join_live()側の上限判定の不具合を修正する。
--
-- 従来はプレイヤー人数の上限チェックで、呼び出し本人が既にプレイヤーとして
-- 登録済みかどうかを考慮せず「live_id一致・preferred_role='player'」の
-- 行数をそのまま数えていた。ちょうど満員の状態で、既にプレイヤーの本人が
-- （二重クリックや、同じ「プレイヤーとして参加する」を再度押す等で）同じ
-- 役割のまま送信すると、実際には新しくプレイヤーが増えるわけではないのに
-- PLAYER_LIMIT_REACHEDとして拒否されてしまっていた。呼び出し本人自身の
-- 既存行を数から除外する（＝「自分以外に何人プレイヤーがいるか」で判定する）。
create or replace function public.join_live(p_live_id uuid, p_preferred_role text, p_referral_source text default null)
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
      where live_id = p_live_id
        and preferred_role = 'player'
        and user_id <> auth.uid();
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
