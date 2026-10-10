-- 0083 回帰テスト：利用規約・プライバシーポリシーの実質改定
-- （第8条：公式Xアカウントのみへの掲載から動画配信サービスへの短尺動画掲載までの拡張）
-- に伴うcurrent_legal_document_versions()の更新、退役させた旧record_terms_consent()
-- （引数なし）の安全な互換停止、及び新設した世代付きRPC
-- record_terms_consent_v2(p_expected_terms_version, p_expected_privacy_version)の
-- 権限・一致判定・冪等性・既存同意履歴の保全を確認する。
--
-- 「0083適用前はrecord_terms_consent_v2がまだ存在しない」という、マイグレーション
-- 適用順そのものに依存するシナリオ（新アプリ＋旧DB）は、この通常フロー
-- （0001〜最新まで先に全適用してからテストする方式）では検証できないため、
-- 専用の使い捨てDBを使うsupabase/tests/run_0083_consent_migration_test.shで
-- 別途検証する。実行方法はsupabase/tests/run.sh参照
-- （0001〜最新のマイグレーションが番号順に全適用された後の最終スキーマ状態に
-- 対して実行される）。
--
-- 2026-10-10（ライブ結果コメント自己削除機能に伴う規約改定対応）：0088が
-- current_legal_document_versions()を再度create or replaceし、利用規約・
-- プライバシーポリシーの「現在バージョン」は2026-10-10-v3/2026-10-10-v4へ進んだ
-- （0083自身の定義(2026-09-28-v2/2026-09-28-v3)はファイルとして変更していない）。
-- このテストファイルはrecord_terms_consent_v2自体の汎用的な振る舞い（権限・
-- 一致判定・冪等性・既存同意履歴の保全）を検証するものであり、「現在の正しい
-- バージョン」として使う値は、このテストが実行される時点でDBが実際に返す
-- 最新値（0088適用後の値）に追従させる必要がある。旧バージョンの値は、
-- 「不一致で拒否されるべき値」の例としてのみ引き続き使う。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('08300000-0000-0000-0000-00000000a001'), -- 通常会員（旧バージョンで同意済み）
  ('08300000-0000-0000-0000-00000000a002'), -- ゲスト相当（旧バージョンで同意済み）
  ('08300000-0000-0000-0000-00000000a003'), -- 旧アプリのみ操作する利用者（新規、未同意）
  ('08300000-0000-0000-0000-00000000a004')  -- 不一致バージョンの組み合わせを試す利用者
on conflict do nothing;

update public.profiles set is_guest = true where id = '08300000-0000-0000-0000-00000000a002';

-- ============================================================
-- テスト1: current_legal_document_versions()が、現在の最終バージョンの組
-- （src/lib/legalInfo.tsのTERMS_VERSION/PRIVACY_VERSIONと同じ値。この行は
-- 0088でcreate or replaceされた値であり、0083自身が定義した当時の値ではない）
-- を返す。
-- ============================================================
do $$
declare
  v_terms text;
  v_privacy text;
begin
  select terms_version, privacy_version into v_terms, v_privacy
    from public.current_legal_document_versions();
  if v_terms <> '2026-10-10-v3' then
    raise exception 'FAIL: terms_versionが現在の最終値になっていない(got=%)', v_terms;
  end if;
  if v_privacy <> '2026-10-10-v4' then
    raise exception 'FAIL: privacy_versionが現在の最終値になっていない(got=%)', v_privacy;
  end if;
  raise notice 'PASS: current_legal_document_versions()は利用規約・プライバシーポリシー両方の現在の最終バージョンを返す';
end $$;

-- 0081時点までの現在バージョン（'2026-09-25-v1' / '2026-09-28-v2'）で既に同意済み
-- だった状態を模す（本番で実際に起こりうる既存データ。通常会員・ゲスト（is_guest=true）
-- の両方で用意し、どちらも同じterms_consentsの仕組みで扱われることを確認する）。
insert into public.terms_consents (user_id, terms_version, privacy_version) values
  ('08300000-0000-0000-0000-00000000a001', '2026-09-25-v1', '2026-09-28-v2'),
  ('08300000-0000-0000-0000-00000000a002', '2026-09-25-v1', '2026-09-28-v2');

-- ============================================================
-- テスト2（既存利用者・既存ゲストとも再同意が必要になる）：ConsentRequiredGateと
-- 同じ条件（terms_version=現在値 and privacy_version=現在値に一致する行があるか）
-- で確認すると、0083適用前の同意記録はどちらもヒットしない。
-- ============================================================
do $$
declare
  v_count_member int;
  v_count_guest int;
begin
  select count(*) into v_count_member from public.terms_consents
    where user_id = '08300000-0000-0000-0000-00000000a001'
      and terms_version = '2026-10-10-v3' and privacy_version = '2026-10-10-v4';
  select count(*) into v_count_guest from public.terms_consents
    where user_id = '08300000-0000-0000-0000-00000000a002'
      and terms_version = '2026-10-10-v3' and privacy_version = '2026-10-10-v4';
  if v_count_member <> 0 then
    raise exception 'FAIL: 通常会員の旧同意記録が新バージョンの判定に誤ってヒットしている';
  end if;
  if v_count_guest <> 0 then
    raise exception 'FAIL: ゲストの旧同意記録が新バージョンの判定に誤ってヒットしている';
  end if;
  raise notice 'PASS: 通常会員・ゲストのいずれも、0083より前の同意記録は新バージョンの判定にヒットしない（＝次回利用時に再同意ゲートが表示される）';
