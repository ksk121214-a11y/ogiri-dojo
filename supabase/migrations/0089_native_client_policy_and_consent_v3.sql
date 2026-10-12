-- 0089：純正アプリ（iOS）向けのクライアント方針配信RPCと、userIdもDB側で照合する
-- 同意記録RPC v3を追加する（フェーズ1E-S「純正アプリ用サーバー前提整備」）。
--
-- 本ファイルに含めるのは次の3点のみ。既存のテーブル・関数・データは一切変更しない
-- （record_terms_consent()・record_terms_consent_v2(text, text)・
-- current_legal_document_versions()・terms_consents・ブラウザ版の同意処理はそのまま。
-- ブラウザ版は引き続きv2を使い、v3は純正アプリ用の追加契約）。
--   (1) public.client_policy_config（1行固定の方針設定テーブル。クライアントからの
--       直接アクセスは全面禁止し、読み取りは(2)のRPCだけに限定する）
--   (2) public.get_client_policy_v1()（anon/authenticatedが呼べる方針配信RPC）
--   (3) public.record_terms_consent_v3(uuid, text, text)（authenticated専用）
--
-- 法務文書の版（利用規約・プライバシーポリシー）は(1)へ重複保存せず、(2)・(3)とも
-- 必ずpublic.current_legal_document_versions()から取得する（版の正は従来どおり1箇所）。
--
-- 権限についての注意：0087のpublic schema関数EXECUTE一括収束処理は、0087時点の
-- anon許可リスト（is_host/sns_author_names/sns_result_participant_user_ids）を
-- ハードコードしている。0087は適用済みの履歴マイグレーションのため編集・追記せず、
-- 本ファイルより後に0087を手動で再実行する運用も前提にしない（再実行すると
-- get_client_policy_v1のanon EXECUTEが剥がれる。supabase/tests/
-- run_0087_drift_repro_test.sh参照）。

begin;

-- ============================================================
-- (1) 方針設定テーブル
-- ============================================================
-- iOSのアプリ版はmajor・minor・patchを非負整数の別列で持ち、最低対応版≦推奨版を
-- 行値比較のCHECK制約で保証する（"0.10.0" < "0.9.0" のような文字列の辞書順比較を
-- 避けるため）。URLは列ごとに、許可ホスト（ogiri-dojo.vercel.app）・HTTPS・固定パスの
-- 完全一致だけを許す（userinfo・query・fragment・別ホスト・別パスは制約で拒否される）。
create table public.client_policy_config (
  id smallint primary key default 1,
  policy_schema_version integer not null,
  consent_protocol_version integer not null,
  ios_min_supported_major integer not null,
  ios_min_supported_minor integer not null,
  ios_min_supported_patch integer not null,
  ios_recommended_major integer not null,
  ios_recommended_minor integer not null,
  ios_recommended_patch integer not null,
  terms_url text not null,
  privacy_url text not null,
  contact_url text not null,
  account_deletion_request_url text not null,
  updated_at timestamptz not null default now(),

  constraint client_policy_config_singleton check (id = 1),
  constraint client_policy_config_policy_schema_version check (policy_schema_version = 1),
  constraint client_policy_config_consent_protocol_version check (consent_protocol_version = 3),
  constraint client_policy_config_ios_versions_nonnegative check (
    ios_min_supported_major >= 0 and ios_min_supported_minor >= 0 and ios_min_supported_patch >= 0
    and ios_recommended_major >= 0 and ios_recommended_minor >= 0 and ios_recommended_patch >= 0
  ),
  constraint client_policy_config_ios_min_le_recommended check (
    row(ios_min_supported_major, ios_min_supported_minor, ios_min_supported_patch)
      <= row(ios_recommended_major, ios_recommended_minor, ios_recommended_patch)
  ),
  constraint client_policy_config_terms_url check (terms_url = 'https://ogiri-dojo.vercel.app/terms'),
  constraint client_policy_config_privacy_url check (privacy_url = 'https://ogiri-dojo.vercel.app/privacy'),
  constraint client_policy_config_contact_url check (contact_url = 'https://ogiri-dojo.vercel.app/contact'),
  constraint client_policy_config_account_deletion_request_url check (
    account_deletion_request_url = 'https://ogiri-dojo.vercel.app/account-deletion'
  )
);

