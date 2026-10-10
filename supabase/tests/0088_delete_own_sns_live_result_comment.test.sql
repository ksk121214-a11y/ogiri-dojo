-- 0088 回帰テスト：ライブ結果コメント(sns_live_result_comments)を本人が削除できる
-- RPC(delete_own_sns_live_result_comment)の権限・所有者確認・論理削除・可視性・冪等性・
-- 他経路（直接UPDATE/DELETE）が開いていないことを確認する。実行方法はsupabase/tests/run.sh参照。
-- フィクスチャ構成は0068_sns_live_result_likes_rls.test.sqlと同じ
-- (lives→groups→topics→turns→participants→answers→sns_live_results→
-- sns_live_result_answers)の、本番・公開済み・掲載対象の1件だけを使う。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('e8800000-0000-0000-0000-00000000000a'), -- userA（commentAの投稿者）
  ('e8800000-0000-0000-0000-00000000000b'), -- userB（commentBの投稿者、userAの通報・傍観者役も兼ねる）
  ('e8800000-0000-0000-0000-00000000000f')  -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'e8800000-0000-0000-0000-00000000000f';

-- ============================================================
-- テスト0: PUBLIC/anonはEXECUTE権限を持たず、anonロールで実行しても到達できない。
-- ============================================================
do $$
begin
  if has_function_privilege('public', 'delete_own_sns_live_result_comment(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'delete_own_sns_live_result_comment(uuid)', 'EXECUTE') then
    raise exception 'FAIL: delete_own_sns_live_result_comment のEXECUTE権限がPUBLIC/anonに付与されている';
  end if;
  raise notice 'PASS: PUBLIC/anon はdelete_own_sns_live_result_commentのEXECUTE権限を持たない';
end $$;

do $$
begin
  set local role anon;
  begin
    perform public.delete_own_sns_live_result_comment(gen_random_uuid());
    raise exception 'FAIL: anonがdelete_own_sns_live_result_commentを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 匿名ユーザーはdelete_own_sns_live_result_commentに到達できない (insufficient_privilege)';
  end;
end $$;

-- ============================================================
-- テストデータ準備：本番・公開済み・掲載対象のライブ結果1件に、userA・userBそれぞれ
-- 1件ずつコメントを付けておく。
-- ============================================================
insert into public.lives
  (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
values
  ('e8810000-0000-0000-0000-000000000001', now(), 'closed', 'official', 988001, true);

insert into public.groups (id, live_id, group_order) values
  ('e8811000-0000-0000-0000-000000000001', 'e8810000-0000-0000-0000-000000000001', 1);

insert into public.topics (id, live_id, body) values
  ('e8812000-0000-0000-0000-000000000001', 'e8810000-0000-0000-0000-000000000001', 'お題（0088テスト用）');

insert into public.turns (id, live_id, round, group_id, topic_id, status) values
  ('e8813000-0000-0000-0000-000000000001', 'e8810000-0000-0000-0000-000000000001', 1, 'e8811000-0000-0000-0000-000000000001', 'e8812000-0000-0000-0000-000000000001', 'done');

insert into public.participants (id, live_id, user_id, group_id, role) values
  ('e8814000-0000-0000-0000-000000000001', 'e8810000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-00000000000a', 'e8811000-0000-0000-0000-000000000001', 'player');

insert into public.answers (id, turn_id, participant_id, seq, body) values
  ('e8815000-0000-0000-0000-000000000001', 'e8813000-0000-0000-0000-000000000001', 'e8814000-0000-0000-0000-000000000001', 1, '回答（0088テスト用）');

insert into public.sns_live_results (id, live_id) values
  ('e8816000-0000-0000-0000-000000000001', 'e8810000-0000-0000-0000-000000000001');

insert into public.sns_live_result_answers (id, live_result_id, answer_id, rank, included) values
  ('e8817000-0000-0000-0000-000000000001', 'e8816000-0000-0000-0000-000000000001', 'e8815000-0000-0000-0000-000000000001', 1, true);

insert into public.sns_live_result_comments (id, result_answer_id, author_id, body) values
  ('e8818000-0000-0000-0000-000000000001', 'e8817000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-00000000000a', 'commentA本文'),
  ('e8818000-0000-0000-0000-000000000002', 'e8817000-0000-0000-0000-000000000001', 'e8800000-0000-0000-0000-00000000000b', 'commentB本文');

-- ============================================================
-- テスト1: 未ログイン（authenticatedロールだがauth.uid()がnull）はNOT_LOGGED_IN。
-- ============================================================
do $$
begin
  set local role authenticated;
  begin
    perform public.delete_own_sns_live_result_comment('e8818000-0000-0000-0000-000000000001');
    raise exception 'FAIL: 未ログインでも削除できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_LOGGED_IN' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 未ログインはNOT_LOGGED_INで拒否される';
  end;
end $$;
reset role;

-- ============================================================
-- テスト2: 他人（userB）はcommentA（userA所有）を削除できない (NOT_OWNER)。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8800000-0000-0000-0000-00000000000b', true);
  begin
    perform public.delete_own_sns_live_result_comment('e8818000-0000-0000-0000-000000000001');
    raise exception 'FAIL: 他人のコメントを削除できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_OWNER' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 他人のコメントは削除できない (NOT_OWNER)';
  end;
end $$;
reset role;

-- ============================================================
-- テスト3: 存在しないIDはCOMMENT_NOT_FOUND。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8800000-0000-0000-0000-00000000000a', true);
  begin
    perform public.delete_own_sns_live_result_comment(gen_random_uuid());
    raise exception 'FAIL: 存在しないコメントを削除できてしまった';
  exception
    when others then
      if sqlerrm <> 'COMMENT_NOT_FOUND' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 存在しないコメントはCOMMENT_NOT_FOUNDで拒否される';
  end;
end $$;
reset role;

-- ============================================================
-- テスト4: 本人（userA）がcommentAを削除すると、論理削除の4列が正しく設定される。
--          他人のcommentB（対照群）は無傷のまま。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8800000-0000-0000-0000-00000000000a', true);
  perform public.delete_own_sns_live_result_comment('e8818000-0000-0000-0000-000000000001');
end $$;
reset role;

do $$
declare
  v_is_hidden boolean;
  v_hidden_reason text;
  v_hidden_by uuid;
  v_hidden_at timestamptz;
  v_commentb_is_hidden boolean;
begin
  -- RLSを経由せず（テーブル所有者権限で）実際の列値を直接確認する。
  select is_hidden, hidden_reason, hidden_by, hidden_at
    into v_is_hidden, v_hidden_reason, v_hidden_by, v_hidden_at
    from public.sns_live_result_comments where id = 'e8818000-0000-0000-0000-000000000001';
  if v_is_hidden is not true then raise exception 'FAIL: is_hiddenがtrueになっていない'; end if;
  if v_hidden_reason <> 'deleted_by_author' then raise exception 'FAIL: hidden_reasonが想定と違う(%)', v_hidden_reason; end if;
  if v_hidden_by <> 'e8800000-0000-0000-0000-00000000000a' then raise exception 'FAIL: hidden_byが本人のidになっていない'; end if;
  if v_hidden_at is null then raise exception 'FAIL: hidden_atが設定されていない'; end if;

  select is_hidden into v_commentb_is_hidden from public.sns_live_result_comments where id = 'e8818000-0000-0000-0000-000000000002';
  if v_commentb_is_hidden is not false then raise exception 'FAIL: 他人のcommentBまで非表示になってしまった'; end if;

  raise notice 'PASS: 本人の削除はis_hidden=true/hidden_reason=deleted_by_author/hidden_by=本人/hidden_at設定の論理削除として反映され、他人のコメントは無傷';
end $$;

-- ============================================================
-- テスト5: 削除後のRLS可視性。本人(userA)・他人(userB)のいずれからも見えなくなり、
--          運営(is_host())だけは引き続き確認できる。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8800000-0000-0000-0000-00000000000a', true);
  select count(*) into v_count from public.sns_live_result_comments where id = 'e8818000-0000-0000-0000-000000000001';
  if v_count <> 0 then raise exception 'FAIL: 削除後も本人からコメントが見えてしまった'; end if;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8800000-0000-0000-0000-00000000000b', true);
  select count(*) into v_count from public.sns_live_result_comments where id = 'e8818000-0000-0000-0000-000000000001';
  if v_count <> 0 then raise exception 'FAIL: 削除後も他人からコメントが見えてしまった'; end if;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8800000-0000-0000-0000-00000000000f', true);
  select count(*) into v_count from public.sns_live_result_comments where id = 'e8818000-0000-0000-0000-000000000001';
  if v_count <> 1 then raise exception 'FAIL: 運営(is_host())から削除済みコメントが確認できない'; end if;
  raise notice 'PASS: 削除後は本人・他人のいずれからも見えなくなり、運営(is_host())だけは引き続き確認できる';
end $$;
reset role;

-- ============================================================
-- テスト6: 冪等性。既に削除済みのコメントへ再度同じRPCを呼んでもエラーにならず
--          （NOT_OWNER/COMMENT_NOT_FOUNDにならない）、hidden_atも変化しない。
-- ============================================================
do $$
declare
  v_hidden_at_before timestamptz;
  v_hidden_at_after timestamptz;
begin
  select hidden_at into v_hidden_at_before from public.sns_live_result_comments where id = 'e8818000-0000-0000-0000-000000000001';

  set local role authenticated;
  perform set_config('myapp.uid', 'e8800000-0000-0000-0000-00000000000a', true);
  perform public.delete_own_sns_live_result_comment('e8818000-0000-0000-0000-000000000001');
  reset role;

  select hidden_at into v_hidden_at_after from public.sns_live_result_comments where id = 'e8818000-0000-0000-0000-000000000001';
  if v_hidden_at_after is distinct from v_hidden_at_before then
    raise exception 'FAIL: 冪等性が無く、再実行でhidden_atが変化した';
  end if;
  raise notice 'PASS: 削除済みコメントへの再実行はエラーにならず、hidden_atも変化しない（冪等）';
end $$;

-- ============================================================
-- テスト7: 他経路（RPCを経由しない直接UPDATE/DELETE）は開いていない。本人による
--          直接UPDATEはRLS(sns_live_result_comments_write_host、is_host()限定)に
--          阻まれる。commentB（まだ非表示化していない、本人=userB）で確認する。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8800000-0000-0000-0000-00000000000b', true);
  update public.sns_live_result_comments set is_hidden = true where id = 'e8818000-0000-0000-0000-000000000002';
  if found then
    raise exception 'FAIL: 本人による直接UPDATEがRLSに阻まれず成功してしまった';
  end if;
  raise notice 'PASS: 本人による直接UPDATEは、RPCを経由しない限り何も更新できない（RLSは緩めていない）';
end $$;
reset role;

do $$
declare
  v_commentb_is_hidden boolean;
begin
  select is_hidden into v_commentb_is_hidden from public.sns_live_result_comments where id = 'e8818000-0000-0000-0000-000000000002';
  if v_commentb_is_hidden is not false then raise exception 'FAIL: commentBが直接UPDATEで非表示化されてしまった'; end if;
end $$;

select 'ALL 0088_DELETE_OWN_SNS_LIVE_RESULT_COMMENT TESTS PASSED' as result;