end $$;

-- ============================================================
-- テスト3（新アプリ＋新DB：世代付きRPCで再同意すると同意ゲートを繰り返さない）：
-- record_terms_consent_v2に現在バージョンと一致する期待値を渡すと、通常会員・
-- ゲストのいずれも新しい現在バージョンで記録が作られ、旧バージョンの同意履歴は
-- 削除されず残る（authenticatedロールへのgrantは会員・匿名ゲストの区別をしない
-- ため、is_guestに関わらず同じRPCで記録できる）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08300000-0000-0000-0000-00000000a001', true);
  perform public.record_terms_consent_v2('2026-10-10-v3', '2026-10-10-v4');
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08300000-0000-0000-0000-00000000a002', true);
  perform public.record_terms_consent_v2('2026-10-10-v3', '2026-10-10-v4');
end $$;
reset role;

do $$
declare
  v_new_count int;
  v_total_count int;
begin
  select count(*) into v_new_count from public.terms_consents
    where user_id = '08300000-0000-0000-0000-00000000a001'
      and terms_version = '2026-10-10-v3' and privacy_version = '2026-10-10-v4';
  select count(*) into v_total_count from public.terms_consents
    where user_id = '08300000-0000-0000-0000-00000000a001';
  if v_new_count <> 1 then
    raise exception 'FAIL: 通常会員の再同意後に現在バージョンの記録が1件作られていない(got=%)', v_new_count;
  end if;
  if v_total_count <> 2 then
    raise exception 'FAIL: 通常会員の旧バージョンの同意履歴が消えている、または重複している(total=%)', v_total_count;
  end if;

  select count(*) into v_new_count from public.terms_consents
    where user_id = '08300000-0000-0000-0000-00000000a002'
      and terms_version = '2026-10-10-v3' and privacy_version = '2026-10-10-v4';
  select count(*) into v_total_count from public.terms_consents
    where user_id = '08300000-0000-0000-0000-00000000a002';
  if v_new_count <> 1 then
    raise exception 'FAIL: ゲストの再同意後に現在バージョンの記録が1件作られていない(got=%)', v_new_count;
  end if;
  if v_total_count <> 2 then
    raise exception 'FAIL: ゲストの旧バージョンの同意履歴が消えている、または重複している(total=%)', v_total_count;
  end if;
  raise notice 'PASS: 通常会員・ゲストのいずれも、record_terms_consent_v2（期待バージョン一致）で新バージョンの同意が記録され、旧バージョンの履歴は削除されず残る';
end $$;

-- 冪等性：同じ利用者が同じ現在バージョンで再度record_terms_consent_v2を呼んでも重複しない
-- （＝新バージョンへ同意した後は同意ゲートを繰り返さない）。
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08300000-0000-0000-0000-00000000a001', true);
  perform public.record_terms_consent_v2('2026-10-10-v3', '2026-10-10-v4');
  perform public.record_terms_consent_v2('2026-10-10-v3', '2026-10-10-v4');
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.terms_consents
    where user_id = '08300000-0000-0000-0000-00000000a001'
      and terms_version = '2026-10-10-v3' and privacy_version = '2026-10-10-v4';
  if v_count <> 1 then
    raise exception 'FAIL: 同じ現在バージョンへの再同意の複数回呼び出しで重複行ができている(count=%)', v_count;
  end if;
  raise notice 'PASS: 新バージョンへ同意済みの利用者が再度同じ操作をしても、同意記録は1件のまま（冪等・同意ゲートを繰り返さない）';
end $$;

-- ============================================================
-- テスト4（旧アプリ＋0083適用済みDB：旧RPCは安全に互換停止している）：退役済みの
-- record_terms_consent()（引数なし）は、DBが既に0083適用済みでも常に
-- CLIENT_UPDATE_REQUIREDで拒否し、v1/v2・v2/v3いずれの行も新規に作らない。
-- 旧画面（新第8条の記載が無い版）しか見ていない利用者が、旧アプリの「同意する」
-- ボタンを押しただけで、本人が読んでいない新バージョンへ同意済みにされてしまう
-- 事故を防ぐ、この修正の中心的な確認。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08300000-0000-0000-0000-00000000a003', true);
  begin
    perform public.record_terms_consent();
    raise exception 'FAIL: 0083適用済みDBでも旧record_terms_consent()が成功してしまった（本人が見ていない新版へ同意済みにされる事故）';
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
  select count(*) into v_count from public.terms_consents where user_id = '08300000-0000-0000-0000-00000000a003';
  if v_count <> 0 then
    raise exception 'FAIL: 旧RPCの呼び出しにより、本人が見ていない版への同意行が作られてしまった(count=%)', v_count;
  end if;
  raise notice 'PASS: 旧アプリからrecord_terms_consent()（引数なし）を呼んでも、0083適用後は常にCLIENT_UPDATE_REQUIREDで拒否され、v1/v2・v2/v3いずれの同意行も作られない（旧画面を見ただけの利用者が新規約へ同意済みにされない）';
