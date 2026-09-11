-- 寄合帳（SNS）で、自分の投稿（お題・回答・ツッコミ）を本人が削除できるようにする。
--
-- 方針：
-- - 物理削除ではなく、既存の運営者向け非表示フラグ（is_hidden/hidden_reason/
--   hidden_by/hidden_at、0021）をそのまま使う論理削除にする。通報記録（reports、
--   0022、target_idにFKが無いためis_hiddenに関わらず影響を受けない）や、運営者が
--   /admin/postsで確認する監査用データはそのまま残る。
-- - 寄合券（profiles.tickets_count等、0043）は一切触れない。お題・回答・ツッコミの
--   投稿はいずれも投稿時に1枚消費済みで、削除しても返却しない仕様のため、そもそも
--   このRPCから寄合券関連の列・関数を呼ぶ必要が無い。
-- - お題を削除した場合はそのお題の全回答・全ツッコミも、回答を削除した場合は
--   その回答の全ツッコミも、同じトランザクション内でまとめて非表示にする
--   （親子の非表示化をアトミックに行う）。巻き込まれた回答者・ツッコミ投稿者の
--   寄合券は変更しない（そもそも触れていない）。
-- - 冪等性：対象行が既に非表示なら何もしない（UPDATE ... WHERE NOT is_hidden が
--   0件更新になるだけ）。既に他の理由（運営者による非表示等）で隠れている子孫行の
--   hidden_reason/hidden_byは上書きしない（NOT is_hiddenの行だけを対象にする）。

-- ============================================================
-- 1) delete_own_sns_topic：自分のお題を削除する（回答・ツッコミも道連れで非表示）。
-- ============================================================
create function public.delete_own_sns_topic(p_topic_id uuid)
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

  -- 対象行をロックしてから所有者を確認する（連打・同時実行でも所有者確認と
  -- 更新の間に割り込まれない）。
  select author_id into v_author_id from public.sns_topics where id = p_topic_id for update;
  if not found then
    raise exception 'TOPIC_NOT_FOUND';
  end if;
  if v_author_id <> auth.uid() then
    raise exception 'NOT_OWNER';
  end if;

  update public.sns_topics
    set is_hidden = true, hidden_reason = 'deleted_by_author', hidden_by = auth.uid(), hidden_at = now()
    where id = p_topic_id and not is_hidden;

  update public.sns_answers
    set is_hidden = true, hidden_reason = 'deleted_by_author_topic_removed', hidden_by = auth.uid(), hidden_at = now()
    where topic_id = p_topic_id and not is_hidden;

  update public.sns_comments
    set is_hidden = true, hidden_reason = 'deleted_by_author_topic_removed', hidden_by = auth.uid(), hidden_at = now()
    where not is_hidden
      and answer_id in (select id from public.sns_answers where topic_id = p_topic_id);
end;
$$;

revoke execute on function public.delete_own_sns_topic(uuid) from public;
revoke execute on function public.delete_own_sns_topic(uuid) from anon;
grant execute on function public.delete_own_sns_topic(uuid) to authenticated;

-- ============================================================
-- 2) delete_own_sns_answer：自分の回答を削除する（ツッコミも道連れで非表示）。
-- ============================================================
create function public.delete_own_sns_answer(p_answer_id uuid)
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

  select author_id into v_author_id from public.sns_answers where id = p_answer_id for update;
  if not found then
    raise exception 'ANSWER_NOT_FOUND';
  end if;
  if v_author_id <> auth.uid() then
    raise exception 'NOT_OWNER';
  end if;

  update public.sns_answers
    set is_hidden = true, hidden_reason = 'deleted_by_author', hidden_by = auth.uid(), hidden_at = now()
    where id = p_answer_id and not is_hidden;

  update public.sns_comments
    set is_hidden = true, hidden_reason = 'deleted_by_author_answer_removed', hidden_by = auth.uid(), hidden_at = now()
    where answer_id = p_answer_id and not is_hidden;
end;
$$;

revoke execute on function public.delete_own_sns_answer(uuid) from public;
revoke execute on function public.delete_own_sns_answer(uuid) from anon;
grant execute on function public.delete_own_sns_answer(uuid) to authenticated;

-- ============================================================
-- 3) delete_own_sns_comment：自分のツッコミを削除する（他の投稿には影響しない）。
-- ============================================================
create function public.delete_own_sns_comment(p_comment_id uuid)
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

  select author_id into v_author_id from public.sns_comments where id = p_comment_id for update;
  if not found then
    raise exception 'COMMENT_NOT_FOUND';
  end if;
  if v_author_id <> auth.uid() then
    raise exception 'NOT_OWNER';
  end if;

  update public.sns_comments
    set is_hidden = true, hidden_reason = 'deleted_by_author', hidden_by = auth.uid(), hidden_at = now()
    where id = p_comment_id and not is_hidden;
end;
$$;

revoke execute on function public.delete_own_sns_comment(uuid) from public;
revoke execute on function public.delete_own_sns_comment(uuid) from anon;
grant execute on function public.delete_own_sns_comment(uuid) to authenticated;

-- ============================================================
-- 4) RLS強化：非表示のお題に属する回答・非表示のお題または回答に属するツッコミは、
--    そのIDを直接指定して取得しようとしても一般利用者には見えないようにする。
--    従来のsns_answers_select/sns_comments_selectは「自分自身のis_hidden」だけを
--    見ており、親（お題/回答）が非表示でも自分自身がis_hidden=falseなら見えて
--    しまっていた（このRPCでは道連れで子も非表示にするため通常は問題にならないが、
--    運営者が/admin/postsから親だけを非表示にした場合はこの抜け穴が残る）。
--    is_host()は従来どおり非表示分も含め全件閲覧可能なままにする
--    （/admin/postsの既存の非表示一覧・完全削除機能に影響しない）。
-- ============================================================
drop policy if exists "sns_answers_select" on public.sns_answers;
create policy "sns_answers_select" on public.sns_answers for select
  using (
    is_host()
    or (
      not is_hidden
      and exists (
        select 1 from public.sns_topics t
        where t.id = sns_answers.topic_id and not t.is_hidden
      )
    )
  );

drop policy if exists "sns_comments_select" on public.sns_comments;
create policy "sns_comments_select" on public.sns_comments for select
  using (
    is_host()
    or (
      not is_hidden
      and exists (
        select 1 from public.sns_answers a
        join public.sns_topics t on t.id = a.topic_id
        where a.id = sns_comments.answer_id and not a.is_hidden and not t.is_hidden
      )
    )
  );
