-- セキュリティレビュー対応 P1（6番）：
-- ローカルPostgreSQLで実際に確認・攻撃再現したところ、consume_ticket_for_user(uuid)
-- （0043）にEXECUTE権限のREVOKEが一度も行われていないことを確認した。
--
--   select p.proname, p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'consume_ticket_for_user';
--
-- proaclがNULL（＝関数のデフォルト権限のまま）で、PostgreSQLの関数は
-- デフォルトでPUBLICにEXECUTEが付与されるため、ログイン済みの誰でも
--   select consume_ticket_for_user('<他人のuser_id>');
-- を直接叩けば、任意の他人の寄合券を勝手に消費させられる（本人が投稿しようとした
-- 時に「寄合券が足りません」と表示させる嫌がらせ・DoSが可能）ことを実際に
-- 確認した。submit_sns_topic/submit_sns_answer/submit_sns_comment（0043・0058）は
-- いずれもauth.uid()（呼び出し本人のID）だけを渡しており、この関数自体が
-- 任意のIDを受け取れる形になっていたことが問題。
--
-- 【対応】
-- 1) consume_ticket_for_user(uuid)をpublicスキーマからprivateスキーマへ移す
--    （ALTER FUNCTION ... SET SCHEMA、関数の中身・所有者はそのまま）。
--    privateスキーマはUSAGE権限をPUBLIC/anon/authenticatedの誰にも付与しない
--    （PostgreSQLは新規スキーマ作成時にPUBLICへ自動でUSAGEを与えないため、
--    何も付与しなければ最初から到達不能）。Supabaseのpublic REST APIは
--    「Exposed schemas」に設定されたスキーマの関数しかRPCとして公開しない設定に
--    なっているはずで、privateスキーマは対象外になる想定
--    （念のため、本番のSupabaseダッシュボード側でAPI設定のExposed schemasに
--    privateが含まれていないことを確認してほしい。デフォルトはpublicのみ）。
-- 2) submit_sns_topic/submit_sns_answer/submit_sns_commentの呼び出し先を
--    private.consume_ticket_for_user(...)に更新する（create or replaceで
--    同じ関数を再定義するだけで、0043・0058自体は書き換えない）。
-- 3) 念のため明示的にEXECUTEをPUBLIC/anon/authenticatedからREVOKEしておく
--    （スキーマのUSAGEが無ければ実質到達できないが、多層防御として）。
--
-- 【レビュー指摘対応（0061適用前）】
-- privateスキーマがPostgreSQLの既定でPUBLICにUSAGEを与えないことに暗黙に
-- 依存していたが、「既存環境で万一privateスキーマが既に存在し、何らかの
-- 権限が付いていた場合」への備えが無かった。create schema if not existsの
-- 直後で明示的にrevoke all on schema privateを行い、既存の状態に関わらず
-- 確実にpublic/anon/authenticatedのアクセスが無い状態にする。

begin;

create schema if not exists private;

-- privateスキーマの権限を明示的に初期化する。create schema if not existsは
-- 既に存在する場合は何もしない（＝以前誰かが何らかの権限を付与していても
-- そのまま）ため、その後にこのrevokeを必ず実行することで、既存環境の状態に
-- 関わらず「PUBLIC/anon/authenticatedは一切アクセスできない」状態を保証する
-- （revoke all on schemaはUSAGE・CREATEの両方を対象にする。何も権限が
-- 付いていない状態に対して実行しても無害＝冪等）。
revoke all on schema private from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'consume_ticket_for_user'
  ) then
    alter function public.consume_ticket_for_user(uuid) set schema private;
  end if;
end $$;

revoke execute on function private.consume_ticket_for_user(uuid) from public;
revoke execute on function private.consume_ticket_for_user(uuid) from anon;
revoke execute on function private.consume_ticket_for_user(uuid) from authenticated;

-- submit_sns_topic/submit_sns_answer/submit_sns_comment（0043・0058）の
-- 呼び出し先だけをprivate.consume_ticket_for_userに向け直す。ロジック・
-- エラーメッセージ・引数は一切変更しない。
create or replace function public.submit_sns_topic(p_body text)
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

  v_ok := private.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_topics (author_id, body) values (auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

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

  v_ok := private.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_answers (topic_id, author_id, body) values (p_topic_id, auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

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

  v_ok := private.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_comments (answer_id, author_id, body) values (p_answer_id, auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

-- 3関数のgrant/revoke自体は0043・0058から変更なし（再掲する必要はないが、
-- create or replaceでは既存のgrantは維持されるため、念のため状態を明示しておく）。
grant execute on function public.submit_sns_topic(text) to authenticated;
grant execute on function public.submit_sns_answer(uuid, text) to authenticated;
grant execute on function public.submit_sns_comment(uuid, text) to authenticated;

commit;
