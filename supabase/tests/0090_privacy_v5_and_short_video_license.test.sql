-- 0090 回帰テスト（法務）：利用規約v4・プライバシーポリシーv5への更新と、短尺動画・切り抜き動画
-- 掲載許諾の対象判定（short_video_license_*）が現在の法務文書バージョンから独立して
-- いることの確認。
-- - current_legal_document_versions()は terms=2026-10-14-v4 / privacy=2026-10-14-v5 を返し、
--   シグネチャ・属性・実行権限は0088時点から変わらない
-- - 短尺動画の効力発生日は2026-10-10 00:00（日本時間）のまま
-- - 許可の組は過去分（terms v3＋privacy v4）と現在分（terms v4＋privacy v5）の2つ。
--   v3＋v4へ同意済みの既存利用者・v4＋v5へ同意する利用者のどちらも、同意後の生成物は対象
--   （10/10〜10/13の生成物・10/14以降の生成物とも）。中間案のterms v3＋privacy v5は対象外
-- - 法務文書の版を将来さらに更新しても、効力発生日・対象判定は自動では移動しない
-- - 同意記録・流入アンケートの回答済み状態は変更されない
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

-- ============================================================
-- テスト1: 現在の法務版と、関数のシグネチャ・属性・実行権限。
-- ============================================================
do $$
declare
  v_count bigint;
  v_terms text;
  v_privacy text;
  v_proc record;
begin
  select count(*), min(terms_version), min(privacy_version) into v_count, v_terms, v_privacy
    from public.current_legal_document_versions();
  if v_count <> 1 or v_terms <> '2026-10-14-v4' or v_privacy <> '2026-10-14-v5' then
    raise exception 'FAIL: 現在の法務版が想定と異なる(count=%, terms=%, privacy=%)', v_count, v_terms, v_privacy;
  end if;

  select p.prosecdef, p.provolatile, l.lanname,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result
    into v_proc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.proname = 'current_legal_document_versions';
  if v_proc.prosecdef or v_proc.provolatile <> 's' or v_proc.lanname <> 'sql' or v_proc.args <> ''
     or v_proc.result <> 'TABLE(terms_version text, privacy_version text)' then
    raise exception 'FAIL: current_legal_document_versions()のシグネチャ・属性が変わった(%)', v_proc;
  end if;

  if has_function_privilege('anon', 'public.current_legal_document_versions()', 'execute')
     or has_function_privilege('authenticated', 'public.current_legal_document_versions()', 'execute') then
    raise exception 'FAIL: current_legal_document_versions()へクライアントロールのEXECUTEが付与されている（0087の権限が崩れた）';
  end if;
  raise notice 'PASS: current_legal_document_versions()は2026-10-14-v4/2026-10-14-v5の1行を返し、シグネチャ・属性・実行権限は従来どおり';
end $$;

-- ============================================================
-- テスト2: 短尺動画判定関数はクライアントロールから実行できない。効力発生日・
--          許可バージョンの組が想定どおり。
-- ============================================================
do $$
declare
  v_pairs text;
begin
  if has_function_privilege('anon', 'public.short_video_license_applies(uuid, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.short_video_license_applies(uuid, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.short_video_license_consent_versions()', 'execute')
     or has_function_privilege('authenticated', 'public.short_video_license_effective_from()', 'execute') then
    raise exception 'FAIL: 短尺動画判定関数へクライアントロールのEXECUTEが付与されている';
  end if;

  if public.short_video_license_effective_from() <> '2026-10-10 00:00:00+09'::timestamptz then
    raise exception 'FAIL: 短尺動画の効力発生日が2026-10-10 00:00(JST)ではない(got=%)', public.short_video_license_effective_from();
  end if;

  select string_agg(terms_version || '/' || privacy_version, ',' order by privacy_version) into v_pairs
    from public.short_video_license_consent_versions();
  if v_pairs <> '2026-10-10-v3/2026-10-10-v4,2026-10-14-v4/2026-10-14-v5' then
    raise exception 'FAIL: 短尺動画の許可バージョンの組が想定と異なる(got=%)', v_pairs;
  end if;

  -- 現在の法務版の組が許可一覧に含まれている（追記漏れで新規利用者が対象外にならない）。
  if not exists (
    select 1 from public.current_legal_document_versions() c
      join public.short_video_license_consent_versions() v
        on v.terms_version = c.terms_version and v.privacy_version = c.privacy_version
  ) then
    raise exception 'FAIL: 現在の法務版の組が短尺動画の許可バージョン一覧に含まれていない';
  end if;
  raise notice 'PASS: 短尺動画判定関数はクライアントから実行できず、効力発生日は2026-10-10(JST)、許可の組はv3+v4・v4+v5で現在版を含む';
