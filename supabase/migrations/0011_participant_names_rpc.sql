-- 組結果・最終結果の画面では、誰でも「同じライブの他の参加者の表示名」を
-- 見られる必要がある。しかしprofilesのSELECTはauth.uid()=idのみに絞ってある
-- (0002: x_username等の個人情報を誰でも読めてしまう穴を塞いだ経緯があるため)。
-- 生のprofilesへのSELECT範囲を緩めるのではなく、表示名だけを返す
-- security definer関数を用意し、これ経由でのみ他人の表示名を解決できるようにする。
create function public.participant_display_names(p_live_id uuid)
returns table (participant_id uuid, display_name text)
language sql
security definer
set search_path = public
as $$
  select p.id, pr.display_name
  from public.participants p
  join public.profiles pr on pr.id = p.user_id
  where p.live_id = p_live_id;
$$;

grant execute on function public.participant_display_names(uuid) to authenticated;
