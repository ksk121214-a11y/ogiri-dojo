-- 0089 回帰テスト：純正アプリ向けクライアント方針配信RPC（get_client_policy_v1）と、
-- userIdもDB側で照合する同意記録RPC v3（record_terms_consent_v3）、及びその設定テーブル
-- （client_policy_config）の制約・RLS・権限を確認する。既存のrecord_terms_consent_v2・
-- record_terms_consent()・current_legal_document_versions()・terms_consentsの契約が
-- 変わっていないことも確認する。実行方法はsupabase/tests/run.sh参照
-- （0001〜最新のマイグレーションが番号順に全適用された後の最終スキーマ状態に対して実行される）。
--
-- 設定行・制約・関数を一時的に変更するテストは、すべてPL/pgSQLの例外ブロック
-- （サブトランザクション）内で行い、ブロックを例外で抜けることで必ず元の状態へ
-- 巻き戻す（巻き戻ったことも直後に確認する）。

\set ON_ERROR_STOP on

insert into auth.users (id, raw_app_meta_data) values
  ('08900000-0000-0000-0000-00000000a001', '{"provider":"x","providers":["x"]}'), -- X会員相当（旧版で同意済み）
  ('08900000-0000-0000-0000-00000000a003', '{"provider":"x","providers":["x"]}'), -- userId不一致の相手役
  ('08900000-0000-0000-0000-00000000a004', '{"provider":"x","providers":["x"]}'), -- v2の既存動作確認用
  ('08900000-0000-0000-0000-00000000a005', '{"provider":"x","providers":["x"]}')  -- 版不一致の確認用
on conflict do nothing;
insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('08900000-0000-0000-0000-00000000a002', true, '{"provider":"anonymous","providers":["anonymous"]}') -- 匿名ゲスト相当
on conflict do nothing;
update public.profiles set is_guest = true where id = '08900000-0000-0000-0000-00000000a002';

-- 旧版での同意履歴（v3の成功後も削除・更新されないことを確認するため）。
insert into public.terms_consents (user_id, terms_version, privacy_version) values
  ('08900000-0000-0000-0000-00000000a001', '2026-09-28-v2', '2026-09-28-v3');

-- ============================================================
-- 方針1: 設定行はちょうど1件で、初期値が契約どおり。
-- ============================================================
do $$
declare
  v_count bigint;
  r public.client_policy_config%rowtype;
begin
  select count(*) into v_count from public.client_policy_config;
  if v_count <> 1 then
    raise exception 'FAIL: client_policy_configの行数が1ではない(got=%)', v_count;
  end if;
  select * into r from public.client_policy_config;
  if r.id <> 1 or r.policy_schema_version <> 1 or r.consent_protocol_version <> 3
     or (r.ios_min_supported_major, r.ios_min_supported_minor, r.ios_min_supported_patch) <> (0, 1, 0)
     or (r.ios_recommended_major, r.ios_recommended_minor, r.ios_recommended_patch) <> (0, 1, 0) then
    raise exception 'FAIL: client_policy_configの初期値が契約と異なる';
  end if;
  raise notice 'PASS: client_policy_configはちょうど1行で、schema=1・protocol=3・iOS最低/推奨=0.1.0';
end $$;

-- ============================================================
-- 方針2: RPCの属性（引数なし・RETURNS TABLE・STABLE・SECURITY DEFINER・
--        search_path固定）と返却列が契約と完全一致する。
-- ============================================================
do $$
declare
  v_oid oid := 'public.get_client_policy_v1()'::regprocedure;
  p pg_proc%rowtype;
  v_result text;
