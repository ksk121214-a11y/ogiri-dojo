-- 0043で「コメント(sns_comments)は寄合券を消費しない仕様」としていたが、
-- お題・回答と同じくツッコミ（コメント）投稿も寄合券を1枚消費する仕様に変更する。
-- submit_sns_topic/submit_sns_answer（0043）と全く同じパターン
-- （券消費と投稿保存を同一トランザクションで実行、直接INSERTポリシーは廃止して
-- RPC経由でしか作成できないようにする）をコメントにも適用する。

create function public.submit_sns_comment(p_answer_id uuid, p_body text)
returns public.sns_comments
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
  v_suspended boolean;
  v_ok boolean;
  v_row public.sns_comments;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  if not exists (select 1 from public.sns_answers where id = p_answer_id) then
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

  v_ok := public.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_comments (answer_id, author_id, body) values (p_answer_id, auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_sns_comment(uuid, text) to authenticated;

-- 直接INSERTを廃止（このRPC経由でしか作成できないようにする。sns_topics/sns_answersと同様）。
drop policy if exists "sns_comments_insert_own" on public.sns_comments;
