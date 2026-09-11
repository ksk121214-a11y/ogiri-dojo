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
--
-- 2026-09-16（再レビュー対応・追加修正）：本番未適用のためこの0067自体を修正する
-- （0068は作らない、0001〜0066は書き換えない）。
-- 【問題】submit_sns_answer/submit_sns_comment（0061時点の実装）は「親レコードが
-- 存在するか」だけを確認しており、is_hiddenを見ていなかった。そのため、別端末で
-- 削除前の詳細画面を開いたまま投稿すると、削除済みのお題へ回答・削除済みの回答へ
-- ツッコミが成立してしまい（寄合券は消費される一方、RLS強化により誰にも表示され
-- ない「幽霊投稿」が残る）可能性があった。
-- 【対応】submit_sns_answer/submit_sns_commentを、親（お題／お題+回答）をFOR SHARE
-- でロックしてからis_hiddenを確認するように変更する（0061のロジック・grant/revoke
-- 自体は維持し、親確認の部分だけを強化する）。FOR KEY SHAREではなくFOR SHAREを使う
-- 理由：delete_own_sns_topic/answerが行う「is_hidden等（主キー以外）を書き換える
-- 普通のUPDATE」はPostgresの内部分類ではNO KEY UPDATEであり、FOR KEY SHAREはNO KEY
-- UPDATEと競合しない（＝ロックしたつもりで削除を止められない）。FOR SHAREはNO KEY
-- UPDATEとも競合するため、削除処理と確実に直列化できる。
-- ロック順序：submit_sns_commentは「お題→回答」の順でFOR SHAREを取る。これは
-- delete_own_sns_topicが「お題をFOR UPDATE→配下の回答をUPDATE（内部的に行ロック）」
-- という同じ順序で処理するのと揃えてあり、逆順ロックによるデッドロックを避ける。
-- delete_own_sns_answerは回答のみをFOR UPDATEし、お題のロックを取らないため、
-- submit_sns_comment（お題→回答）との間でも循環待ちは発生しない
-- （delete_own_sns_answer側がお題のロックを一切必要としないため）。
-- 親の確認・ロックは、寄合券消費（private.consume_ticket_for_user）より必ず前に
-- 行い、ロック自体は関数の終わり（INSERT完了）までトランザクション内で保持される
-- （PL/pgSQL関数呼び出し全体が1トランザクションのため、明示的なUNLOCKは不要）。
-- 削除RPC自体は変更していないが、途中失敗後の再適用に強くするため
-- create or replaceに統一し、この0067全体をBEGIN/COMMITで1トランザクションにする。

begin;

-- ============================================================
-- 1) delete_own_sns_topic：自分のお題を削除する（回答・ツッコミも道連れで非表示）。
-- ============================================================
create or replace function public.delete_own_sns_topic(p_topic_id uuid)
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
create or replace function public.delete_own_sns_answer(p_answer_id uuid)
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
create or replace function public.delete_own_sns_comment(p_comment_id uuid)
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

-- ============================================================
-- 5) submit_sns_answer（0043・0061）を再強化：投稿先のお題をFOR SHAREでロックし、
--    存在かつis_hidden=falseのときだけ投稿を許可する（削除済みのお題への回答を防ぐ）。
--    0061のロジック（NOT_LOGGED_IN・利用停止確認・空文字/文字数制限・
--    private.consume_ticket_for_user経由の券消費・INSERT・SECURITY DEFINER・
--    search_path固定）はそのまま維持し、お題確認の部分だけを強化する。
-- ============================================================
create or replace function public.submit_sns_answer(p_topic_id uuid, p_body text)
returns public.sns_answers
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
  v_suspended boolean;
  v_ok boolean;
  v_row public.sns_answers;
  v_topic_hidden boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  -- 対象のお題をFOR SHAREでロックしてから存在・表示状態を確認する（寄合券消費より
  -- 前）。delete_own_sns_topicのFOR UPDATEと競合するため、削除処理と直列化される
  -- （このロックはINSERT完了まで、＝関数終了までトランザクション内で保持される）。
  select is_hidden into v_topic_hidden from public.sns_topics where id = p_topic_id for share;
  if not found or v_topic_hidden then
    raise exception 'TOPIC_NOT_FOUND';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  v_trimmed := trim(p_body);
  if v_trimmed is null or char_length(v_trimmed) = 0 then
    raise exception 'EMPTY_BODY';
  end if;
  if char_length(v_trimmed) > 300 then
    raise exception 'BODY_TOO_LONG';
  end if;

  v_ok := private.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_answers (topic_id, author_id, body) values (p_topic_id, auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.submit_sns_answer(uuid, text) from public;
revoke execute on function public.submit_sns_answer(uuid, text) from anon;
grant execute on function public.submit_sns_answer(uuid, text) to authenticated;

-- ============================================================
-- 6) submit_sns_comment（0058・0061）を再強化：投稿先の回答とその親お題を
--    「お題→回答」の順でFOR SHAREロックし、両方ともis_hidden=falseのときだけ
--    投稿を許可する（削除済みの回答・削除済みのお題配下の回答へのツッコミを防ぐ）。
--    0061のロジック自体はそのまま維持する。
-- ============================================================
create or replace function public.submit_sns_comment(p_answer_id uuid, p_body text)
returns public.sns_comments
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
  v_suspended boolean;
  v_ok boolean;
  v_row public.sns_comments;
  v_topic_id uuid;
  v_topic_hidden boolean;
  v_answer_hidden boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  -- どのお題をロックすべきかを知るためのtopic_id参照（topic_idは削除操作で
  -- 一切書き換わらない列のため、ロック無しで読んでも競合状態にならない）。
  select topic_id into v_topic_id from public.sns_answers where id = p_answer_id;
  if v_topic_id is null then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  -- ロック順は「お題→回答」（delete_own_sns_topicの処理順と揃え、逆順ロックに
  -- よるデッドロックを避ける）。寄合券消費より前に両方を確認する。
  select is_hidden into v_topic_hidden from public.sns_topics where id = v_topic_id for share;
  if not found or v_topic_hidden then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  select is_hidden into v_answer_hidden from public.sns_answers where id = p_answer_id for share;
  if not found or v_answer_hidden then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  v_trimmed := trim(p_body);
  if v_trimmed is null or char_length(v_trimmed) = 0 then
    raise exception 'EMPTY_BODY';
  end if;
  if char_length(v_trimmed) > 300 then
    raise exception 'BODY_TOO_LONG';
  end if;

  v_ok := private.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_comments (answer_id, author_id, body) values (p_answer_id, auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.submit_sns_comment(uuid, text) from public;
revoke execute on function public.submit_sns_comment(uuid, text) from anon;
grant execute on function public.submit_sns_comment(uuid, text) to authenticated;

commit;
