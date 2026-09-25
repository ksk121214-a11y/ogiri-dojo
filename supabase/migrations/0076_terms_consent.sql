-- 利用規約・プライバシーポリシーへの明示同意を記録する専用テーブル＋RPC。
--
-- 背景：これまで同意は「続行することで同意したものとみなす」という受動的な
-- 表明（LegalConsentNote）のみで、DBへの記録もバージョン管理も無かった。
-- 今回、Xログイン・ゲスト参加の直前に明示チェックを求め（フロント側は
-- src/store/useConsentGateStore.ts）、認証完了後にこのテーブルへ記録する。
--
-- 設計方針（このリポジトリの既存パターンを踏襲）：
-- - 履歴を残すため、上書きUPDATEではなくINSERTのみ（同意し直すたびに1行増える）。
-- - 一般ロールへの直接INSERT/UPDATE/DELETEは一切grantせず、明示的にrevokeする
--   （Supabase標準構成ではanon/authenticatedへテーブル全体のSELECT/INSERT/
--   UPDATE/DELETEが自動付与されるため、RLSにポリシーが無いだけで暗黙に防ぐの
--   ではなく、明示的にrevokeして「テーブルへの書き込みはrecord_terms_consent()
--   経由のみ」を保証する）。
-- - 読み取りはRLSの「本人のみselect」で十分なため、専用の読み取りRPCは設けない。
-- - authenticatedロールには、Xログインの本会員だけでなく匿名サインイン
--   （signInAnonymously）のゲストも含まれる（0070参照）。ゲストも同意記録の
--   対象にするため、grantはauthenticatedのみで足りる。
--
-- 2026-09-25（本番未適用のため0076自体を再監査対応で修正。0077は作らない）：
-- 【問題】record_terms_consent(text, text)はクライアントから任意のバージョン
-- 文字列を渡せてしまい、同じ内容を何度でも記録できた（監査記録として不適切）。
-- 【対応】
-- - (user_id, terms_version, privacy_version)に一意制約を設け、同じバージョンの
--   再記録はon conflict do nothingで冪等にする。
-- - record_terms_consent()を引数なしにし、current_legal_document_versions()
--   （このマイグレーション内で定義、DB側の唯一の正）から現在のバージョンを
--   取得して記録する。クライアントは一切バージョン文字列を指定できない。
-- - フロントエンドのsrc/lib/legalInfo.ts（TERMS_VERSION/PRIVACY_VERSION）と
--   current_legal_document_versions()の戻り値は、規約改定のたびに必ず同じ値へ
--   同時に更新すること（src/lib/__tests__/legalPagesWiring.check.tsが両者の
--   一致を検査する）。

begin;

create table public.terms_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  consented_at timestamptz not null default now(),
  unique (user_id, terms_version, privacy_version)
);

create index terms_consents_user_id_consented_at_idx
  on public.terms_consents (user_id, consented_at desc);

alter table public.terms_consents enable row level security;

create policy "terms_consents_select_own" on public.terms_consents for select
  using (auth.uid() = user_id);

-- 一般ロールへのINSERT/UPDATE/DELETEは明示的にrevokeする（テーブル自体への
-- 書き込みはsecurity definer関数のみが行う）。
revoke insert, update, delete on public.terms_consents from anon, authenticated;

-- 現在の利用規約・プライバシーポリシーのバージョン（DB側の唯一の正）。
-- record_terms_consent()がこれを参照する。規約改定時は、この関数の戻り値と
-- src/lib/legalInfo.ts のTERMS_VERSION/PRIVACY_VERSIONを必ず同時に更新すること。
create function public.current_legal_document_versions()
returns table (terms_version text, privacy_version text)
language sql
stable
as $$
  select '2026-09-25-v1'::text, '2026-09-25-v1'::text;
$$;

create function public.record_terms_consent()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_terms_version text;
  v_privacy_version text;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select terms_version, privacy_version into v_terms_version, v_privacy_version
    from public.current_legal_document_versions();

  insert into public.terms_consents (user_id, terms_version, privacy_version)
    values (auth.uid(), v_terms_version, v_privacy_version)
  on conflict (user_id, terms_version, privacy_version) do nothing;
end;
$$;

revoke execute on function public.record_terms_consent() from public;
revoke execute on function public.record_terms_consent() from anon;
grant execute on function public.record_terms_consent() to authenticated;

commit;
