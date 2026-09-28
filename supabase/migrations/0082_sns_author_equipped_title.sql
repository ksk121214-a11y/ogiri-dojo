-- 寄合帳の他ユーザープロフィールに、装備中かつ公開中の称号を表示できるようにする。
--
-- 【対象】0001〜0081は一切書き換えない（0081は本番適用済み）。本ファイルのみ新規追加
-- （begin/commitで1トランザクション、0068・0071・0073・0076〜0079・0081と同じ流儀）。
--
-- 【設計方針】
-- 1) 一般利用者が他人のprofiles/titlesを直接自由に読める権限は一切追加しない。
--    既存どおり、公開情報の取得は必ずSECURITY DEFINER RPC(sns_author_names)経由に
--    統一する。
-- 2) sns_author_names(uuid[])は、0081時点の以下をすべて完全に維持したまま
--    再定義する（列の欠落・順序変更をせず、末尾に新しい列を追加するだけ）。
--    - 既存7列（id, display_name, avatar_icon, avatar_color, mastery_meter, bio,
--      equipped_limited_icon_slug）の型・順序・内容
--    - "and not pr.is_guest"によるゲスト除外
--    - language sql / security definer / set search_path = public
--    - grant execute ... to authenticated, anon / revoke ... from public
--    戻り値の型（列数）を変えるため、0081と同じくdrop function if exists →
--    create functionで再定義する（create or replaceは戻り値の型変更を許可しない）。
--    dropで既存のACLは失われるため、直後に0081と全く同じgrant/revokeを再度行う。
-- 3) 追加する列equipped_title_display_nameは、profiles.equipped_title_slugが
--    指すtitles行をLEFT JOINし、そのtitles.display_name（＝運営が編集した
--    「今の」表示名）をそのまま返す。称号のslug自体は一切返さない
--    （画面には常にdisplay_nameだけを渡す）。
--    - 称号を装備していない（equipped_title_slugがnull）場合はnull。
--    - 装備しているが、その称号が運営によりis_active=false（非公開）にされて
--      いる場合もnull（JOIN条件にt.is_active = trueを含めることで、クライアント
--      側の非表示に頼らずDB側で確実に除外する）。
--    - 通常称号・限定称号のどちらでも同じ扱い（kindによる分岐はしない）。
-- 4) 権限面の変更は一切無い：sns_author_namesの戻り値に列が1つ増えるだけで、
--    profiles/titlesへの直接GRANTやRLSポリシーの追加・変更は行わない。
begin;

drop function if exists public.sns_author_names(uuid[]);

create function public.sns_author_names(p_ids uuid[])
returns table (
  id uuid,
  display_name text,
  avatar_icon text,
  avatar_color text,
  mastery_meter int,
  bio text,
  equipped_limited_icon_slug text,
  equipped_title_display_name text
)
language sql
security definer set search_path = public
as $$
  select
    pr.id,
    pr.display_name,
    pr.avatar_icon,
    pr.avatar_color,
    pr.mastery_meter,
    pr.bio,
    pr.equipped_limited_icon_slug,
    t.display_name as equipped_title_display_name
  from public.profiles pr
  left join public.titles t
    on t.slug = pr.equipped_title_slug
    and t.is_active = true
  where pr.id = any(p_ids)
    and not pr.is_guest;
$$;

grant execute on function public.sns_author_names(uuid[]) to authenticated, anon;
revoke execute on function public.sns_author_names(uuid[]) from public;

commit;
