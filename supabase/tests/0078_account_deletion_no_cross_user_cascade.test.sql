-- 0078 回帰テスト：アカウント削除（auth.usersの削除→profilesへのcascade）が、
-- 他人が所有する寄合帳の投稿行を物理削除しないことを、userA/B/Cの3人を使って
-- 確認する。あわせて、削除された本人の投稿がis_hidden化されること、pending中の
-- アカウント削除申請がcompletedへ自動更新されることも確認する。
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('a7800000-0000-0000-0000-00000000000a'), -- userA（topicAの投稿者。今回削除される）
  ('a7800000-0000-0000-0000-00000000000b'), -- userB（answerA1の投稿者。今回削除される）
  ('a7800000-0000-0000-0000-00000000000c'), -- userC（commentA1・commentC1の投稿者、観察者）
  ('a7800000-0000-0000-0000-00000000000d')  -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a7800000-0000-0000-0000-00000000000d';

-- ============================================================
-- テストデータ準備：
--   topicA（userA） -- answerA1（userB） -- commentA1（userC）  ※userAをこの後削除する
--   topicC（userC） -- answerC1（userB） -- commentC1（userC）  ※userBをこの後削除する
--   （topicCの投稿者はA/Bのどちらでもない第三者(userC)にし、userA削除・userB削除
--   どちらの巻き添えも受けない純粋な対照群にする）
-- ============================================================
insert into public.sns_topics (id, author_id, body) values
  ('a7810000-0000-0000-0000-000000000001', 'a7800000-0000-0000-0000-00000000000a', 'topicA本文'),
  ('a7810000-0000-0000-0000-000000000002', 'a7800000-0000-0000-0000-00000000000c', 'topicC本文');

insert into public.sns_answers (id, topic_id, author_id, body) values
  ('a7820000-0000-0000-0000-000000000001', 'a7810000-0000-0000-0000-000000000001', 'a7800000-0000-0000-0000-00000000000b', 'answerA1本文'),
  ('a7820000-0000-0000-0000-000000000002', 'a7810000-0000-0000-0000-000000000002', 'a7800000-0000-0000-0000-00000000000b', 'answerC1本文');

insert into public.sns_comments (id, answer_id, author_id, body) values
  ('a7830000-0000-0000-0000-000000000001', 'a7820000-0000-0000-0000-000000000001', 'a7800000-0000-0000-0000-00000000000c', 'commentA1本文'),
  ('a7830000-0000-0000-0000-000000000002', 'a7820000-0000-0000-0000-000000000002', 'a7800000-0000-0000-0000-00000000000c', 'commentC1本文');

-- userAのpending中のアカウント削除申請（アカウント削除で自動的にcompletedへ
-- 更新されることを後で確認する）。
create temporary table _t0078_scratch (k text primary key, v text);

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7800000-0000-0000-0000-00000000000a', true);
  perform public.create_account_deletion_request();
end $$;

reset role;

-- 削除実行後はuser_idがon delete set nullでNULL化されるため、削除前のうちに
-- 発行済みの申請番号を控えておく（superuser接続なのでRLSに関係なく取得できる）。
insert into _t0078_scratch (k, v)
  select 'userA_request_number', request_number from public.account_deletion_requests
  where user_id = 'a7800000-0000-0000-0000-00000000000a' and status = 'pending';

-- ============================================================
-- テスト1: userAのアカウントを削除する（auth.usersから削除→profilesへcascade→
-- profiles_before_delete_hide_contentトリガー発火）。
-- ============================================================
delete from auth.users where id = 'a7800000-0000-0000-0000-00000000000a';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.profiles where id = 'a7800000-0000-0000-0000-00000000000a';
  if v_count <> 0 then raise exception 'FAIL: userAのprofilesが削除されていない（cascadeが効いていない）'; end if;
  raise notice 'PASS: userAのprofiles行はauth.users削除でcascade削除される';
end $$;

-- ============================================================
-- テスト2: topicA（userA本人の投稿）はauthor_idがNULLになり、is_hiddenになる。
-- 一方、answerA1（userB所有）・commentA1（userC所有）の行はauthor_id・本文とも
-- 物理的に一切変化しない（削除されない）。
-- ============================================================
do $$
declare
  r record;
