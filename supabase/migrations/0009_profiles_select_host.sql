-- 司会コンソールで参加者の表示名を出すため、is_hostなら全profilesを読めるようにする。
-- 一般参加者は引き続き自分の行しか読めない(profiles_select_own, 0002)。
create policy "profiles_select_host"
  on public.profiles for select
  using (is_host());
