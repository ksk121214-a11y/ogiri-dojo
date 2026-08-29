-- 「ライブ中、自分のアイコンが他の参加者の画面ではランダムなアイコンになる」対応。
--
-- 根本原因：アイコンの絵柄・色（useUserStore.avatarIcon/avatarColor）はこの
-- ブラウザのlocalStorageにしか保存されておらず、Supabase側（他の参加者から
-- 見える場所）には一切保存されていなかった。そのため他の参加者の画面では、
-- participant_idから決定的に割り当てるハッシュベースの代替絵柄・色
-- （src/lib/participantAvatar.ts）で表示するしかなく、本人がマイページで
-- 選んだものとは無関係な見た目になっていた。
--
-- 本人が選んだ絵柄・色をprofilesに保存し、participant_display_names経由で
-- 他の参加者にも公開する（表示名と同じ扱い）。

alter table public.profiles
  add column avatar_icon text not null default 'default',
  add column avatar_color text not null default '#c8320c';

-- 0003で本人の自己更新可能列を display_name, display_name_set のみに絞ったため、
-- avatar_icon/avatar_colorもここに追加しないと本人からも更新できない。
grant update (display_name, display_name_set, avatar_icon, avatar_color)
  on public.profiles to authenticated;

-- 0011のparticipant_display_namesを拡張し、表示名と同じくavatar_icon/avatar_colorも
-- 返すようにする（戻り値の型が変わるためdrop&createが必要）。
drop function if exists public.participant_display_names(uuid);

create function public.participant_display_names(p_live_id uuid)
returns table (participant_id uuid, display_name text, avatar_icon text, avatar_color text)
language sql
security definer
set search_path = public
as $$
  select p.id, pr.display_name, pr.avatar_icon, pr.avatar_color
  from public.participants p
  join public.profiles pr on pr.id = p.user_id
  where p.live_id = p_live_id;
$$;

grant execute on function public.participant_display_names(uuid) to authenticated;