comment on table public.client_policy_config is
  '純正アプリ向けクライアント方針（1行固定）。クライアントからの直接アクセスは禁止し、public.get_client_policy_v1()経由でのみ読む。法務文書の版はここに持たず、current_legal_document_versions()を正とする。';

insert into public.client_policy_config (
  id,
  policy_schema_version,
  consent_protocol_version,
  ios_min_supported_major, ios_min_supported_minor, ios_min_supported_patch,
  ios_recommended_major, ios_recommended_minor, ios_recommended_patch,
  terms_url,
  privacy_url,
  contact_url,
  account_deletion_request_url
) values (
  1,
  1,
  3,
  0, 1, 0,
  0, 1, 0,
  'https://ogiri-dojo.vercel.app/terms',
  'https://ogiri-dojo.vercel.app/privacy',
  'https://ogiri-dojo.vercel.app/contact',
  'https://ogiri-dojo.vercel.app/account-deletion'
);

-- RLSを有効化し、ポリシーは作らない（＝RLS対象ロールからは常に0行）。加えて、
-- default privileges等で付与され得るテーブル権限をクライアントロールから明示的に剥がす。
alter table public.client_policy_config enable row level security;
revoke all on table public.client_policy_config from public;
revoke all on table public.client_policy_config from anon;
revoke all on table public.client_policy_config from authenticated;