end $$;

-- ============================================================
-- テスト3: 対象判定のシナリオ。
--   S1 既存利用者：2026-10-10 09:00にv3+v4へ同意（v5へはまだ再同意していない）
--   S2 現在版の利用者：2026-10-15 10:00にterms v4+privacy v5へ同意
--   S3 境界確認用：2026-10-09 22:00にv3+v4へ同意
--   S4 旧版のみ：2026-09-28-v2/2026-09-28-v3だけに同意
--   S5 同意記録なし
--   S6 中間案のみ：terms 2026-10-10-v3＋privacy 2026-10-14-v5（未適用の中間案。許可の組に含めない）
-- ============================================================
insert into auth.users (id, is_anonymous) values
  ('a9920000-0000-0000-0000-000000000001', false),
  ('a9920000-0000-0000-0000-000000000002', false),
  ('a9920000-0000-0000-0000-000000000003', false),
  ('a9920000-0000-0000-0000-000000000004', false),
  ('a9920000-0000-0000-0000-000000000005', false),
  ('a9920000-0000-0000-0000-000000000006', false)
on conflict do nothing;

insert into public.terms_consents (user_id, terms_version, privacy_version, consented_at) values
  ('a9920000-0000-0000-0000-000000000001', '2026-10-10-v3', '2026-10-10-v4', '2026-10-10 09:00:00+09'),
  ('a9920000-0000-0000-0000-000000000002', '2026-10-14-v4', '2026-10-14-v5', '2026-10-15 10:00:00+09'),
  ('a9920000-0000-0000-0000-000000000003', '2026-10-10-v3', '2026-10-10-v4', '2026-10-09 22:00:00+09'),
  ('a9920000-0000-0000-0000-000000000004', '2026-09-28-v2', '2026-09-28-v3', '2026-09-28 12:00:00+09'),
  ('a9920000-0000-0000-0000-000000000006', '2026-10-10-v3', '2026-10-14-v5', '2026-10-14 12:00:00+09');

do $$
declare
  r record;
  v_got boolean;