begin
  select author_id, is_hidden, hidden_reason into r from public.sns_topics
    where id = 'a7810000-0000-0000-0000-000000000001';
  if r.author_id is not null then raise exception 'FAIL: topicAのauthor_idがNULLになっていない (%)', r.author_id; end if;
  if not r.is_hidden or r.hidden_reason <> 'account_deleted' then
    raise exception 'FAIL: topicAが期待どおりaccount_deletedとして非表示になっていない (is_hidden=%, reason=%)', r.is_hidden, r.hidden_reason;
  end if;

  select author_id, body, is_hidden into r from public.sns_answers
    where id = 'a7820000-0000-0000-0000-000000000001';
  if r.author_id is null or r.author_id <> 'a7800000-0000-0000-0000-00000000000b' then
    raise exception 'FAIL: answerA1（userB所有）のauthor_idが変化した（他人のデータが巻き込まれた） (%)', r.author_id;
  end if;
  if r.body <> 'answerA1本文' then raise exception 'FAIL: answerA1の本文が変化した'; end if;
  if r.is_hidden then raise exception 'FAIL: answerA1（userB所有）自体がis_hiddenにされてしまった（userAの削除の影響を受けてはいけない）'; end if;

  select author_id, body, is_hidden into r from public.sns_comments
    where id = 'a7830000-0000-0000-0000-000000000001';
  if r.author_id is null or r.author_id <> 'a7800000-0000-0000-0000-00000000000c' then
    raise exception 'FAIL: commentA1（userC所有）のauthor_idが変化した（他人のデータが巻き込まれた） (%)', r.author_id;
  end if;
  if r.body <> 'commentA1本文' then raise exception 'FAIL: commentA1の本文が変化した'; end if;
  if r.is_hidden then raise exception 'FAIL: commentA1（userC所有）自体がis_hiddenにされてしまった'; end if;

  raise notice 'PASS: userA削除で本人のtopicAのみaccount_deletedとして非表示化され、userB/userC所有の行は物理的に無傷（author_id・本文・is_hiddenいずれも変化なし）';
end $$;

-- ============================================================
-- テスト3: 一般利用者（userC、非所有者・非管理者）から見ると、topicA配下
-- （topicA・answerA1・commentA1）はいずれも見えなくなる（親のtopicAが非表示に
-- なったことによる既存の可視性カスケード、0067）。ただし物理削除ではないため
-- 管理者（is_host）からは引き続き見える。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7800000-0000-0000-0000-00000000000c', true);

  select count(*) into v_count from public.sns_topics where id = 'a7810000-0000-0000-0000-000000000001';
  if v_count <> 0 then raise exception 'FAIL: 非表示のtopicAが一般利用者から見えている'; end if;

  select count(*) into v_count from public.sns_answers where id = 'a7820000-0000-0000-0000-000000000001';
  if v_count <> 0 then raise exception 'FAIL: 親が非表示のanswerA1（userB所有、行自体はis_hidden=false）が一般利用者から見えている'; end if;

  select count(*) into v_count from public.sns_comments where id = 'a7830000-0000-0000-0000-000000000001';
  if v_count <> 0 then raise exception 'FAIL: 親が非表示のcommentA1（userC所有、行自体はis_hidden=false）が一般利用者から見えている'; end if;

  raise notice 'PASS: 親のtopicAが非表示になったことで、物理的には無傷なanswerA1・commentA1も一般利用者からは見えなくなる';
end $$;

do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7800000-0000-0000-0000-00000000000d', true); -- admin

  select count(*) into v_count from public.sns_topics where id = 'a7810000-0000-0000-0000-000000000001';
  if v_count <> 1 then raise exception 'FAIL: 管理者からtopicAが見えない'; end if;
  select count(*) into v_count from public.sns_answers where id = 'a7820000-0000-0000-0000-000000000001';
  if v_count <> 1 then raise exception 'FAIL: 管理者からanswerA1が見えない（物理削除されていないはず）'; end if;
  select count(*) into v_count from public.sns_comments where id = 'a7830000-0000-0000-0000-000000000001';
  if v_count <> 1 then raise exception 'FAIL: 管理者からcommentA1が見えない（物理削除されていないはず）'; end if;

  raise notice 'PASS: 管理者からは非表示化されたtopicA・物理的に無傷なanswerA1・commentA1がいずれも引き続き見える';
