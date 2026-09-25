-- 0076 回帰テスト：利用規約・プライバシーポリシー同意記録（terms_consents /
-- record_terms_consent / current_legal_document_versions）の権限・一意制約・
-- 冪等性・本人以外への非公開を確認する。実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('a7600000-0000-0000-0000-00000000000a'), -- userA
  ('a7600000-0000-0000-0000-00000000000b')  -- userB
on conflict do nothing;

-- ============================================================
-- テスト0: PUBLIC/anonはrecord_terms_consent()のEXECUTE権限を持たない。
-- ============================================================
do $$
begin
  if has_function_privilege('public', 'record_terms_consent()', 'EXECUTE')
     or has_function_privilege('anon', 'record_terms_consent()', 'EXECUTE') then
    raise exception 'FAIL: record_terms_consent のEXECUTE権限がPUBLIC/anonに付与されている';
  end if;
  raise notice 'PASS: PUBLIC/anon はrecord_terms_consentのEXECUTE権限を持たない';
end $$;

do $$
begin
  set local role anon;
  begin
    perform public.record_terms_consent();
    raise exception 'FAIL: anonがrecord_terms_consentを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 匿名ロールはrecord_terms_consentに到達できない (insufficient_privilege)';
  end;
end $$;

-- ============================================================
-- テスト1: 未ログイン（auth.uid() is null）ではNOT_LOGGED_INになる。
-- ============================================================
do $$
begin
  set local role authenticated;
  begin
    perform public.record_terms_consent();
    raise exception 'FAIL: 未ログインでも記録できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_LOGGED_IN' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 未ログインはNOT_LOGGED_INで拒否される';
  end;
end $$;

-- ============================================================
-- テスト2（再監査対応）：record_terms_consent()は引数を取らず、DB側の
-- current_legal_document_versions()が返す現在のバージョンだけを記録する
-- （クライアントから任意のバージョン文字列を渡せない）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7600000-0000-0000-0000-00000000000a', true);
  perform public.record_terms_consent();
end $$;

reset role;

do $$
declare
  v_row record;
  v_current record;
begin
  select terms_version, privacy_version into v_current from public.current_legal_document_versions();

  select terms_version, privacy_version into v_row from public.terms_consents
    where user_id = 'a7600000-0000-0000-0000-00000000000a';
  if v_row.terms_version <> v_current.terms_version or v_row.privacy_version <> v_current.privacy_version then
    raise exception 'FAIL: 記録された同意内容がcurrent_legal_document_versions()の値と一致しない (row=%/%, current=%/%)',
      v_row.terms_version, v_row.privacy_version, v_current.terms_version, v_current.privacy_version;
  end if;
  raise notice 'PASS: record_terms_consent()はDB側で確定した現在のバージョンだけを記録する（クライアントからバージョン文字列を指定できない）';
end $$;

-- ============================================================
-- テスト3（一意制約・冪等性）：同じユーザー・同じバージョンの組で
-- record_terms_consent()を再度呼んでも、on conflict do nothingにより
-- 新しい行は増えない（重複記録の防止）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7600000-0000-0000-0000-00000000000a', true);
  perform public.record_terms_consent();
  perform public.record_terms_consent();
  perform public.record_terms_consent();
end $$;

reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.terms_consents where user_id = 'a7600000-0000-0000-0000-00000000000a';
  if v_count <> 1 then
    raise exception 'FAIL: 同じバージョンへの再同意で行が増えてしまった（重複記録） (count=%)', v_count;
  end if;
  raise notice 'PASS: 同じバージョンの再記録はon conflict do nothingで冪等になり、重複しない';
end $$;

-- ============================================================
-- テスト4（一意制約そのもの）：RPCを経由せず直接INSERTしても、
-- (user_id, terms_version, privacy_version)の一意制約により2件目は拒否される。
-- ============================================================
do $$
begin
  insert into public.terms_consents (user_id, terms_version, privacy_version)
    values ('a7600000-0000-0000-0000-00000000000b', 'dup-test-v1', 'dup-test-v1');
  begin
    insert into public.terms_consents (user_id, terms_version, privacy_version)
      values ('a7600000-0000-0000-0000-00000000000b', 'dup-test-v1', 'dup-test-v1');
    raise exception 'FAIL: 同じ(user_id, terms_version, privacy_version)の2件目が一意制約で拒否されなかった';
  exception
    when unique_violation then
      raise notice 'PASS: (user_id, terms_version, privacy_version)の一意制約により重複行は拒否される';
  end;
  delete from public.terms_consents where user_id = 'a7600000-0000-0000-0000-00000000000b' and terms_version = 'dup-test-v1';
end $$;

-- ============================================================
-- テスト5: 本人以外（userB）はuserAの同意履歴をselectできない。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7600000-0000-0000-0000-00000000000b', true);
  select count(*) into v_count from public.terms_consents where user_id = 'a7600000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL: userBからuserAの同意履歴が見えている (count=%)', v_count;
  end if;
  raise notice 'PASS: 他人の同意履歴はselectできない';
end $$;

reset role;

-- ============================================================
-- テスト6（再監査対応）：anon/authenticatedからのINSERT/UPDATE/DELETEは
-- テーブル権限自体を明示的にrevoke済みのため、RLSに頼らずpermission deniedで
-- 拒否される（Supabase標準構成のテーブル全体GRANTを上書きしていることの確認）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7600000-0000-0000-0000-00000000000b', true);
  begin
    insert into public.terms_consents (user_id, terms_version, privacy_version)
      values ('a7600000-0000-0000-0000-00000000000a', 'forged', 'forged');
    raise exception 'FAIL: 一般利用者が直接INSERTで他人のuser_idを書き込めてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: terms_consentsへの直接INSERTはテーブル権限自体がrevokeされ拒否される（record_terms_consent経由のみ）';
  end;

  begin
    update public.terms_consents set terms_version = 'tampered' where user_id = 'a7600000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: 一般利用者が直接UPDATEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: terms_consentsへの直接UPDATEはテーブル権限自体がrevokeされ拒否される';
  end;

  begin
    delete from public.terms_consents where user_id = 'a7600000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: 一般利用者が直接DELETEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: terms_consentsへの直接DELETEはテーブル権限自体がrevokeされ拒否される';
  end;
end $$;

reset role;

select 'ALL 0076 TESTS PASSED' as result;