-- ============================================================
-- (2) 方針配信RPC
-- ============================================================
-- 設定行が0件・複数・値の欠落・形式不正、または法務版が取得できない場合は、
-- 部分的な値を返さず固定コードPOLICY_UNAVAILABLEだけで失敗する（設定値・内部情報は
-- エラーへ連結しない）。書き込み・副作用・時刻依存の値（updated_at等）は含めない。
create or replace function public.get_client_policy_v1()
returns table (
  policy_schema_version integer,
  terms_version text,
  privacy_version text,
  consent_protocol_version integer,
  ios_min_supported_version text,
  ios_recommended_version text,
  terms_url text,
  privacy_url text,
  contact_url text,
  account_deletion_request_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_cfg public.client_policy_config%rowtype;
  v_legal_count bigint;
  v_terms text;
  v_privacy text;
begin
  begin
    select count(*) into v_count from public.client_policy_config;
    if v_count is distinct from 1::bigint then
      raise exception 'POLICY_UNAVAILABLE';
    end if;

    select c.* into strict v_cfg from public.client_policy_config c where c.id = 1;

    select count(*) into v_legal_count from public.current_legal_document_versions();
    if v_legal_count is distinct from 1::bigint then
      raise exception 'POLICY_UNAVAILABLE';
    end if;
    select l.terms_version, l.privacy_version into v_terms, v_privacy
      from public.current_legal_document_versions() l;

    -- テーブル制約と同じ条件をここでも確認する（制約が将来誤って外れた場合や、
    -- 法務版関数が空・NULLを返した場合にも、不正な値を配信しない多層防御）。
    if v_cfg.policy_schema_version is distinct from 1
       or v_cfg.consent_protocol_version is distinct from 3
       or v_cfg.ios_min_supported_major is null or v_cfg.ios_min_supported_major < 0
       or v_cfg.ios_min_supported_minor is null or v_cfg.ios_min_supported_minor < 0
       or v_cfg.ios_min_supported_patch is null or v_cfg.ios_min_supported_patch < 0
       or v_cfg.ios_recommended_major is null or v_cfg.ios_recommended_major < 0
       or v_cfg.ios_recommended_minor is null or v_cfg.ios_recommended_minor < 0
       or v_cfg.ios_recommended_patch is null or v_cfg.ios_recommended_patch < 0
       or row(v_cfg.ios_min_supported_major, v_cfg.ios_min_supported_minor, v_cfg.ios_min_supported_patch)
          > row(v_cfg.ios_recommended_major, v_cfg.ios_recommended_minor, v_cfg.ios_recommended_patch)
       or v_cfg.terms_url is distinct from 'https://ogiri-dojo.vercel.app/terms'
       or v_cfg.privacy_url is distinct from 'https://ogiri-dojo.vercel.app/privacy'
       or v_cfg.contact_url is distinct from 'https://ogiri-dojo.vercel.app/contact'
       or v_cfg.account_deletion_request_url is distinct from 'https://ogiri-dojo.vercel.app/account-deletion'
       or v_terms is null or v_terms = ''
       or v_privacy is null or v_privacy = '' then
      raise exception 'POLICY_UNAVAILABLE';
    end if;
  exception
    when others then
      -- 0件・複数行（INTO STRICT）・関数呼び出し失敗等、原因を問わず同じ固定コードに
      -- そろえ、元のエラーメッセージ（設定値を含み得る）は外へ出さない。
      raise exception 'POLICY_UNAVAILABLE';
  end;

  return query select
    v_cfg.policy_schema_version,
    v_terms,
    v_privacy,
    v_cfg.consent_protocol_version,
    format('%s.%s.%s', v_cfg.ios_min_supported_major, v_cfg.ios_min_supported_minor, v_cfg.ios_min_supported_patch),
    format('%s.%s.%s', v_cfg.ios_recommended_major, v_cfg.ios_recommended_minor, v_cfg.ios_recommended_patch),
    v_cfg.terms_url,
    v_cfg.privacy_url,
    v_cfg.contact_url,
    v_cfg.account_deletion_request_url;
end;
$$;

revoke execute on function public.get_client_policy_v1() from public;
grant execute on function public.get_client_policy_v1() to anon;
grant execute on function public.get_client_policy_v1() to authenticated;

-- ============================================================
-- (3) 同意記録RPC v3
-- ============================================================
-- v2の照合（期待版とDB現在版の完全一致）に加え、クライアントが「この利用者として
-- 同意する」と主張したuserIdが、実際の認証セッション（auth.uid()）と一致することも
-- DB側で照合する（端末上でのアカウント切替等で、別の利用者として同意が記録される
-- 取り違えを防ぐ）。記録に使う値は、クライアント引数ではなくauth.uid()とDBから
-- 取得した現在版だけ。エラーには固定コードのみを使い、userId・版の値は含めない。
create or replace function public.record_terms_consent_v3(
  p_expected_user_id uuid,
  p_expected_terms_version text,
  p_expected_privacy_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_legal_count bigint;
  v_current_terms text;
  v_current_privacy text;
begin
  if v_uid is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  if p_expected_user_id is null or p_expected_user_id is distinct from v_uid then
    raise exception 'USER_MISMATCH';
  end if;

  if p_expected_terms_version is null or p_expected_terms_version = ''
     or p_expected_privacy_version is null or p_expected_privacy_version = '' then
    raise exception 'VERSION_MISMATCH';
  end if;

  -- 法務版は「ちょうど1行」の場合だけ採用する（get_client_policy_v1と同じ条件）。
  -- 件数と値を1回の問い合わせで取得し、0行・複数行の異常状態で先頭行だけを
  -- 採用してしまうことを防ぐ（件数が1のときのmin()はその1行の値そのもの）。
  select count(*), min(l.terms_version), min(l.privacy_version)
    into v_legal_count, v_current_terms, v_current_privacy
    from public.current_legal_document_versions() l;

  if v_legal_count is distinct from 1::bigint
     or v_current_terms is null or v_current_terms = ''
     or v_current_privacy is null or v_current_privacy = ''
     or v_current_terms is distinct from p_expected_terms_version
     or v_current_privacy is distinct from p_expected_privacy_version then
    raise exception 'VERSION_MISMATCH';
  end if;

  insert into public.terms_consents (user_id, terms_version, privacy_version)
  values (v_uid, v_current_terms, v_current_privacy)
  on conflict (user_id, terms_version, privacy_version) do nothing;
end;
$$;

revoke execute on function public.record_terms_consent_v3(uuid, text, text) from public;
revoke execute on function public.record_terms_consent_v3(uuid, text, text) from anon;
grant execute on function public.record_terms_consent_v3(uuid, text, text) to authenticated;

commit;
