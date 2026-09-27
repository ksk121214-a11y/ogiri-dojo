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
  email text,
  -- 0070（ゲスト参加）：実際のSupabaseのauth.usersに実在する列。Supabaseの匿名
  -- サインイン(signInAnonymously)で作られる行はtrueになる。テストでは
  -- `insert into auth.users (id, is_anonymous) values (..., true)` で模す。
  is_anonymous boolean not null default false,
  -- 0081（称号・初回ライブ限定特典）：実際のSupabaseのauth.usersに実在する列。
  -- signInWithOAuth({provider:"x"})でのXログインは{"provider":"x","providers":["x"]}、
  -- signInWithPassword（ボット）は{"provider":"email",...}、signInAnonymously（ゲスト）は
  -- {"provider":"anonymous",...}になる（GoTrueの標準挙動）。テストでは
  -- `insert into auth.users (id, raw_app_meta_data) values (..., '{"provider":"x"}')` で模す。
  raw_app_meta_data jsonb not null default '{}'::jsonb
);

-- 0081追加（Xプロバイダ判定の多層化）：実際のSupabaseのauth.identitiesに実在する
-- テーブル（1ユーザーが複数プロバイダのアイデンティティを持ちうる）。Xログインなら
-- provider='x'の行が入る（GoTrueの標準挙動）。テストでは
-- `insert into auth.identities (user_id, provider) values (..., 'x')` で模す。
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  identity_data jsonb not null default '{}'::jsonb,
  provider_id text not null default ''
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