end $$;

reset role;

-- ============================================================
-- テスト4: userAのpending中のアカウント削除申請が、アカウント削除と同一
-- トランザクションでcompletedへ自動更新されている。
-- ============================================================
do $$
declare
  v_number text;
  v_status text;
  v_processed_by uuid;
begin
  select v into v_number from _t0078_scratch where k = 'userA_request_number';
  -- userAのアカウント削除でprofiles.idがcascade元になるため、user_idはon delete
  -- set nullで既にNULL化されている。削除前に控えておいたrequest_numberで
  -- 一意に特定する。
  select status, processed_by into v_status, v_processed_by from public.account_deletion_requests where request_number = v_number;
  if v_status <> 'completed' then
    raise exception 'FAIL: userAのpending中の削除申請がcompletedへ自動更新されていない (status=%)', v_status;
  end if;
  -- 自動完了は削除トリガー（システム処理）によるものであり、特定の管理者による
  -- 処理ではないため、processed_byはNULLのままであるべき（画面側は「システム
  -- 処理」として表示する）。
  if v_processed_by is not null then
    raise exception 'FAIL: 自動完了なのにprocessed_byが特定の管理者IDになっている (%)', v_processed_by;
  end if;
  raise notice 'PASS: アカウント削除と同時にpending中の削除申請がcompletedへ自動更新され、processed_byはNULL（システム処理）のままになる';
end $$;

-- ============================================================
-- テスト5（対照シナリオ）：今度はuserBを削除する。userBが所有するanswerC1のみ
-- account_deletedとして非表示化され、親のtopicC（投稿者はA/Bどちらでもない
-- userC）自体には影響しない。commentC1（userC所有）は物理的に無傷のまま、
-- 親のanswerC1が非表示になったことで一般利用者には見えなくなる。
-- ============================================================
delete from auth.users where id = 'a7800000-0000-0000-0000-00000000000b';

do $$
declare
  r record;
  v_hidden boolean;
begin
  select author_id, is_hidden, hidden_reason into r from public.sns_answers
    where id = 'a7820000-0000-0000-0000-000000000002';
  if r.author_id is not null then raise exception 'FAIL: answerC1のauthor_idがNULLになっていない'; end if;
  if not r.is_hidden or r.hidden_reason <> 'account_deleted' then
    raise exception 'FAIL: answerC1が期待どおりaccount_deletedとして非表示になっていない';
  end if;

  select author_id, body, is_hidden into r from public.sns_comments
    where id = 'a7830000-0000-0000-0000-000000000002';
  if r.author_id is null or r.author_id <> 'a7800000-0000-0000-0000-00000000000c' then
    raise exception 'FAIL: commentC1（userC所有）のauthor_idが変化した';
  end if;
  if r.body <> 'commentC1本文' then raise exception 'FAIL: commentC1の本文が変化した'; end if;
  if r.is_hidden then raise exception 'FAIL: commentC1（userC所有）自体がis_hiddenにされてしまった'; end if;

  select is_hidden into v_hidden from public.sns_topics where id = 'a7810000-0000-0000-0000-000000000002';
  -- topicCの投稿者はuserC（A/Bどちらでもない）なので、userA削除・userB削除の
  -- どちらの影響も受けずis_hidden=falseのままのはず。
  if v_hidden then
    raise exception 'FAIL: 無関係のはずのtopicC（投稿者userC）がuserB削除の影響でis_hiddenになった';
  end if;

  raise notice 'PASS: userB削除ではanswerC1のみaccount_deletedとして非表示化され、commentC1（userC所有）は物理的に無傷、親のtopicCは無関係のまま';
end $$;

do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7800000-0000-0000-0000-00000000000c', true);
  select count(*) into v_count from public.sns_comments where id = 'a7830000-0000-0000-0000-000000000002';
  if v_count <> 0 then raise exception 'FAIL: 親のanswerC1が非表示になったのに、物理的に無傷なcommentC1が一般利用者から見えている'; end if;
  raise notice 'PASS: 親のanswerC1が非表示になったことで、物理的には無傷なcommentC1も一般利用者からは見えなくなる';
end $$;

reset role;

drop table _t0078_scratch;

select 'ALL 0078 TESTS PASSED' as result;
