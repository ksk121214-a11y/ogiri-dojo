-- 初回ライブ実開催前レビュー対応（3・4）：
-- 「寄合券」がこれまでuseTicketStore.ts（ブラウザのlocalStorageのみ）で管理されており、
-- 端末側の値を書き換える／Supabaseへ直接投稿するだけで消費を回避できた。
-- あわせて、お題・回答・コメントの投稿はSupabase保存に失敗してもローカルに
-- ダミーの投稿を足して「成功したように見せる」実装になっており、リロードで
-- 消える・寄合券だけ減る、という不整合が起き得た。
--
-- 対応方針：
-- - 寄合券の残数・回復時刻を profiles に持たせ、消費と投稿保存を
--   1つのsecurity definer RPC内で原子的に行う（行ロックで同時実行にも対応）。
-- - お題(sns_topics)・回答(sns_answers)の直接INSERTポリシーを廃止し、
--   このRPC経由でしか作成できないようにする（券消費のバイパスを塞ぐ）。
-- - コメント(sns_comments)は寄合券を消費しない仕様のため、直接INSERTポリシー・
--   券管理のどちらも今回は変更しない。

-- ============================================================
-- 1) 寄合券の残数・回復時刻をprofilesに追加
-- ============================================================
-- 初期値は全員5枚（既存ユーザーも含め、ローカルのlocalStorage側の残数は
-- 移行せずリセットする。寄合券は消費用のスタミナ値であり過去の残数を
-- 正確に引き継ぐ実利が薄いため、単純に満タンから始める）。
alter table public.profiles
  add column if not exists tickets_count int not null default 5,
  add column if not exists tickets_next_recovery_at timestamptz;

alter table public.profiles
  add constraint profiles_tickets_count_range check (tickets_count between 0 and 5);

-- ============================================================
-- 2) 消費＋回復計算の内部ヘルパー（authenticatedへは公開しない、
--    submit_sns_topic/submit_sns_answerからのみ呼ばれる想定）。
--    ロジックはsrc/store/useTicketStore.tsのcomputeRecovery/consumeと同一にしてある。
-- ============================================================
create or replace function public.consume_ticket_for_user(p_user_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_count int;
  v_next timestamptz;
  v_now timestamptz := now();
  v_recovered_intervals int;
begin
  select tickets_count, tickets_next_recovery_at into v_count, v_next
    from public.profiles where id = p_user_id for update;

  if not found then
    return false;
  end if;

  if v_next is not null and v_count < 5 and v_now >= v_next then
    v_recovered_intervals := floor(extract(epoch from (v_now - v_next)) / 3600) + 1;
    v_count := least(5, v_count + v_recovered_intervals);
    if v_count >= 5 then
      v_next := null;
    else
      v_next := v_next + (v_recovered_intervals * interval '1 hour');
    end if;
  end if;

  if v_count <= 0 then
    update public.profiles set tickets_count = v_count, tickets_next_recovery_at = v_next
      where id = p_user_id;
    return false;
  end if;

  v_count := v_count - 1;
  if v_next is null then
    v_next := v_now + interval '1 hour';
  end if;

  update public.profiles set tickets_count = v_count, tickets_next_recovery_at = v_next
    where id = p_user_id;
  return true;
end;
$$;

-- ============================================================
-- 3) お題・回答の投稿RPC（券消費＋投稿保存を同一トランザクションで実行）
-- ============================================================
create function public.submit_sns_topic(p_body text)
returns public.sns_topics
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
  v_suspended boolean;
  v_ok boolean;
  v_row public.sns_topics;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
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

  insert into public.sns_topics (author_id, body) values (auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

create function public.submit_sns_answer(p_topic_id uuid, p_body text)
returns public.sns_answers
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
  v_suspended boolean;
  v_ok boolean;
  v_row public.sns_answers;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  if not exists (select 1 from public.sns_topics where id = p_topic_id) then
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

  v_ok := public.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_answers (topic_id, author_id, body) values (p_topic_id, auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_sns_topic(text) to authenticated;
grant execute on function public.submit_sns_answer(uuid, text) to authenticated;

-- ============================================================
-- 4) 直接INSERTを廃止（このRPC経由でしか作成できないようにする）
-- ============================================================
drop policy if exists "sns_topics_insert_own" on public.sns_topics;
drop policy if exists "sns_answers_insert_own" on public.sns_answers;
-- sns_comments_insert_own（寄合券を消費しない）はそのまま維持する。
