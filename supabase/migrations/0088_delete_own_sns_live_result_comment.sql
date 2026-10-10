-- ライブ結果コメント(sns_live_result_comments)を、投稿した本人が削除できるようにする。
-- 既存の寄合帳コメント削除(delete_own_sns_comment、0067参照)と同じ論理削除方式：
-- is_hidden=true, hidden_reason='deleted_by_author', hidden_by=auth.uid(), hidden_at=now()。
-- sns_live_result_comments_write_host / sns_live_result_comments_delete_host
-- （運営のみ直接update/deleteできるRLS、0031参照）は変更しない。本RPCはSECURITY
-- DEFINERでRLSをバイパスし、本人確認後にUPDATEで論理削除するだけで、他の経路から
-- 一般DELETE権限やRLSを緩めることは一切しない。
--
-- 2026-10-10（レビュー対応）：RPC名を、寄合帳側の既存命名
-- (delete_own_sns_topic/delete_own_sns_answer/delete_own_sns_comment、いずれも
-- "delete_own_sns_"接頭辞)に合わせてdelete_own_sns_live_result_commentへ統一した
-- （旧名delete_own_live_result_commentの別名関数は作らない。旧名は未適用のため
-- 本番・ステージングのどちらにも一度も存在していない）。
--
-- また、この自己削除機能により利用規約・プライバシーポリシーの本文を実質的に
-- 変更した（「本人による削除機能を提供していません」→「本人が削除できます」）ため、
-- current_legal_document_versions()（0076で新設、0081・0083でcreate or replace済み。
-- いずれも編集禁止）を本ファイルでさらにcreate or replaceし、同意版を更新する。
-- 既存の利用者は、次回アクセス時にConsentRequiredGateにより再同意が必要になる
-- （terms_consentsの既存同意記録は、新バージョンの組と一致しなくなるため）。
-- src/lib/legalInfo.tsのTERMS_VERSION/PRIVACY_VERSIONと必ず同じ値にすること。
--
-- 本ファイルに含めるのは、(1)本RPCの新設、(2)current_legal_document_versions()の
-- 新バージョンへの更新、(3)(1)に必要なREVOKE/GRANTのみ。既存データを書き換える
-- UPDATE文は含めない（既存のterms_consents/sns_live_result_comments行には一切触れない）。

begin;

create or replace function public.delete_own_sns_live_result_comment(p_comment_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_author_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select author_id into v_author_id from public.sns_live_result_comments where id = p_comment_id for update;
  if not found then
    raise exception 'COMMENT_NOT_FOUND';
  end if;
  if v_author_id <> auth.uid() then
    raise exception 'NOT_OWNER';
  end if;

  update public.sns_live_result_comments
    set is_hidden = true, hidden_reason = 'deleted_by_author', hidden_by = auth.uid(), hidden_at = now()
    where id = p_comment_id and not is_hidden;
end;
$$;

revoke execute on function public.delete_own_sns_live_result_comment(uuid) from public;
revoke execute on function public.delete_own_sns_live_result_comment(uuid) from anon;
grant execute on function public.delete_own_sns_live_result_comment(uuid) to authenticated;

-- current_legal_document_versions()自体の権限（0087でpublic/anon/authenticatedの
-- 直接EXECUTEをrevoke済み）はcreate or replaceでは変更されないため、ここでは
-- 本体だけを更新する（この関数への直接アクセスは、内部でSECURITY DEFINER経由で
-- これを呼ぶrecord_terms_consent_v2等に一本化されている）。
create or replace function public.current_legal_document_versions()
returns table (terms_version text, privacy_version text)
language sql
stable
as $$
  select '2026-10-10-v3'::text, '2026-10-10-v4'::text;
$$;

commit;