begin
  select * into p from pg_proc where oid = v_oid;
  if p.pronargs <> 0 then
    raise exception 'FAIL: get_client_policy_v1が引数を取る';
  end if;
  if not p.proretset then
    raise exception 'FAIL: get_client_policy_v1がRETURNS TABLE（集合返却）ではない';
  end if;
  if p.provolatile <> 's' then
    raise exception 'FAIL: get_client_policy_v1がSTABLEではない(provolatile=%)', p.provolatile;
  end if;
  if not p.prosecdef then
    raise exception 'FAIL: get_client_policy_v1がSECURITY DEFINERではない';
  end if;
  if p.proconfig is distinct from array['search_path=""'] then
    raise exception 'FAIL: get_client_policy_v1のsearch_pathが空文字固定ではない(got=%)', p.proconfig;
  end if;

  v_result := pg_get_function_result(v_oid);
  if v_result <> 'TABLE(policy_schema_version integer, terms_version text, privacy_version text, '
                 'consent_protocol_version integer, ios_min_supported_version text, ios_recommended_version text, '
                 'terms_url text, privacy_url text, contact_url text, account_deletion_request_url text)' then
    raise exception 'FAIL: get_client_policy_v1の返却列が契約と一致しない(got=%)', v_result;
  end if;
  raise notice 'PASS: get_client_policy_v1は引数なし・RETURNS TABLE・STABLE・SECURITY DEFINER・search_path=''''で、返却列が契約と完全一致';
end $$;

-- ============================================================
-- 方針3: RPCはちょうど1行を返し、値が契約どおり（法務版は現在版（0090）と一致、
--        最低版≦推奨版、URL4つは期待するHTTPS絶対URL）。
-- ============================================================
do $$
declare
  v_rows bigint;
  r record;
  v_cur_terms text;
  v_cur_privacy text;
begin
  select count(*) into v_rows from public.get_client_policy_v1();
  if v_rows <> 1 then
    raise exception 'FAIL: get_client_policy_v1が1行を返さない(got=%)', v_rows;
  end if;

  select * into r from public.get_client_policy_v1();
  select terms_version, privacy_version into v_cur_terms, v_cur_privacy
    from public.current_legal_document_versions();

  if r.policy_schema_version <> 1 then
    raise exception 'FAIL: policy_schema_versionが1ではない';
  end if;
  if r.consent_protocol_version <> 3 then
    raise exception 'FAIL: consent_protocol_versionが3ではない';
  end if;
  if r.ios_min_supported_version <> '0.1.0' or r.ios_recommended_version <> '0.1.0' then
    raise exception 'FAIL: iOS最低版・推奨版が0.1.0ではない(min=%, rec=%)', r.ios_min_supported_version, r.ios_recommended_version;
  end if;
  if string_to_array(r.ios_min_supported_version, '.')::int[] > string_to_array(r.ios_recommended_version, '.')::int[] then
    raise exception 'FAIL: 最低版が推奨版より大きい';
  end if;
  -- 現在版（0090で更新。src/lib/legalInfo.tsのTERMS_VERSION/PRIVACY_VERSIONと同じ値）。
  if r.terms_version <> '2026-10-14-v4' or r.privacy_version <> '2026-10-14-v5' then
    raise exception 'FAIL: 法務版が現在版（0090）と一致しない(terms=%, privacy=%)', r.terms_version, r.privacy_version;
  end if;
  if r.terms_version is distinct from v_cur_terms or r.privacy_version is distinct from v_cur_privacy then
    raise exception 'FAIL: 法務版がcurrent_legal_document_versions()と一致しない';
  end if;
  if r.terms_url <> 'https://ogiri-dojo.vercel.app/terms'
     or r.privacy_url <> 'https://ogiri-dojo.vercel.app/privacy'
     or r.contact_url <> 'https://ogiri-dojo.vercel.app/contact'
     or r.account_deletion_request_url <> 'https://ogiri-dojo.vercel.app/account-deletion' then
    raise exception 'FAIL: URLが期待値と一致しない';
  end if;
  raise notice 'PASS: get_client_policy_v1はちょうど1行を返し、法務版（0090現在版）・iOS版・URL4つがすべて契約どおり';
end $$;

-- ============================================================
-- 方針4: 権限。anon・authenticatedはRPCを実行でき、publicは実行権限を持たない。
-- ============================================================
do $$
begin
  if has_function_privilege('public', 'public.get_client_policy_v1()', 'EXECUTE') then
    raise exception 'FAIL: publicがget_client_policy_v1を実行できる';
  end if;
  if not has_function_privilege('anon', 'public.get_client_policy_v1()', 'EXECUTE') then
    raise exception 'FAIL: anonがget_client_policy_v1を実行できない';
  end if;
  if not has_function_privilege('authenticated', 'public.get_client_policy_v1()', 'EXECUTE') then
    raise exception 'FAIL: authenticatedがget_client_policy_v1を実行できない';
  end if;
end $$;

do $$
declare
  v_rows bigint;
begin
  set local role anon;
  perform set_config('myapp.uid', '', true);
  select count(*) into v_rows from public.get_client_policy_v1();
  if v_rows <> 1 then
    raise exception 'FAIL: anonとして呼んだget_client_policy_v1が1行を返さない';
  end if;
  set local role authenticated;
  perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a001', true);
  select count(*) into v_rows from public.get_client_policy_v1();
  if v_rows <> 1 then
    raise exception 'FAIL: authenticatedとして呼んだget_client_policy_v1が1行を返さない';
  end if;
  raise notice 'PASS: anon・authenticatedは実際にget_client_policy_v1を呼べ、publicは実行権限を持たない';
end $$;
reset role;

-- ============================================================
-- 方針5: 設定テーブルへの直接アクセスはクライアントロールから全面禁止。
--        RLSは有効で、ポリシーは存在しない。
-- ============================================================
do $$
declare
  v_role text;
  v_priv text;
  v_policy_count bigint;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.client_policy_config'::regclass) then
    raise exception 'FAIL: client_policy_configのRLSが有効ではない';
  end if;
  select count(*) into v_policy_count from pg_policies
    where schemaname = 'public' and tablename = 'client_policy_config';
  if v_policy_count <> 0 then
    raise exception 'FAIL: client_policy_configにポリシーが存在する(%件)', v_policy_count;
  end if;
  foreach v_role in array array['public', 'anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, 'public.client_policy_config', v_priv) then
        raise exception 'FAIL: %がclient_policy_configの%権限を持っている', v_role, v_priv;
      end if;
    end loop;
  end loop;
  raise notice 'PASS: client_policy_configはRLS有効・ポリシー0件で、public/anon/authenticatedはテーブル権限を一切持たない';
end $$;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_role);
    perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a001', true);

    begin
      perform 1 from public.client_policy_config;
      raise exception 'FAIL: %がclient_policy_configを直接SELECTできてしまった', v_role;
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.client_policy_config (id, policy_schema_version, consent_protocol_version,
        ios_min_supported_major, ios_min_supported_minor, ios_min_supported_patch,
        ios_recommended_major, ios_recommended_minor, ios_recommended_patch,
        terms_url, privacy_url, contact_url, account_deletion_request_url)
      values (1, 1, 3, 0, 1, 0, 0, 1, 0,
        'https://ogiri-dojo.vercel.app/terms', 'https://ogiri-dojo.vercel.app/privacy',
        'https://ogiri-dojo.vercel.app/contact', 'https://ogiri-dojo.vercel.app/account-deletion');
      raise exception 'FAIL: %がclient_policy_configへ直接INSERTできてしまった', v_role;
    exception when insufficient_privilege then null;
    end;
    begin
      update public.client_policy_config set ios_min_supported_major = 9;
      raise exception 'FAIL: %がclient_policy_configを直接UPDATEできてしまった', v_role;
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.client_policy_config;
      raise exception 'FAIL: %がclient_policy_configを直接DELETEできてしまった', v_role;
    exception when insufficient_privilege then null;
    end;

    reset role;
  end loop;
  raise notice 'PASS: anon・authenticatedはclient_policy_configを直接SELECT/INSERT/UPDATE/DELETEできない';
end $$;
reset role;

-- ============================================================
-- 方針6: テーブル制約。固定ID以外・2行目・NULL・負数・最低版>推奨版・
--        HTTPS以外・別ホスト・別パス・userinfo・query・fragmentをすべて拒否する。
--        （各試行はサブトランザクション内で行い、失敗＝巻き戻しになる）
-- ============================================================
do $$
declare
  v_stmt text;
  v_stmts text[] := array[
    -- 固定ID以外・2行目
    $s$insert into public.client_policy_config (id, policy_schema_version, consent_protocol_version,
       ios_min_supported_major, ios_min_supported_minor, ios_min_supported_patch,
       ios_recommended_major, ios_recommended_minor, ios_recommended_patch,
       terms_url, privacy_url, contact_url, account_deletion_request_url)
       values (2, 1, 3, 0, 1, 0, 0, 1, 0,
       'https://ogiri-dojo.vercel.app/terms', 'https://ogiri-dojo.vercel.app/privacy',
       'https://ogiri-dojo.vercel.app/contact', 'https://ogiri-dojo.vercel.app/account-deletion')$s$,
    $s$insert into public.client_policy_config (id, policy_schema_version, consent_protocol_version,
       ios_min_supported_major, ios_min_supported_minor, ios_min_supported_patch,
       ios_recommended_major, ios_recommended_minor, ios_recommended_patch,
       terms_url, privacy_url, contact_url, account_deletion_request_url)
       values (1, 1, 3, 0, 1, 0, 0, 1, 0,
       'https://ogiri-dojo.vercel.app/terms', 'https://ogiri-dojo.vercel.app/privacy',
       'https://ogiri-dojo.vercel.app/contact', 'https://ogiri-dojo.vercel.app/account-deletion')$s$,
    $s$update public.client_policy_config set id = 2$s$,
    -- スキーマ版・同意プロトコル版
    $s$update public.client_policy_config set policy_schema_version = 2$s$,
    $s$update public.client_policy_config set consent_protocol_version = 2$s$,
    -- NULL
    $s$update public.client_policy_config set policy_schema_version = null$s$,
    $s$update public.client_policy_config set ios_min_supported_minor = null$s$,
    $s$update public.client_policy_config set terms_url = null$s$,
    $s$update public.client_policy_config set updated_at = null$s$,
    -- 空文字
    $s$update public.client_policy_config set contact_url = ''$s$,
    -- 負数
    $s$update public.client_policy_config set ios_min_supported_patch = -1$s$,
    $s$update public.client_policy_config set ios_recommended_major = -1$s$,
    -- 最低版>推奨版（文字列の辞書順なら誤判定する 0.10.0 > 0.9.0 も含む）
    $s$update public.client_policy_config set ios_min_supported_major = 0, ios_min_supported_minor = 2, ios_min_supported_patch = 0$s$,
    $s$update public.client_policy_config set ios_min_supported_minor = 10, ios_recommended_minor = 9$s$,
    -- URL：HTTP・別ホスト・ホスト偽装・別パス・userinfo・query・fragment・末尾スラッシュ・相対
    $s$update public.client_policy_config set terms_url = 'http://ogiri-dojo.vercel.app/terms'$s$,
    $s$update public.client_policy_config set terms_url = 'https://example.com/terms'$s$,
    $s$update public.client_policy_config set terms_url = 'https://ogiri-dojo.vercel.app.example.com/terms'$s$,
    $s$update public.client_policy_config set privacy_url = 'https://ogiri-dojo.vercel.app/terms'$s$,
    $s$update public.client_policy_config set contact_url = 'https://user:pass@ogiri-dojo.vercel.app/contact'$s$,
    $s$update public.client_policy_config set contact_url = 'https://ogiri-dojo.vercel.app/contact?x=1'$s$,
    $s$update public.client_policy_config set account_deletion_request_url = 'https://ogiri-dojo.vercel.app/account-deletion#top'$s$,
    $s$update public.client_policy_config set account_deletion_request_url = 'https://ogiri-dojo.vercel.app/account-deletion/'$s$,
    $s$update public.client_policy_config set privacy_url = '/privacy'$s$
  ];
begin
  foreach v_stmt in array v_stmts loop
    begin
      execute v_stmt;
      raise exception 'FAIL: 制約違反のはずの操作が成功した: %', v_stmt;
    exception
      when check_violation or not_null_violation or unique_violation then null;
    end;
  end loop;
  raise notice 'PASS: client_policy_configの制約は、固定ID以外・2行目・NULL・空文字・負数・最低版>推奨版・不正URL（%件）をすべて拒否する', array_length(v_stmts, 1);
end $$;

-- 正当な更新（最低版≦推奨版の範囲内）は通ること、及び上の試行で値が変わっていないこと。
do $$
declare
  r record;
begin
  begin
    update public.client_policy_config set ios_recommended_minor = 10, ios_min_supported_minor = 9;
    select * into r from public.get_client_policy_v1();
    if r.ios_min_supported_version <> '0.9.0' or r.ios_recommended_version <> '0.10.0' then
      raise exception 'FAIL: 数値比較の正当な更新が反映されない(min=%, rec=%)', r.ios_min_supported_version, r.ios_recommended_version;
    end if;
    raise exception 'ROLLBACK_SENTINEL';
  exception when raise_exception then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;
  end;
  select * into r from public.get_client_policy_v1();
  if r.ios_min_supported_version <> '0.1.0' or r.ios_recommended_version <> '0.1.0' then
    raise exception 'FAIL: テスト用の更新が巻き戻っていない';
  end if;
  raise notice 'PASS: 0.9.0≦0.10.0のような正当な更新は数値比較で受け付けられ（テスト後は0.1.0へ巻き戻し済み）、制約違反の試行は値を変えていない';
end $$;

-- ============================================================
-- 方針7: 設定行の欠落・形式不正・法務版の欠落時は、部分的な値を返さず
--        POLICY_UNAVAILABLEだけで失敗し、設定値・内部情報をエラーへ含めない。
-- ============================================================
do $$
declare
  v_msg text;
  v_detail text;
  v_hint text;
  v_case text;
begin
  foreach v_case in array array['missing_row', 'bad_url', 'bad_version_order', 'empty_legal_version', 'null_legal_version', 'two_legal_rows'] loop
    begin
      if v_case = 'missing_row' then
        delete from public.client_policy_config;
      elsif v_case = 'bad_url' then
        -- 制約が将来誤って外れた場合を模す（RPC側の多層防御の確認）。
        alter table public.client_policy_config drop constraint client_policy_config_terms_url;
        update public.client_policy_config set terms_url = 'https://evil.example/terms?leak=SECRET_CFG_VALUE';
      elsif v_case = 'bad_version_order' then
        alter table public.client_policy_config drop constraint client_policy_config_ios_min_le_recommended;
        update public.client_policy_config set ios_min_supported_major = 7777;
      elsif v_case = 'empty_legal_version' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$ select ''::text, 'SECRET_LEGAL_VALUE'::text $fn$;
      elsif v_case = 'null_legal_version' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$ select 'SECRET_LEGAL_VALUE'::text, null::text $fn$;
      elsif v_case = 'two_legal_rows' then
        -- 先頭行は現在版と完全一致していても、2行ある異常状態では配信しない。
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$
          select '2026-10-14-v4'::text, '2026-10-14-v5'::text
          union all
          select 'SECRET_LEGAL_VALUE'::text, 'SECRET_LEGAL_VALUE'::text
        $fn$;
      end if;

      perform * from public.get_client_policy_v1();
      raise exception 'FAIL: %の状態でget_client_policy_v1が成功してしまった', v_case;
    exception when others then
      get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      if v_msg <> 'POLICY_UNAVAILABLE' then
        raise exception 'FAIL: %の状態でPOLICY_UNAVAILABLE以外のエラー: %', v_case, v_msg;
      end if;
      if coalesce(v_detail, '') <> '' or coalesce(v_hint, '') <> '' then
        raise exception 'FAIL: %の状態でエラーに詳細・ヒントが付いている', v_case;
      end if;
      if position('SECRET' in v_msg) > 0 or position('evil' in v_msg) > 0 or position('7777' in v_msg) > 0
         or position('2026-' in v_msg) > 0 or position('ogiri-dojo' in v_msg) > 0 then
        raise exception 'FAIL: %の状態でエラーに設定値が含まれている', v_case;
      end if;
    end;
  end loop;
  raise notice 'PASS: 設定行欠落・URL不正・版順序不正・法務版の空文字/NULL・法務版2行（先頭一致）では、いずれもPOLICY_UNAVAILABLEのみで失敗し、設定値・法務版の値を含まない';
end $$;

-- 上の破壊的な試行がすべて巻き戻っていること（行・制約・法務版関数）。
do $$
declare
  v_count bigint;
  v_constraints bigint;
  v_terms text;
  v_privacy text;
begin
  select count(*) into v_count from public.client_policy_config;
  select count(*) into v_constraints from pg_constraint
    where conrelid = 'public.client_policy_config'::regclass
      and conname in ('client_policy_config_terms_url', 'client_policy_config_ios_min_le_recommended');
  select terms_version, privacy_version into v_terms, v_privacy from public.current_legal_document_versions();
  if v_count <> 1 or v_constraints <> 2 or v_terms <> '2026-10-14-v4' or v_privacy <> '2026-10-14-v5' then
    raise exception 'FAIL: テスト用の変更が巻き戻っていない(rows=%, constraints=%, terms=%, privacy=%)', v_count, v_constraints, v_terms, v_privacy;
  end if;
  if (select count(*) from public.get_client_policy_v1()) <> 1 then
    raise exception 'FAIL: 巻き戻し後にget_client_policy_v1が1行を返さない';
  end if;
  raise notice 'PASS: 破壊的な試行はすべて巻き戻り、設定行1件・制約・法務版関数・RPCは元どおり';
end $$;

-- ============================================================
-- 同意v3-1: 属性と権限。authenticatedだけが実行でき、anon・publicは実行できない。
-- ============================================================
do $$
declare
  v_oid oid := 'public.record_terms_consent_v3(uuid, text, text)'::regprocedure;
  p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid = v_oid;
  if not p.prosecdef then
    raise exception 'FAIL: record_terms_consent_v3がSECURITY DEFINERではない';
  end if;
  if p.proconfig is distinct from array['search_path=""'] then
    raise exception 'FAIL: record_terms_consent_v3のsearch_pathが空文字固定ではない(got=%)', p.proconfig;
  end if;
  if pg_get_function_identity_arguments(v_oid) <> 'p_expected_user_id uuid, p_expected_terms_version text, p_expected_privacy_version text' then
    raise exception 'FAIL: record_terms_consent_v3の引数が契約と異なる(got=%)', pg_get_function_identity_arguments(v_oid);
  end if;
  if pg_get_function_result(v_oid) <> 'void' then
    raise exception 'FAIL: record_terms_consent_v3の戻り値がvoidではない';
  end if;
  if has_function_privilege('public', v_oid, 'EXECUTE') then
    raise exception 'FAIL: publicがrecord_terms_consent_v3を実行できる';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'FAIL: anonがrecord_terms_consent_v3を実行できる';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'FAIL: authenticatedがrecord_terms_consent_v3を実行できない';
  end if;
  raise notice 'PASS: record_terms_consent_v3はSECURITY DEFINER・search_path=''''・(uuid, text, text)→voidで、authenticatedだけが実行できる';
