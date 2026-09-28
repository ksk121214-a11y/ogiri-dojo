-- 利用規約・プライバシーポリシーの実質改定（第8条：公式Xアカウントのみへの掲載から、
-- YouTube・TikTok・Instagram等の動画配信サービスへの短尺動画・切り抜き掲載までの拡張）に
-- 伴う、同意バージョン判定関数の更新、及び「0083適用」と「新フロントエンドのデプロイ」の
-- 順序に関わらず誤った版を同意済みとして記録しないための、世代付き同意RPCへの切替え。
--
-- 【対象】0001〜0082は一切書き換えない（0081は本番適用済み、0082は本番未適用の新規
-- マイグレーションとして別途維持する）。本ファイル自体も本番未適用のため、内容を
-- 全面的に書き換えてよい。begin/commitで1トランザクション（0068・0071・0073・
-- 0076〜0079・0081・0082と同じ流儀）。
--
-- 【背景・問題（実際にローカルの使い捨てDBで、本番と同じ関数を使って再現した）】
-- 旧方式（0076のrecord_terms_consent()、引数なし）は「DBのcurrent_legal_document_
-- versions()が返す現在値を、クライアントの意向に関わらずそのまま記録する」設計
-- だった。これは「クライアントが任意のバージョンを主張できない」という点では安全
-- だったが、逆に次の2つの事故が起こり得た。
--   a) 新フロントエンド（TERMS_VERSION=2026-09-28-v2・PRIVACY_VERSION=2026-09-28-v3）
--      が先にデプロイされ、本番DBにまだ本ファイル（0083）が未適用の間：
--      新画面はv2/v3への同意を求めるが、DBの現在値はまだ旧い値（0081時点の
--      '2026-09-25-v1'/'2026-09-28-v2'）のため、record_terms_consent()は
--      その旧い値を記録してしまう。新画面はv2/v3に一致する行を探し続けるため、
--      いつまで経っても「同意済み」と判定されない（同意ループ）。
--   b) 本ファイル（0083）が先に本番DBへ適用され、旧フロントエンドがまだ配信
--      されている間：旧画面（第8条の動画配信サービス条項が無い版）しか見て
--      いない利用者がXログイン・ゲスト参加の同意操作をしても、DBの現在値は
--      既にv2/v3になっているため、本人が読んでいない新条項への同意として
--      記録されてしまう。しかも旧画面自身は自分が期待する旧バージョンの行が
--      見つからないため、同意済みと判定できず同意ループになる。
-- 「0083適用後、数秒以内にフロントエンドをpromoteする」という運用の工夫だけでは、
-- この間隔をゼロにはできず、上記の事故が起こる可能性を構造的に排除できない。
--
-- 【対応方針】
-- 1) 新しい世代付きRPC record_terms_consent_v2(p_expected_terms_version,
--    p_expected_privacy_version) を新設する。クライアント（フロントエンドの
--    src/lib/legalInfo.tsが持つTERMS_VERSION/PRIVACY_VERSION、＝実際に利用者が
--    画面で読んで同意ボタンを押した版）が「自分が同意を求めた版」を明示的に
--    渡し、DBのcurrent_legal_document_versions()の現在値と両方完全一致する
--    場合にだけ記録する。一致しない場合はVERSION_MISMATCHで拒否し、
--    同意行は一切作らない。これにより、新旧どちらのデプロイ順序であっても、
--    「画面に表示していない版を同意済みとして記録する」ことが構造的に
--    起こらなくなる（新画面が先行していればDBがまだ古く不一致→拒否、
--    DBが先行していれば旧画面の期待値が古く不一致→拒否。どちらの場合も
--    記録されるのは「画面とDBの現在値が一致した瞬間」だけ）。
--    記録する値は、クライアントが渡した引数をそのまま使うのではなく、必ず
--    DBのcurrent_legal_document_versions()から取得し直した値を使う
--    （一致確認後の再取得なので値は同じだが、クライアント引数を信用しない
--    という設計原則を徹底するため）。
-- 2) 旧RPC record_terms_consent()（0076で新設、引数なし）は、0083適用後も
--    旧フロントエンドから呼ばれ続ける。これが新しいv2/v3を記録してしまうと
--    上記b)の事故になるため、本ファイルでcreate or replaceし、同意行を
--    一切作らずCLIENT_UPDATE_REQUIREDで即座に拒否する「安全な互換停止」状態
--    へ変更する。0076自体（このマイグレーションファイル）は編集しない。
--    関数のシグネチャ（引数無し・void）は変えないためcreate or replaceで
--    既存のGRANT（authenticatedのみ）がそのまま維持され、drop&create不要。
-- 3) 新フロントエンドの同意記録は、後述のコード変更によりrecord_terms_consent_v2
--    経由へ完全に統一する（旧record_terms_consent()は新フロントエンドからは
--    一切呼ばない）。
-- 4) current_legal_document_versions()自体の値（'2026-09-28-v2'/'2026-09-28-v3'）は
--    変更しない。
-- 5) 0082（寄合帳の他ユーザープロフィールへの称号表示）とは無関係の変更であり、
--    0082のsns_author_names等には一切触れない。
begin;