begin
  for r in
    select * from (values
      -- 既存利用者（v4同意）：10/10〜10/13の生成物も、10/14以降の生成物も対象
      ('S1 v4同意・10/11生成', 'a9920000-0000-0000-0000-000000000001'::uuid, '2026-10-11 20:00:00+09'::timestamptz, true),
      ('S1 v4同意・10/13 23:59生成', 'a9920000-0000-0000-0000-000000000001'::uuid, '2026-10-13 23:59:59+09'::timestamptz, true),
      ('S1 v4同意・10/14生成', 'a9920000-0000-0000-0000-000000000001'::uuid, '2026-10-14 00:00:00+09'::timestamptz, true),
      ('S1 v4同意・10/20生成（v5未再同意）', 'a9920000-0000-0000-0000-000000000001'::uuid, '2026-10-20 18:00:00+09'::timestamptz, true),
      ('S1 同意前（10/10 08:59）の生成', 'a9920000-0000-0000-0000-000000000001'::uuid, '2026-10-10 08:59:59+09'::timestamptz, false),
      ('S1 同意と同時刻の生成', 'a9920000-0000-0000-0000-000000000001'::uuid, '2026-10-10 09:00:00+09'::timestamptz, true),
      -- 新規利用者（v5同意）：同意後の10/14以降の生成物は対象、同意前は対象外
      ('S2 v4+v5同意・同意後の生成', 'a9920000-0000-0000-0000-000000000002'::uuid, '2026-10-15 11:00:00+09'::timestamptz, true),
      ('S2 v4+v5同意・同意前の生成', 'a9920000-0000-0000-0000-000000000002'::uuid, '2026-10-15 09:59:59+09'::timestamptz, false),
      -- 効力発生日の境界：同意済みでも10/10より前の生成物は対象外、10/10 0時以後は対象
      ('S3 効力発生日前（10/09 23:59）の生成', 'a9920000-0000-0000-0000-000000000003'::uuid, '2026-10-09 23:59:59+09'::timestamptz, false),
      ('S3 効力発生日ちょうど（10/10 00:00）の生成', 'a9920000-0000-0000-0000-000000000003'::uuid, '2026-10-10 00:00:00+09'::timestamptz, true),
      ('S3 10/12生成', 'a9920000-0000-0000-0000-000000000003'::uuid, '2026-10-12 12:00:00+09'::timestamptz, true),
      -- 許可一覧に無い旧版だけに同意 → 対象外
      ('S4 旧版のみ同意・10/12生成', 'a9920000-0000-0000-0000-000000000004'::uuid, '2026-10-12 12:00:00+09'::timestamptz, false),
      -- 中間案（terms v3＋privacy v5）だけに同意 → 対象外
      ('S6 中間案のみ同意・10/15生成', 'a9920000-0000-0000-0000-000000000006'::uuid, '2026-10-15 12:00:00+09'::timestamptz, false),
      -- 同意記録なし → 対象外
      ('S5 同意なし・10/12生成', 'a9920000-0000-0000-0000-000000000005'::uuid, '2026-10-12 12:00:00+09'::timestamptz, false),
      -- 引数null → 対象外
      ('null生成日時', 'a9920000-0000-0000-0000-000000000001'::uuid, null::timestamptz, false)
    ) as t(label, user_id, generated_at, expected)
  loop
    v_got := public.short_video_license_applies(r.user_id, r.generated_at);
    if v_got is distinct from r.expected then
      raise exception 'FAIL: %: 期待=% 実際=%', r.label, r.expected, v_got;
    end if;
    raise notice 'PASS: % → %', r.label, v_got;
  end loop;
end $$;

-- ============================================================
-- テスト4: 既存のv3+v4同意者がv4+v5へ再同意しても、v3+v4の同意記録は残り（削除・変更
--          されない）、v3+v4同意後〜再同意前の生成物も引き続き対象。流入アンケートの回答済み状態は
--          再同意で変化しない。
-- ============================================================
update public.profiles
  set referral_source = 'app', referral_source_answered_at = '2026-09-30 12:00:00+09'
  where id = 'a9920000-0000-0000-0000-000000000001';

do $$
declare
  v_rows bigint;
  v_v4_at timestamptz;
  v_src text;
  v_at timestamptz;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9920000-0000-0000-0000-000000000001', true);
  perform public.record_terms_consent_v2('2026-10-14-v4', '2026-10-14-v5');
  reset role;

  select count(*) into v_rows from public.terms_consents where user_id = 'a9920000-0000-0000-0000-000000000001';
  select consented_at into v_v4_at from public.terms_consents
    where user_id = 'a9920000-0000-0000-0000-000000000001' and privacy_version = '2026-10-10-v4';
  if v_rows <> 2 or v_v4_at is distinct from '2026-10-10 09:00:00+09'::timestamptz then
    raise exception 'FAIL: v4+v5再同意でv3+v4の同意記録が変化した(行数=%, v4同意日時=%)', v_rows, v_v4_at;
  end if;

  if not public.short_video_license_applies('a9920000-0000-0000-0000-000000000001', '2026-10-12 12:00:00+09') then
    raise exception 'FAIL: v4+v5再同意後に、v3+v4同意期間（10/12）の生成物が対象外になった';
  end if;

  select referral_source, referral_source_answered_at into v_src, v_at
    from public.profiles where id = 'a9920000-0000-0000-0000-000000000001';
  if v_src is distinct from 'app' or v_at is distinct from '2026-09-30 12:00:00+09'::timestamptz then
    raise exception 'FAIL: 法務の再同意で流入アンケートの回答済み状態が変化した(referral_source=%, answered_at=%)', v_src, v_at;
  end if;
  raise notice 'PASS: v4+v5への再同意はv3+v4の同意記録を残し、v3+v4同意期間の生成物は引き続き対象で、流入アンケートの回答済み状態も変化しない';