end $$;

do $$
begin
  set local role anon;
  perform set_config('myapp.uid', '', true);
  begin
    perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a001', '2026-10-14-v4', '2026-10-14-v5');
    raise exception 'FAIL: anonがrecord_terms_consent_v3を実行できてしまった';
  exception when insufficient_privilege then
    raise notice 'PASS: anonはrecord_terms_consent_v3を実際に呼べない（insufficient_privilege）';
  end;
end $$;
reset role;

-- ============================================================
-- 同意v3-2: 未ログイン（authenticatedロールでもauth.uid()がNULL）はNOT_LOGGED_IN。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '', true);
  begin
    perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a001', '2026-10-14-v4', '2026-10-14-v5');
    raise exception 'FAIL: 未ログインでrecord_terms_consent_v3が成功してしまった';
  exception when raise_exception then
    if sqlerrm <> 'NOT_LOGGED_IN' then
      raise exception 'FAIL: 未ログイン時のエラーがNOT_LOGGED_INではない(got=%)', sqlerrm;
    end if;
    raise notice 'PASS: 未ログインはNOT_LOGGED_IN';
  end;
end $$;
reset role;

-- ============================================================
-- 同意v3-3: expected userIdがNULL・別人ならUSER_MISMATCHで、どちらの利用者にも
--           同意行が作られない。エラーにuserIdを含めない。
-- ============================================================
do $$
declare
  v_case uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a005', true);
  foreach v_case in array array[null, '08900000-0000-0000-0000-00000000a003']::uuid[] loop
    begin
      perform public.record_terms_consent_v3(v_case, '2026-10-14-v4', '2026-10-14-v5');
      raise exception 'FAIL: expected userId=%でrecord_terms_consent_v3が成功してしまった', v_case;
    exception when raise_exception then
      if sqlerrm <> 'USER_MISMATCH' then
        raise exception 'FAIL: userId不一致時のエラーがUSER_MISMATCHではない(got=%)', sqlerrm;
      end if;
    end;
  end loop;
