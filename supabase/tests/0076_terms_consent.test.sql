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
-- テスト1〜3（2026-09-28、0083による退役対応）：record_terms_consent()
-- （引数なし、このマイグレーション0076で新設）は、その後0083で「クライアント
-- から渡された版を一切信用せず記録もしない、常にCLIENT_UPDATE_REQUIREDで
-- 拒否する」安全な互換停止状態へcreate or replaceされた。0076自体（この
-- ファイルの上のcreate文）は編集していないが、supabase/tests/run.shは
-- 0001〜最新までの全マイグレーションを先に適用してから全テストを実行する
-- ため、このテストが実際に確認するのは「最終的に適用された関数の挙動」
-- （＝0083での退役後の挙動）になる。新しい世代付きRPC
-- record_terms_consent_v2の挙動はsupabase/tests/0083_legal_short_video_
-- consent.test.sqlで、「0083適用前はrecord_terms_consent_v2が存在しない」
-- という順序依存の検証はsupabase/tests/run_0083_consent_migration_test.sh
-- （専用の使い捨てDBを使う別スクリプト）で、それぞれ検証する。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7600000-0000-0000-0000-00000000000a', true);
  begin
    perform public.record_terms_consent();
    raise exception 'FAIL: 退役済みのrecord_terms_consent()が例外を投げずに成功してしまった';
  exception
    when others then
      if sqlerrm <> 'CLIENT_UPDATE_REQUIRED' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.terms_consents where user_id = 'a7600000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL: 退役済みのrecord_terms_consent()が同意行を作ってしまった(count=%)', v_count;
  end if;
  raise notice 'PASS: 退役後のrecord_terms_consent()はCLIENT_UPDATE_REQUIREDで拒否し、同意行を一切作らない';
end $$;

-- 未ログインでも同じくCLIENT_UPDATE_REQUIRED（認証状態を確認する前に無条件で
-- 拒否する設計のため）。「同意行を作らない」という結論は変わらない。
do $$
begin
  set local role authenticated;
  begin
    perform public.record_terms_consent();
    raise exception 'FAIL: 未ログインでも退役済みのrecord_terms_consent()が成功してしまった';
  exception
    when others then
      if sqlerrm <> 'CLIENT_UPDATE_REQUIRED' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 未ログインでも退役後のrecord_terms_consent()はCLIENT_UPDATE_REQUIREDで拒否される（同意行は作られない）';
  end;
end $$;
reset role;

-- 何度呼んでも（旧アプリが再試行を繰り返しても）常に拒否され続け、同意行は
-- 決して作られない。
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7600000-0000-0000-0000-00000000000a', true);
  for i in 1..3 loop
    begin
      perform public.record_terms_consent();
      raise exception 'FAIL: %回目の呼び出しで退役済みのrecord_terms_consent()が成功してしまった', i;
    exception
      when others then
        if sqlerrm <> 'CLIENT_UPDATE_REQUIRED' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
    end;
  end loop;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.terms_consents where user_id = 'a7600000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL: 繰り返し呼んだ結果、同意行が作られてしまった(count=%)', v_count;
  end if;
  raise notice 'PASS: 退役後のrecord_terms_consent()は何度呼んでも常に拒否され、同意行は一切作られない';
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
