-- ローカルPostgreSQL 16で、Supabaseの実行環境を最小限だけ再現するシム。
-- 本番のSupabaseプロジェクトそのものではないが、実際のPostgreSQLエンジン上で
-- supabase/migrations/*.sqlをそのまま再生し、RLS・GRANT・関数を実際に呼び出して
-- 検証するためのもの（supabase/tests/run.shから使う）。
--
-- 用意するもの：
--   - auth スキーマ・auth.users（Supabase Authが管理する実テーブルの最小限の形）
--   - anon / authenticated / service_role ロール
--   - auth.uid()：セッションローカルのGUC(myapp.uid)を読む。テストごとに
--     `select set_config('myapp.uid', '<uuid>', true);` して「誰として呼ぶか」を
--     切り替える（未設定/nullはSQL EditorやpostgresロールからのSupabase呼び出しを
--     模す）。
--   - anon/authenticatedへの標準権限：Supabaseは新規プロジェクト作成時、
--     schema public への USAGE と、以後作成される全テーブルへの
--     SELECT/INSERT/UPDATE/DELETEをこの2ロールへ自動的に付与する
--     （ALTER DEFAULT PRIVILEGESで将来のテーブルにも適用され続ける）。これは
--     このリポジトリのmigrationsには一切現れない、Supabase側が最初から
--     用意する土台のため、ここで明示的に再現する。RLSと列GRANT/REVOKEだけが
--     実質的な防波堤という設計を正しく検証するために必須。

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  email text
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $$;

create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('myapp.uid', true), '')::uuid $$;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