end $$;
reset role;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.terms_consents
    where user_id in ('08900000-0000-0000-0000-00000000a005', '08900000-0000-0000-0000-00000000a003');
  if v_count <> 0 then
    raise exception 'FAIL: userId不一致で同意行が作られた(%件)', v_count;
  end if;
  raise notice 'PASS: expected userIdがNULL・別人ならUSER_MISMATCHで、呼び出し元・指定先どちらにも同意行は作られない';
end $$;

-- ============================================================
-- 同意v3-4: 版がNULL・空文字・旧版・片方だけ一致・未来の版ならVERSION_MISMATCHで、
--           同意行は作られない。
-- ============================================================
do $$
declare
  v_terms text;
  v_privacy text;
  v_pairs text[][] := array[
    array[null, '2026-10-14-v5'],
    array['2026-10-14-v4', null],
    array['', '2026-10-14-v5'],
    array['2026-10-14-v4', ''],
    array['2026-09-28-v2', '2026-09-28-v3'],
    array['2026-10-14-v4', '2026-09-28-v3'],
    array['2026-09-28-v2', '2026-10-14-v5'],
    array['2099-01-01-v9', '2099-01-01-v9'],
    array['2026-10-14-v4 ', '2026-10-14-v5']
  ];
  i int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a005', true);
  for i in 1 .. array_length(v_pairs, 1) loop
    v_terms := v_pairs[i][1];
    v_privacy := v_pairs[i][2];
    begin
      perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a005', v_terms, v_privacy);
      raise exception 'FAIL: 版(%,%)でrecord_terms_consent_v3が成功してしまった', v_terms, v_privacy;
    exception when raise_exception then
      if sqlerrm <> 'VERSION_MISMATCH' then
        raise exception 'FAIL: 版(%,%)のエラーがVERSION_MISMATCHではない(got=%)', v_terms, v_privacy, sqlerrm;
      end if;
    end;
  end loop;
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.terms_consents where user_id = '08900000-0000-0000-0000-00000000a005') then
    raise exception 'FAIL: 版不一致で同意行が作られた';
  end if;
  raise notice 'PASS: 版のNULL・空文字・旧版・片方だけ一致・未来版・前後空白付きはすべてVERSION_MISMATCHで、同意行は作られない';
