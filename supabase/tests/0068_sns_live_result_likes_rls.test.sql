-- 0068 回帰テスト：sns_live_result_likes_select のRLS強化。
--
-- 背景：0031で定義されたsns_live_result_likes_selectは
--   using (true)
-- のまま、以降のマイグレーション（0068の「9) 寄合帳側のRLSポリシー」を含む）でも
-- 一度も絞られておらず、誰でも全行（テストライブ・非公開ライブ・除外された回答を
-- 含む）のuser_id・いいね履歴を読める状態だった。insert_own（0031・0068で
-- live_mode='official'条件が追加済み）と対称の条件へ絞ったことを確認する。
--
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('e8000000-0000-0000-0000-00000000000a'), -- userA（いいねする本人）
  ('e8000000-0000-0000-0000-00000000000b'), -- userB（別の一般ユーザー）
  ('e8000000-0000-0000-0000-00000000000f')  -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'e8000000-0000-0000-0000-00000000000f';

-- ============================================================
-- フィクスチャ：4パターンのライブ・回答を用意する。
--   1) official_published_included: 本番・公開済み・掲載対象  → 読める/追加できる
--   2) official_published_excluded: 本番・公開済みだが除外(included=false) → 不可
--   3) test_live:                   テストライブ（0068によりresults_published=falseに
--                                    強制されるため、これ単体で「テストライブ」と
--                                    「非公開」の両方の条件を代表する）        → 不可
--   4) official_unpublished:        本番だが未公開(results_published=false)   → 不可
-- ============================================================
insert into public.lives
  (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
values
  ('e8100000-0000-0000-0000-000000000001', now(), 'closed', 'official', 987001, true),
  ('e8100000-0000-0000-0000-000000000002', now(), 'closed', 'official', 987002, true),
  ('e8100000-0000-0000-0000-000000000003', now(), 'closed', 'test', null, false),
  ('e8100000-0000-0000-0000-000000000004', now(), 'closed', 'official', 987004, false);

insert into public.groups (id, live_id, group_order) values
  ('e8110000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-000000000001', 1),
  ('e8110000-0000-0000-0000-000000000002', 'e8100000-0000-0000-0000-000000000002', 1),
  ('e8110000-0000-0000-0000-000000000003', 'e8100000-0000-0000-0000-000000000003', 1),
  ('e8110000-0000-0000-0000-000000000004', 'e8100000-0000-0000-0000-000000000004', 1);

insert into public.topics (id, live_id, body) values
  ('e8120000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-000000000001', 'お題1（公開・掲載対象）'),
  ('e8120000-0000-0000-0000-000000000002', 'e8100000-0000-0000-0000-000000000002', 'お題2（公開・除外）'),
  ('e8120000-0000-0000-0000-000000000003', 'e8100000-0000-0000-0000-000000000003', 'お題3（テストライブ）'),
  ('e8120000-0000-0000-0000-000000000004', 'e8100000-0000-0000-0000-000000000004', 'お題4（本番・未公開）');

insert into public.turns (id, live_id, round, group_id, topic_id, status) values
  ('e8130000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-000000000001', 1, 'e8110000-0000-0000-0000-000000000001', 'e8120000-0000-0000-0000-000000000001', 'done'),
  ('e8130000-0000-0000-0000-000000000002', 'e8100000-0000-0000-0000-000000000002', 1, 'e8110000-0000-0000-0000-000000000002', 'e8120000-0000-0000-0000-000000000002', 'done'),
  ('e8130000-0000-0000-0000-000000000003', 'e8100000-0000-0000-0000-000000000003', 1, 'e8110000-0000-0000-0000-000000000003', 'e8120000-0000-0000-0000-000000000003', 'done'),
  ('e8130000-0000-0000-0000-000000000004', 'e8100000-0000-0000-0000-000000000004', 1, 'e8110000-0000-0000-0000-000000000004', 'e8120000-0000-0000-0000-000000000004', 'done');

insert into public.participants (id, live_id, user_id, group_id, role) values
  ('e8140000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-00000000000a', 'e8110000-0000-0000-0000-000000000001', 'player'),
  ('e8140000-0000-0000-0000-000000000002', 'e8100000-0000-0000-0000-000000000002', 'e8000000-0000-0000-0000-00000000000a', 'e8110000-0000-0000-0000-000000000002', 'player'),
  ('e8140000-0000-0000-0000-000000000003', 'e8100000-0000-0000-0000-000000000003', 'e8000000-0000-0000-0000-00000000000a', 'e8110000-0000-0000-0000-000000000003', 'player'),
  ('e8140000-0000-0000-0000-000000000004', 'e8100000-0000-0000-0000-000000000004', 'e8000000-0000-0000-0000-00000000000a', 'e8110000-0000-0000-0000-000000000004', 'player');

insert into public.answers (id, turn_id, participant_id, seq, body) values
  ('e8150000-0000-0000-0000-000000000001', 'e8130000-0000-0000-0000-000000000001', 'e8140000-0000-0000-0000-000000000001', 1, '回答1'),
  ('e8150000-0000-0000-0000-000000000002', 'e8130000-0000-0000-0000-000000000002', 'e8140000-0000-0000-0000-000000000002', 1, '回答2'),
  ('e8150000-0000-0000-0000-000000000003', 'e8130000-0000-0000-0000-000000000003', 'e8140000-0000-0000-0000-000000000003', 1, '回答3'),
  ('e8150000-0000-0000-0000-000000000004', 'e8130000-0000-0000-0000-000000000004', 'e8140000-0000-0000-0000-000000000004', 1, '回答4');

insert into public.sns_live_results (id, live_id) values
  ('e8160000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-000000000001'),
  ('e8160000-0000-0000-0000-000000000002', 'e8100000-0000-0000-0000-000000000002'),
  ('e8160000-0000-0000-0000-000000000003', 'e8100000-0000-0000-0000-000000000003'),
  ('e8160000-0000-0000-0000-000000000004', 'e8100000-0000-0000-0000-000000000004');

insert into public.sns_live_result_answers (id, live_result_id, answer_id, rank, included) values
  ('e8170000-0000-0000-0000-000000000001', 'e8160000-0000-0000-0000-000000000001', 'e8150000-0000-0000-0000-000000000001', 1, true),  -- ra1: official_published_included
  ('e8170000-0000-0000-0000-000000000002', 'e8160000-0000-0000-0000-000000000002', 'e8150000-0000-0000-0000-000000000002', 1, false), -- ra2: official_published_excluded
  ('e8170000-0000-0000-0000-000000000003', 'e8160000-0000-0000-0000-000000000003', 'e8150000-0000-0000-0000-000000000003', 1, true),  -- ra3: test_live
  ('e8170000-0000-0000-0000-000000000004', 'e8160000-0000-0000-0000-000000000004', 'e8150000-0000-0000-0000-000000000004', 1, true);  -- ra4: official_unpublished

-- ============================================================
-- SELECT側の検証用に、userAのいいね行を4パターンぶん直接（RLSを経由せず、
-- テーブル所有者権限で）作っておく。「本来INSERTでは弾かれるはずの行が、
-- 何らかの理由で既に存在してしまっていた場合でも、SELECT側が独立して
-- ちゃんと絞る」ことまで確認するため、あえてINSERT側のガードを経由させない。
-- ============================================================
insert into public.sns_live_result_likes (id, result_answer_id, user_id) values
  ('e8180000-0000-0000-0000-000000000001', 'e8170000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-00000000000a'), -- like1: 読めるはず
  ('e8180000-0000-0000-0000-000000000002', 'e8170000-0000-0000-0000-000000000002', 'e8000000-0000-0000-0000-00000000000a'), -- like2: included=falseなので読めないはず
  ('e8180000-0000-0000-0000-000000000003', 'e8170000-0000-0000-0000-000000000003', 'e8000000-0000-0000-0000-00000000000a'), -- like3: テストライブなので読めないはず
  ('e8180000-0000-0000-0000-000000000004', 'e8170000-0000-0000-0000-000000000004', 'e8000000-0000-0000-0000-00000000000a'); -- like4: 未公開なので読めないはず

-- ============================================================
-- テスト1: anonはいいね行を一切読めない（0件）。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role anon;
  select count(*) into v_count from public.sns_live_result_likes;
  if v_count <> 0 then
    raise exception 'FAIL: anonがいいね行を読めてしまった(count=%)', v_count;
  end if;
  raise notice 'PASS: anonはいいね行を一切読めない';
end $$;

-- ============================================================
-- テスト2: 別のauthenticatedユーザー（userB、いいねした本人ではない）は
--          他人のいいね行を一切読めない（0件、公開済み・掲載対象の行を含む）。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000b', true);
  select count(*) into v_count from public.sns_live_result_likes;
  if v_count <> 0 then
    raise exception 'FAIL: 別ユーザー(userB)が他人のいいね行を読めてしまった(count=%)', v_count;
  end if;
  raise notice 'PASS: 別のauthenticatedユーザーは他人のいいね行を一切読めない';
end $$;
reset role;

-- ============================================================
-- テスト3: 本人（userA）は、本番・公開済み・掲載対象(like1)だけ読める。
--          テストライブ(like3)・非公開(like4)・除外(like2)は、自分の行でも読めない。
-- ============================================================
do $$
declare
  v_total int;
  v_like1 int;
  v_like2 int;
  v_like3 int;
  v_like4 int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000a', true);

  select count(*) into v_total from public.sns_live_result_likes;
  if v_total <> 1 then
    raise exception 'FAIL: 本人から見えるいいね行の総数が想定と違う(想定=1, 実際=%)', v_total;
  end if;

  select count(*) into v_like1 from public.sns_live_result_likes where id = 'e8180000-0000-0000-0000-000000000001';
  if v_like1 <> 1 then raise exception 'FAIL: 本番・公開済み・掲載対象の自分のいいねが読めない'; end if;

  select count(*) into v_like2 from public.sns_live_result_likes where id = 'e8180000-0000-0000-0000-000000000002';
  if v_like2 <> 0 then raise exception 'FAIL: 除外(included=false)の自分のいいねが読めてしまった'; end if;

  select count(*) into v_like3 from public.sns_live_result_likes where id = 'e8180000-0000-0000-0000-000000000003';
  if v_like3 <> 0 then raise exception 'FAIL: テストライブの自分のいいねが読めてしまった'; end if;

  select count(*) into v_like4 from public.sns_live_result_likes where id = 'e8180000-0000-0000-0000-000000000004';
  if v_like4 <> 0 then raise exception 'FAIL: 非公開ライブの自分のいいねが読めてしまった'; end if;

  raise notice 'PASS: 本人は本番・公開済み・掲載対象の自分のいいねだけ読める（テスト/非公開/除外は自分の行でも読めない）';
end $$;
reset role;

-- ============================================================
-- テスト4: 運営(is_host())は、全パターンのいいね行を確認できる。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000f', true);
  select count(*) into v_count from public.sns_live_result_likes;
  if v_count <> 4 then
    raise exception 'FAIL: 運営から見えるいいね行の総数が想定と違う(想定=4, 実際=%)', v_count;
  end if;
  raise notice 'PASS: 運営(is_host())は全パターンのいいね行を確認できる';
end $$;
reset role;

-- ============================================================
-- テスト5: INSERT側（insert_own、既存条件のまま）の確認。userBが新規にいいねを
--          追加できるのは、本番・公開済み・掲載対象(ra1)の場合だけ。
--          除外(ra2)・テストライブ(ra3)・非公開(ra4)へは追加できない(42501)。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000b', true);
  insert into public.sns_live_result_likes (result_answer_id, user_id)
    values ('e8170000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-00000000000b');
  raise notice 'PASS: 本番・公開済み・掲載対象の回答へは新規にいいねを追加できる';
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000b', true);
  begin
    insert into public.sns_live_result_likes (result_answer_id, user_id)
      values ('e8170000-0000-0000-0000-000000000002', 'e8000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL: 除外(included=false)の回答へいいねを追加できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 除外(included=false)の回答へはいいねを追加できない';
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000b', true);
  begin
    insert into public.sns_live_result_likes (result_answer_id, user_id)
      values ('e8170000-0000-0000-0000-000000000003', 'e8000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL: テストライブの回答へいいねを追加できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: テストライブの回答へはいいねを追加できない';
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000b', true);
  begin
    insert into public.sns_live_result_likes (result_answer_id, user_id)
      values ('e8170000-0000-0000-0000-000000000004', 'e8000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL: 非公開ライブの回答へいいねを追加できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 非公開ライブの回答へはいいねを追加できない';
  end;
end $$;
reset role;

-- ============================================================
-- テスト6: テスト5で新規に追加したuserBのいいね(ra1)は、本人からは見えるが
--          userAからは見えない（他人の行のため）。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000b', true);
  select count(*) into v_count from public.sns_live_result_likes
    where result_answer_id = 'e8170000-0000-0000-0000-000000000001' and user_id = 'e8000000-0000-0000-0000-00000000000b';
  if v_count <> 1 then raise exception 'FAIL: userBが自分の新規いいねを読めない'; end if;
end $$;

do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e8000000-0000-0000-0000-00000000000a', true);
  select count(*) into v_count from public.sns_live_result_likes
    where result_answer_id = 'e8170000-0000-0000-0000-000000000001' and user_id = 'e8000000-0000-0000-0000-00000000000b';
  if v_count <> 0 then raise exception 'FAIL: userAが他人(userB)のいいねを読めてしまった'; end if;
  raise notice 'PASS: 新規追加されたいいねも、本人以外からは引き続き見えない';
end $$;
reset role;

select 'ALL 0068_SNS_LIVE_RESULT_LIKES_RLS TESTS PASSED' as result;
