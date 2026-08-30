-- 運営者専用管理画面の追加（第1段階）。
-- 最大参加人数(lives.max_players)を安全に守るため、参加登録を直接INSERTから
-- security definer RPCへ一本化する。
--
-- 「同時に複数人が参加ボタンを押しても最大人数を超えない」ためには、
-- RLSのwith checkだけ（各トランザクションが独立にcountを見る）では
-- レースコンディションを防げない。ここではlivesの対象行をfor updateで
-- ロックしてから数えることで、同時押しを直列化する。
--
-- 「再接続した同じプレイヤーを別の参加者として二重登録しない」は、
-- 既存の一意制約 participants(live_id, user_id)（0001）を使い、
-- on conflict...do updateで対応する（既存行があれば新規行を作らず
-- preferred_roleだけ更新して返す）。
create or replace function public.join_live(p_live_id uuid, p_preferred_role text)
returns public.participants
language plpgsql
security definer set search_path = public
as $$
declare
  v_max int;
  v_count int;
  v_row public.participants;
begin
  if p_preferred_role not in ('player', 'audience') then
    raise exception 'INVALID_ROLE';
  end if;

  select max_players into v_max from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
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

-- 直接INSERTの経路をふさぎ、上限チェックを必ず通るRPC経由に一本化する。
-- 0010で定義した"participants_insert_self"ポリシーはGRANTが無くなることで
-- 実質無効化される（ポリシー自体は残しても実害が無いため削除はしない）。
revoke insert on public.participants from authenticated;
grant execute on function public.join_live(uuid, text) to authenticated;