end $$;

-- ============================================================
-- 同意v3-4b: current_legal_document_versions()がちょうど1行でない・値がNULL/空文字の
--            異常状態では、期待版が先頭行と完全一致していてもVERSION_MISMATCHで拒否し、
--            terms_consentsへ1行も追加しない。エラーにuserId・法務版の実値を含めない。
--            法務版関数の置き換えは各ケースのサブトランザクション内だけで行い、
--            ROLLBACK_SENTINELで抜けて必ず元へ戻す。
-- ============================================================
do $$
declare
  v_case text;
  v_msg text;
  v_detail text;
  v_hint text;
  v_user_rows bigint;
  v_total_before bigint;
  v_total_inside bigint;
begin
  select count(*) into v_total_before from public.terms_consents;

  foreach v_case in array array[
    'zero_rows', 'two_rows_first_match', 'two_rows_second_match', 'two_identical_current_rows',
    'null_terms', 'null_privacy', 'empty_terms', 'empty_privacy'
  ] loop
    begin
      if v_case = 'zero_rows' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$ select '2026-10-14-v4'::text, '2026-10-14-v5'::text where false $fn$;
      elsif v_case = 'two_rows_first_match' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$
          select '2026-10-14-v4'::text, '2026-10-14-v5'::text
          union all
          select 'SECRET_LEGAL_A'::text, 'SECRET_LEGAL_B'::text
        $fn$;
      elsif v_case = 'two_rows_second_match' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$
          select 'SECRET_LEGAL_A'::text, 'SECRET_LEGAL_B'::text
          union all
          select '2026-10-14-v4'::text, '2026-10-14-v5'::text
        $fn$;
      elsif v_case = 'two_identical_current_rows' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$
          select '2026-10-14-v4'::text, '2026-10-14-v5'::text
          union all
          select '2026-10-14-v4'::text, '2026-10-14-v5'::text
        $fn$;
      elsif v_case = 'null_terms' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$ select null::text, '2026-10-14-v5'::text $fn$;
      elsif v_case = 'null_privacy' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$ select '2026-10-14-v4'::text, null::text $fn$;
      elsif v_case = 'empty_terms' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$ select ''::text, '2026-10-14-v5'::text $fn$;
      elsif v_case = 'empty_privacy' then
        create or replace function public.current_legal_document_versions()
        returns table (terms_version text, privacy_version text)
        language sql stable as $fn$ select '2026-10-14-v4'::text, ''::text $fn$;
      end if;

      v_msg := null;
      v_detail := null;
      v_hint := null;
      set local role authenticated;
      perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a005', true);
      begin
        perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a005', '2026-10-14-v4', '2026-10-14-v5');
        v_msg := 'SUCCEEDED';
      exception when others then
        get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      end;
      reset role;

      -- 置き換えたままの状態（巻き戻し前）で、同意行が1行も追加されていないことを確認する。
      select count(*) into v_user_rows from public.terms_consents
        where user_id = '08900000-0000-0000-0000-00000000a005';
      select count(*) into v_total_inside from public.terms_consents;

      if v_msg is distinct from 'VERSION_MISMATCH' then
        raise exception 'FAIL: 法務版異常(%)でVERSION_MISMATCHにならない(got=%)', v_case, v_msg;
      end if;
      if coalesce(v_detail, '') <> '' or coalesce(v_hint, '') <> '' then
        raise exception 'FAIL: 法務版異常(%)のエラーに詳細・ヒントが付いている', v_case;
      end if;
      if position('08900000' in v_msg) > 0 or position('2026-' in v_msg) > 0 or position('SECRET' in v_msg) > 0 then
        raise exception 'FAIL: 法務版異常(%)のエラーにuserId・法務版の実値が含まれている', v_case;
      end if;
      if v_user_rows <> 0 or v_total_inside <> v_total_before then
        raise exception 'FAIL: 法務版異常(%)で同意行が追加された(本人=%, 全体=%→%)', v_case, v_user_rows, v_total_before, v_total_inside;
      end if;
      raise notice 'PASS: 法務版異常(%) → VERSION_MISMATCH、本人の同意行=%件・全体=%件（変化なし）', v_case, v_user_rows, v_total_inside;

      raise exception 'ROLLBACK_SENTINEL';
    exception when raise_exception then
      if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;
    end;
  end loop;