end $$;

-- ============================================================
-- テスト5: 現在版と一致しない版（旧版v3+v4・中間案v3+v5）を期待値とする同意記録は
--          VERSION_MISMATCHで拒否され、同意行は作られない。
-- ============================================================
do $$
declare
  v_pair text[];
  v_msg text;
begin
  foreach v_pair slice 1 in array array[['2026-10-10-v3', '2026-10-10-v4'], ['2026-10-10-v3', '2026-10-14-v5']] loop
    set local role authenticated;
    perform set_config('myapp.uid', 'a9920000-0000-0000-0000-000000000005', true);
    begin
      perform public.record_terms_consent_v2(v_pair[1], v_pair[2]);
      v_msg := 'SUCCEEDED';
    exception when others then
      v_msg := sqlerrm;
    end;
    reset role;
    if v_msg <> 'VERSION_MISMATCH' then
      raise exception 'FAIL: %/%の同意記録がVERSION_MISMATCHにならない(got=%)', v_pair[1], v_pair[2], v_msg;
    end if;
  end loop;
  if exists (select 1 from public.terms_consents where user_id = 'a9920000-0000-0000-0000-000000000005') then
    raise exception 'FAIL: 現在版と異なる版の同意行が作られた';
  end if;
  raise notice 'PASS: 旧版(v3+v4)・中間案(v3+v5)を期待値とする同意記録はVERSION_MISMATCHで拒否され、同意行は作られない';
end $$;

-- ============================================================
-- テスト6: 将来、法務文書の版をさらに更新しても（ここではterms v5/privacy v6への
--          更新を模擬し、最後に巻き戻す）、短尺動画の効力発生日・許可の組・対象判定は
--          自動では移動しない。
-- ============================================================
do $$
declare
  v_from timestamptz;
  v_pairs text;
  v_s1 boolean;
  v_s2 boolean;
  v_s3_before boolean;
begin
  begin
    create or replace function public.current_legal_document_versions()
    returns table (terms_version text, privacy_version text)
    language sql stable as $fn$ select '2027-01-01-v5'::text, '2027-01-01-v6'::text $fn$;

    v_from := public.short_video_license_effective_from();
    select string_agg(terms_version || '/' || privacy_version, ',' order by privacy_version) into v_pairs
      from public.short_video_license_consent_versions();
    v_s1 := public.short_video_license_applies('a9920000-0000-0000-0000-000000000001', '2026-10-12 12:00:00+09');
    v_s2 := public.short_video_license_applies('a9920000-0000-0000-0000-000000000002', '2026-10-15 11:00:00+09');
    v_s3_before := public.short_video_license_applies('a9920000-0000-0000-0000-000000000003', '2026-10-09 23:59:59+09');

    if v_from <> '2026-10-10 00:00:00+09'::timestamptz
       or v_pairs <> '2026-10-10-v3/2026-10-10-v4,2026-10-14-v4/2026-10-14-v5'
       or not v_s1 or not v_s2 or v_s3_before then
      raise exception 'FAIL: 法務版の更新で短尺動画の判定が変化した(from=%, pairs=%, s1=%, s2=%, s3前=%)',
        v_from, v_pairs, v_s1, v_s2, v_s3_before;
    end if;
    raise exception 'ROLLBACK_SENTINEL';
  exception when raise_exception then
    if sqlerrm <> 'ROLLBACK_SENTINEL' then raise; end if;
  end;

  if (select privacy_version from public.current_legal_document_versions()) <> '2026-10-14-v5' then
    raise exception 'FAIL: 模擬した法務版の更新が巻き戻っていない';
  end if;
  raise notice 'PASS: 法務版を将来更新しても、短尺動画の効力発生日(2026-10-10)・許可の組・対象判定は自動で移動しない';
end $$;

select 'ALL 0090 LEGAL_V4_V5 / SHORT_VIDEO_LICENSE TESTS PASSED' as result;
