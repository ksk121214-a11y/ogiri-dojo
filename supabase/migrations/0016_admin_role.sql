-- 運営者専用管理画面の追加（第1段階）。
-- 権限モデルをboolean(is_host)からrole列(text)に寄せる。将来「スタッフ」等の
-- 権限区分を増やす時にcheck制約へ値を足すだけで拡張できるようにするため。
-- is_host列自体は後方互換のため残すが、以後の判定はrole列を正とする。
alter table public.profiles
  add column role text not null default 'user' check (role in ('user', 'admin'));

-- 既存のis_host=trueユーザーをそのままadminへ移行する。
update public.profiles set role = 'admin' where is_host = true;

-- is_host()のシグネチャ・呼び出し側（既存の全RLSポリシー）は変えず、
-- 中身だけrole列ベースの判定に差し替える。
create or replace function public.is_host()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;