end $$;
reset role;

-- 置き換えた法務版関数が通常の1行へ戻っていること。
do $$
declare
  v_count bigint;
  v_terms text;
  v_privacy text;
begin
  select count(*), min(terms_version), min(privacy_version) into v_count, v_terms, v_privacy
    from public.current_legal_document_versions();
  if v_count <> 1 or v_terms <> '2026-10-14-v4' or v_privacy <> '2026-10-14-v5' then
    raise exception 'FAIL: current_legal_document_versions()が通常の1行へ戻っていない(count=%, terms=%, privacy=%)', v_count, v_terms, v_privacy;
  end if;
  if exists (select 1 from public.terms_consents where user_id = '08900000-0000-0000-0000-00000000a005') then
    raise exception 'FAIL: 法務版異常のテスト後に同意行が残っている';
  end if;
  raise notice 'PASS: 法務版関数は通常の1行（2026-10-14-v4/2026-10-14-v5）へ戻り、異常ケースの同意行は残っていない';
end $$;

-- ============================================================
-- 同意v3-5: X会員相当・匿名ゲスト相当のどちらでも成功し、記録されるuserIdは
--           auth.uid()、版はDB現在版。同じ版を複数回呼んでも1件だけ。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a001', true);
  perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a001', '2026-10-14-v4', '2026-10-14-v5');
  perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a001', '2026-10-14-v4', '2026-10-14-v5');
  perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a001', '2026-10-14-v4', '2026-10-14-v5');
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a002', true);
  perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a002', '2026-10-14-v4', '2026-10-14-v5');
  perform public.record_terms_consent_v3('08900000-0000-0000-0000-00000000a002', '2026-10-14-v4', '2026-10-14-v5');