end $$;

-- ============================================================
-- テスト5（不一致は例外なく拒否・同意行を作らない）：クライアントが渡す期待
-- バージョンがDBの現在値（2026-10-10-v3 / 2026-10-10-v4）と完全一致しない
-- 組み合わせは、片方だけの一致・空文字・任意の文字列・旧バージョン・NULLの
-- いずれもVERSION_MISMATCHで拒否され、同意行を一切作らない
-- （クライアントが主張するバージョンをそのまま信用しない）。
-- ============================================================
do $$
declare
  v_cases text[][] := array[
    array['2026-09-25-v1', '2026-09-28-v2'], -- 旧バージョンの組（0081時点の値。現在から見れば二重に古い）
    array['', ''],                            -- 空文字
    array['not-a-real-version', 'also-not-real'], -- 任意の文字列
    array['2026-10-10-v3', '2026-10-10-v3'],  -- terms側だけ一致、privacy側は不一致
    array['2026-10-10-v9', '2026-10-10-v4'],  -- privacy側だけ一致、terms側は不一致
    array['9999-01-01-v1', '9999-01-01-v1']   -- 存在しない未来のバージョンを主張
  ];
  v_case text[];
  v_terms text;
  v_privacy text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08300000-0000-0000-0000-00000000a004', true);
  foreach v_case slice 1 in array v_cases loop
    v_terms := v_case[1];
    v_privacy := v_case[2];
    begin
      perform public.record_terms_consent_v2(v_terms, v_privacy);
      raise exception 'FAIL: 不一致バージョンの組(%/%)がVERSION_MISMATCHで拒否されなかった', v_terms, v_privacy;
    exception
      when others then
        if sqlerrm <> 'VERSION_MISMATCH' then
          raise exception 'FAIL: 不一致バージョンの組(%/%)で想定外のエラー(%)', v_terms, v_privacy, sqlerrm;
        end if;
    end;
  end loop;

  -- NULL相当（明示的にNULLを渡す）も同様にVERSION_MISMATCHで拒否する。
  begin
    perform public.record_terms_consent_v2(null, '2026-10-10-v4');
    raise exception 'FAIL: terms側がnullなのにVERSION_MISMATCHで拒否されなかった';
  exception
    when others then
      if sqlerrm <> 'VERSION_MISMATCH' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
  end;
  begin
    perform public.record_terms_consent_v2('2026-10-10-v3', null);
    raise exception 'FAIL: privacy側がnullなのにVERSION_MISMATCHで拒否されなかった';
  exception
    when others then
      if sqlerrm <> 'VERSION_MISMATCH' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
  end;
  raise notice 'PASS: 旧バージョン・空文字・任意の文字列・片方だけ一致・存在しない未来のバージョン・NULLのいずれも、record_terms_consent_v2はVERSION_MISMATCHで拒否する';
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.terms_consents where user_id = '08300000-0000-0000-0000-00000000a004';
  if v_count <> 0 then
    raise exception 'FAIL: 不一致・NULLの組み合わせにも関わらず同意行が作られてしまった(count=%)', v_count;
  end if;
  raise notice 'PASS: NULLを含む不一致な期待バージョンはすべてVERSION_MISMATCHで拒否され、同意行は一切作られない';
end $$;

-- ============================================================
-- テスト6（権限：未ログイン・匿名ロールからは呼べない）：record_terms_consent_v2は
-- 未ログイン（authenticatedロールだがauth.uid()がnull）ではNOT_LOGGED_IN、
-- anonロールからはテーブル権限自体が無くinsufficient_privilegeで拒否される。
-- ============================================================
do $$
begin
  set local role authenticated;
  begin
    perform public.record_terms_consent_v2('2026-10-10-v3', '2026-10-10-v4');
    raise exception 'FAIL: 未ログインでもrecord_terms_consent_v2が実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_LOGGED_IN' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 未ログインはNOT_LOGGED_INで拒否される（record_terms_consent_v2）';
  end;
end $$;
reset role;

do $$
begin
  if has_function_privilege('anon', 'record_terms_consent_v2(text, text)', 'EXECUTE')
     or has_function_privilege('public', 'record_terms_consent_v2(text, text)', 'EXECUTE') then
    raise exception 'FAIL: record_terms_consent_v2のEXECUTE権限がanon/PUBLICに付与されている';
  end if;
  raise notice 'PASS: anon/PUBLICはrecord_terms_consent_v2のEXECUTE権限を持たない';
end $$;

do $$
begin
  set local role anon;
  begin
    perform public.record_terms_consent_v2('2026-10-10-v3', '2026-10-10-v4');
    raise exception 'FAIL: anonロールがrecord_terms_consent_v2を実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 匿名ロール(anon)はrecord_terms_consent_v2に到達できない (insufficient_privilege)';
  end;
end $$;
reset role;

select 'ALL 0083 TESTS PASSED' as result;
