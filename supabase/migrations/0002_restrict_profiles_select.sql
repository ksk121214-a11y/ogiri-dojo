-- profilesのSELECTを本人限定に変更。
-- 現状のアプリコードはuseProfileStore.tsで自分自身のプロフィール（auth.uid() = id）しか
-- 参照しておらず、他ユーザーのdisplay_name/x_username等を公開する必要が今のところ無いため、
-- using (true)（誰でも全行SELECT可）だったポリシーを、本人のみSELECT可に絞る。
-- これによりx_username（Xアカウント名）がanonキー経由で誰でも読める状態を解消する。
--
-- 将来、他ユーザーのdisplay_name/avatar_urlをランキング等で公開表示する必要が出てきたら、
-- x_usernameを含まない公開用のビュー（例: profiles_public）を別途作り、そちらだけを
-- 公開SELECT可にすること。x_username自体は本人以外に公開しない方針を維持する。

drop policy if exists "profiles_select_all" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);