end $$;
reset role;

do $$
declare
  v_uid uuid;
  v_count bigint;
  v_terms text;
  v_privacy text;
begin
  if not (select is_anonymous from auth.users where id = '08900000-0000-0000-0000-00000000a002') then
    raise exception 'FAIL: テスト前提の匿名ゲスト相当ユーザーがis_anonymous=trueになっていない';
  end if;
  foreach v_uid in array array['08900000-0000-0000-0000-00000000a001', '08900000-0000-0000-0000-00000000a002']::uuid[] loop
    select count(*) into v_count from public.terms_consents
      where user_id = v_uid and terms_version = '2026-10-14-v4' and privacy_version = '2026-10-14-v5';
    if v_count <> 1 then
      raise exception 'FAIL: %の現在版の同意行が1件ではない(got=%)', v_uid, v_count;
    end if;
  end loop;
  select terms_version, privacy_version into v_terms, v_privacy from public.current_legal_document_versions();
  if exists (
    select 1 from public.terms_consents
    where user_id in ('08900000-0000-0000-0000-00000000a001', '08900000-0000-0000-0000-00000000a002')
      and (terms_version, privacy_version) is distinct from (v_terms, v_privacy)
      and not (user_id = '08900000-0000-0000-0000-00000000a001' and terms_version = '2026-09-28-v2' and privacy_version = '2026-09-28-v3')
  ) then
    raise exception 'FAIL: DB現在版以外の版で同意行が記録された';
  end if;
  raise notice 'PASS: X会員相当・匿名ゲスト相当ともに成功し、user_id=auth.uid()・版=DB現在版で、複数回呼んでも1件だけ';