create or replace function public.current_legal_document_versions()
returns table (terms_version text, privacy_version text)
language sql
stable
as $$
  select '2026-09-28-v2'::text, '2026-09-28-v3'::text;
$$;

-- ============================================================
-- 新設：世代付き同意RPC。クライアントが「自分が実際に読んで同意を求められた
-- 版」を明示し、DBの現在値と完全一致した場合にだけ記録する。
-- ============================================================
create or replace function public.record_terms_consent_v2(
  p_expected_terms_version text,
  p_expected_privacy_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current_terms text;
  v_current_privacy text;
begin
  if v_uid is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  if p_expected_terms_version is null or p_expected_privacy_version is null then
    raise exception 'VERSION_MISMATCH';
  end if;

  select terms_version, privacy_version into v_current_terms, v_current_privacy
    from public.current_legal_document_versions();

  -- クライアントが渡した期待バージョンは、DBの現在値と両方完全一致する場合
  -- だけ受け付ける。片方だけの一致・空文字・任意の文字列・旧バージョン・
  -- 存在しない未来のバージョンは、すべてここで拒否される（クライアントが
  -- 主張するバージョンをそのまま信用しない）。
  if v_current_terms is distinct from p_expected_terms_version
     or v_current_privacy is distinct from p_expected_privacy_version then
    raise exception 'VERSION_MISMATCH';
  end if;

  -- 記録する値は、クライアント引数ではなく、直前にDBから取得し直した
  -- current_legal_document_versions()の値を使う（一致確認後の再取得のため
  -- 値そのものはp_expected_*と同じになるが、「DBの値だけを記録に使う」という
  -- 設計原則を徹底する）。
  insert into public.terms_consents (user_id, terms_version, privacy_version)
  values (v_uid, v_current_terms, v_current_privacy)
  on conflict (user_id, terms_version, privacy_version) do nothing;
end;
$$;

revoke execute on function public.record_terms_consent_v2(text, text) from public;
revoke execute on function public.record_terms_consent_v2(text, text) from anon;
grant execute on function public.record_terms_consent_v2(text, text) to authenticated;

-- ============================================================
-- 0076のrecord_terms_consent()（引数なし）を、安全な互換停止状態へ変更する。
-- 同意行は一切作らず、常にCLIENT_UPDATE_REQUIREDで拒否する。これにより、
-- 0083適用後も旧フロントエンドが呼び続けても、旧バージョン・新バージョンの
-- いずれの行も新規に作られず、既存の同意履歴も一切変更されない。
-- 関数シグネチャ（引数無し・戻り値void）は0076と同一のため、create or replace
-- で既存のGRANT（authenticatedのみ、0076で付与済み）がそのまま維持される。
-- ============================================================
create or replace function public.record_terms_consent()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'CLIENT_UPDATE_REQUIRED';
end;
$$;

commit;
