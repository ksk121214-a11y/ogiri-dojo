-- 通報（reports）の権限境界：会員は自分名義で保存でき、未ログイン・ゲスト・なりすましは拒否される。
-- 実行方法は supabase/tests/run.sh 参照。マイグレーションは変更しない（現行のRLSの確認のみ）。

\set ON_ERROR_STOP on

insert into auth.users (id, is_anonymous) values
  ('c0000000-0000-0000-0000-00000000000b', false), -- 会員
  ('c0000000-0000-0000-0000-00000000000c', false), -- 別の会員
  ('c0000000-0000-0000-0000-00000000001a', true)   -- ゲスト
on conflict do nothing;

do $$
declare
  v_target uuid := 'c1000000-0000-0000-0000-000000000001';
  v_count int;
  v_failed boolean;
begin
  -- 会員は自分名義で通報を1件保存できる。
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000b', true);
  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
    values ('c0000000-0000-0000-0000-00000000000b', 'sns_topic', v_target, 'スパム', '通報テスト本文');
  -- 会員は通報一覧（運営専用）を読めない。
  select count(*) into v_count from public.reports;
  reset role;
  if v_count <> 0 then raise exception 'FAIL: 会員が通報一覧を読めてしまう(% 件)', v_count; end if;
  select count(*) into v_count from public.reports where target_id = v_target;
  if v_count <> 1 then raise exception 'FAIL: 会員の通報が1件保存されていない(% 件)', v_count; end if;
  raise notice 'PASS: 会員は自分名義で通報を1件保存でき、他人の通報は読めない';

  -- 他人名義でのなりすまし通報は拒否される。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000b', true);
  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
      values ('c0000000-0000-0000-0000-00000000000c', 'sns_topic', v_target, 'スパム', 'なりすまし');
  exception when others then
    if sqlerrm like '%row-level security%' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
  end;
  reset role;
  if not v_failed then raise exception 'FAIL: 他人名義の通報を保存できてしまった'; end if;
  raise notice 'PASS: 他人名義（なりすまし）の通報は拒否される';

  -- ゲストは直接INSERTできない。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000001a', true);
  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
      values ('c0000000-0000-0000-0000-00000000001a', 'sns_topic', v_target, 'スパム', 'ゲスト');
  exception when others then
    if sqlerrm like '%row-level security%' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
  end;
  reset role;
  if not v_failed then raise exception 'FAIL: ゲストが通報を保存できてしまった'; end if;
  raise notice 'PASS: ゲストは通報を保存できない';

  -- 未ログイン（anonロール・auth.uid()がnull）は保存できない。
  v_failed := false;
  set local role anon;
  perform set_config('myapp.uid', '', true);
  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
      values (null, 'sns_topic', v_target, 'スパム', '未ログイン');
  exception when others then
    if sqlerrm like '%row-level security%' or sqlerrm like '%permission denied%' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
  end;
  reset role;
  if not v_failed then raise exception 'FAIL: 未ログインが通報を保存できてしまった'; end if;
  select count(*) into v_count from public.reports where target_id = v_target;
  if v_count <> 1 then raise exception 'FAIL: 拒否されるべき通報が保存された(% 件)', v_count; end if;
  raise notice 'PASS: 未ログインは通報を保存できず、保存件数は1件のまま';
end $$;

-- 未ログイン（anonロール）は寄合帳の書き込み系（お題・回答・ツッコミのRPC、いいね・フォローの直接INSERT）も実行できない。
do $$
declare
  v_id uuid := 'c1000000-0000-0000-0000-000000000009';
  v_failed boolean;
begin
  set local role anon;
  perform set_config('myapp.uid', '', true);

  v_failed := false;
  begin perform public.submit_sns_topic('未ログインのお題');
  exception when others then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL: 未ログインがsubmit_sns_topicを実行できた'; end if;

  v_failed := false;
  begin perform public.submit_sns_answer(v_id, '未ログインの回答');
  exception when others then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL: 未ログインがsubmit_sns_answerを実行できた'; end if;

  v_failed := false;
  begin perform public.submit_sns_comment(v_id, '未ログインのツッコミ');
  exception when others then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL: 未ログインがsubmit_sns_commentを実行できた'; end if;

  v_failed := false;
  begin insert into public.sns_answer_likes (answer_id, user_id) values (v_id, null);
  exception when others then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL: 未ログインがいいねをINSERTできた'; end if;

  v_failed := false;
  begin insert into public.sns_follows (follower_id, following_id) values (null, 'c0000000-0000-0000-0000-00000000000b');
  exception when others then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL: 未ログインがフォローをINSERTできた'; end if;

  reset role;
  raise notice 'PASS: 未ログインはお題・回答・ツッコミ・いいね・フォローのいずれも実行できない';
end $$;