end $$;

-- ============================================================
-- 同意v3-6: 既存の旧版同意履歴は削除・更新されない。
-- ============================================================
do $$
declare
  v_count bigint;
  v_total bigint;
begin
  select count(*) into v_count from public.terms_consents
    where user_id = '08900000-0000-0000-0000-00000000a001'
      and terms_version = '2026-09-28-v2' and privacy_version = '2026-09-28-v3';
  select count(*) into v_total from public.terms_consents
    where user_id = '08900000-0000-0000-0000-00000000a001';
  if v_count <> 1 or v_total <> 2 then
    raise exception 'FAIL: 旧版の同意履歴が保全されていない(旧版=%, 合計=%)', v_count, v_total;
  end if;
  raise notice 'PASS: 旧版の同意履歴はそのまま残り、現在版の行が1件追加されただけ';
end $$;

-- ============================================================
-- 既存契約1: record_terms_consent_v2の属性・権限・動作が変わっていない。
-- ============================================================
do $$
declare
  v_oid oid := 'public.record_terms_consent_v2(text, text)'::regprocedure;
  p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid = v_oid;
  if not p.prosecdef or p.proconfig is distinct from array['search_path=public'] then
    raise exception 'FAIL: record_terms_consent_v2の属性が変わっている(secdef=%, config=%)', p.prosecdef, p.proconfig;
  end if;
  if has_function_privilege('public', v_oid, 'EXECUTE') or has_function_privilege('anon', v_oid, 'EXECUTE')
     or not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'FAIL: record_terms_consent_v2の権限が変わっている';
  end if;
  if has_function_privilege('public', 'public.current_legal_document_versions()', 'EXECUTE')
     or has_function_privilege('anon', 'public.current_legal_document_versions()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.current_legal_document_versions()', 'EXECUTE') then
    raise exception 'FAIL: current_legal_document_versions()の既存REVOKEが変わっている';
  end if;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a004', true);
  begin
    perform public.record_terms_consent_v2('2026-09-28-v2', '2026-09-28-v3');
    raise exception 'FAIL: v2が旧版で成功してしまった';
  exception when raise_exception then
    if sqlerrm <> 'VERSION_MISMATCH' then
      raise exception 'FAIL: v2の旧版エラーがVERSION_MISMATCHではない(got=%)', sqlerrm;
    end if;
  end;
  perform public.record_terms_consent_v2('2026-10-14-v4', '2026-10-14-v5');
  perform public.record_terms_consent_v2('2026-10-14-v4', '2026-10-14-v5');
  begin
    perform public.record_terms_consent();
    raise exception 'FAIL: 退役済みのrecord_terms_consent()が成功してしまった';
  exception when raise_exception then
    if sqlerrm <> 'CLIENT_UPDATE_REQUIRED' then
      raise exception 'FAIL: record_terms_consent()のエラーがCLIENT_UPDATE_REQUIREDではない(got=%)', sqlerrm;
    end if;
  end;
end $$;
reset role;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.terms_consents
    where user_id = '08900000-0000-0000-0000-00000000a004'
      and terms_version = '2026-10-14-v4' and privacy_version = '2026-10-14-v5';
  if v_count <> 1 then
    raise exception 'FAIL: v2の成功・冪等動作が変わっている(got=%)', v_count;
  end if;
  raise notice 'PASS: record_terms_consent_v2の属性・権限・一致判定・冪等動作、record_terms_consent()の互換停止、current_legal_document_versions()のREVOKEはいずれも不変';
end $$;

-- ============================================================
-- 既存契約2: terms_consentsへの直接INSERT/UPDATE/DELETEは引き続き不可。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08900000-0000-0000-0000-00000000a001', true);
  begin
    insert into public.terms_consents (user_id, terms_version, privacy_version)
      values ('08900000-0000-0000-0000-00000000a001', 'x', 'y');
    raise exception 'FAIL: terms_consentsへ直接INSERTできてしまった';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.terms_consents set terms_version = 'x' where user_id = '08900000-0000-0000-0000-00000000a001';
    raise exception 'FAIL: terms_consentsを直接UPDATEできてしまった';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.terms_consents where user_id = '08900000-0000-0000-0000-00000000a001';
    raise exception 'FAIL: terms_consentsを直接DELETEできてしまった';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: terms_consentsへの直接INSERT/UPDATE/DELETEは引き続き不可';
end $$;
reset role;

select '0089 ALL TESTS PASSED' as result;
