-- P1-6 権限回帰テスト（0061対応）。実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('e0000000-0000-0000-0000-00000000000a'), -- 攻撃者
  ('e0000000-0000-0000-0000-00000000000b')  -- 被害者
on conflict do nothing;

-- ============================================================
-- テスト0: PUBLIC/anon/authenticatedのいずれもprivate.consume_ticket_for_user
--          へのEXECUTE権限自体を持っていない（レビュー指摘対応、スキーマの
--          USAGEに頼らずGRANT/REVOKEの状態そのものを直接確認する）。
-- ============================================================
do $$
begin
  if has_function_privilege('public', 'private.consume_ticket_for_user(uuid)', 'EXECUTE') then
    raise exception 'FAIL: PUBLICがprivate.consume_ticket_for_userのEXECUTEを持っている';
  end if;
  if has_function_privilege('anon', 'private.consume_ticket_for_user(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anonがprivate.consume_ticket_for_userのEXECUTEを持っている';
  end if;
  if has_function_privilege('authenticated', 'private.consume_ticket_for_user(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticatedがprivate.consume_ticket_for_userのEXECUTEを持っている';
  end if;
  raise notice 'PASS: PUBLIC/anon/authenticatedいずれもprivate.consume_ticket_for_userのEXECUTE権限を持たない';
end $$;

-- ============================================================
-- テスト0b: privateスキーマ自体へのUSAGE権限も、PUBLIC/anon/authenticatedの
--          誰も持っていない（レビュー指摘対応：既存環境で万一privateスキーマが
--          既に存在し何らかの権限が付いていた場合にも安全であることの確認）。
-- ============================================================
do $$
begin
  if has_schema_privilege('public', 'private', 'USAGE') then
    raise exception 'FAIL: PUBLICがprivateスキーマのUSAGEを持っている';
  end if;
  if has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'FAIL: anonがprivateスキーマのUSAGEを持っている';
  end if;
  if has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'FAIL: authenticatedがprivateスキーマのUSAGEを持っている';
  end if;
  raise notice 'PASS: PUBLIC/anon/authenticatedいずれもprivateスキーマのUSAGE権限を持たない';
end $$;

-- ============================================================
-- テスト1: 一般ユーザーがprivate.consume_ticket_for_userへ到達できない
--          （スキーマUSAGE自体が無い）。他人のticketsを勝手に減らせないことを
--          直接確認する（P1-6の核心）。
-- ============================================================
do $$
declare
  v_before int;
  v_after int;
begin
  select tickets_count into v_before from public.profiles where id = 'e0000000-0000-0000-0000-00000000000b';

  set local role authenticated;
  perform set_config('myapp.uid', 'e0000000-0000-0000-0000-00000000000a', true);

  begin
    perform private.consume_ticket_for_user('e0000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL: 攻撃者が他人のticketsをprivate.consume_ticket_for_user経由で消費できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: privateスキーマ自体に到達できない(insufficient_privilege)';
  end;

  reset role;
  select tickets_count into v_after from public.profiles where id = 'e0000000-0000-0000-0000-00000000000b';
  if v_after <> v_before then
    raise exception 'FAIL: 被害者のticketsが減ってしまっている(before=%, after=%)', v_before, v_after;
  end if;
  raise notice 'PASS: 被害者のticketsは減っていない';
end $$;

-- ============================================================
-- テスト2: anonも同様に到達できない。
-- ============================================================
do $$
begin
  set local role anon;
  begin
    perform private.consume_ticket_for_user('e0000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL: anonがprivate.consume_ticket_for_userを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonもprivate.consume_ticket_for_userに到達できない';
  end;
end $$;

-- ============================================================
-- テスト3: 正規のsubmit_sns_topic/submit_sns_answer/submit_sns_comment経由の
--          投稿・券消費は引き続き正常に動く（回帰確認）。
-- ============================================================
do $$
declare
  v_before int;
  v_after int;
  v_topic_id uuid;
  v_answer_id uuid;
begin
  select tickets_count into v_before from public.profiles where id = 'e0000000-0000-0000-0000-00000000000b';

  set local role authenticated;
  perform set_config('myapp.uid', 'e0000000-0000-0000-0000-00000000000b', true);

  select id into v_topic_id from public.submit_sns_topic('P1-6回帰テスト用のお題');
  select id into v_answer_id from public.submit_sns_answer(v_topic_id, 'P1-6回帰テスト用の回答');
  perform public.submit_sns_comment(v_answer_id, 'P1-6回帰テスト用のツッコミ');

  reset role;
  select tickets_count into v_after from public.profiles where id = 'e0000000-0000-0000-0000-00000000000b';
  if v_after <> v_before - 3 then
    raise exception 'FAIL: 正規経路での券消費が想定と異なる(before=%, after=%, 期待=%)', v_before, v_after, v_before - 3;
  end if;
  if not exists (select 1 from public.sns_topics where id = v_topic_id) then
    raise exception 'FAIL: submit_sns_topicで投稿が保存されなかった';
  end if;
  if not exists (select 1 from public.sns_answers where id = v_answer_id) then
    raise exception 'FAIL: submit_sns_answerで回答が保存されなかった';
  end if;
  if not exists (select 1 from public.sns_comments where answer_id = v_answer_id) then
    raise exception 'FAIL: submit_sns_commentでコメントが保存されなかった';
  end if;

  raise notice 'PASS: submit_sns_topic/submit_sns_answer/submit_sns_commentは引き続き正常に動作し、券も正しく消費される';
end $$;

select 'ALL P1-6 TESTS PASSED' as result;
