-- 0067 回帰テスト：寄合帳の自分の投稿削除（論理削除）RPC群の権限・カスケード・
-- 冪等性・監査データの保全・寄合券の不変性を確認する。実行方法は
-- supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('a7000000-0000-0000-0000-00000000000a'), -- userA（topicAの投稿者）
  ('a7000000-0000-0000-0000-00000000000b'), -- userB（answerA1の投稿者）
  ('a7000000-0000-0000-0000-00000000000c'), -- userC（commentA1の投稿者、傍観者役も兼ねる）
  ('a7000000-0000-0000-0000-00000000000d')  -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a7000000-0000-0000-0000-00000000000d';

-- ============================================================
-- テスト0: PUBLIC/anonは3つのRPCすべてEXECUTE権限を持たず、実行しても到達できない。
-- ============================================================
do $$
begin
  if has_function_privilege('public', 'delete_own_sns_topic(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'delete_own_sns_topic(uuid)', 'EXECUTE') then
    raise exception 'FAIL: delete_own_sns_topic のEXECUTE権限がPUBLIC/anonに付与されている';
  end if;
  if has_function_privilege('public', 'delete_own_sns_answer(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'delete_own_sns_answer(uuid)', 'EXECUTE') then
    raise exception 'FAIL: delete_own_sns_answer のEXECUTE権限がPUBLIC/anonに付与されている';
  end if;
  if has_function_privilege('public', 'delete_own_sns_comment(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'delete_own_sns_comment(uuid)', 'EXECUTE') then
    raise exception 'FAIL: delete_own_sns_comment のEXECUTE権限がPUBLIC/anonに付与されている';
  end if;
  raise notice 'PASS: PUBLIC/anon はいずれのRPCのEXECUTE権限も持たない';
end $$;

do $$
begin
  set local role anon;
  begin
    perform public.delete_own_sns_topic(gen_random_uuid());
    raise exception 'FAIL: anonがdelete_own_sns_topicを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 匿名ユーザーはdelete_own_sns_topicに到達できない (insufficient_privilege)';
  end;
end $$;

-- ============================================================
-- テストデータ準備：
--   topicA（userA） -- answerA1（userB） -- commentA1（userC）
--   topicB（userB） -- answerB1（userC） -- commentB1（userA）   ※topicAの削除で影響を受けないはずの対照群
-- ============================================================
insert into public.sns_topics (id, author_id, body) values
  ('a7100000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-00000000000a', 'topicA本文'),
  ('a7100000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-00000000000b', 'topicB本文');

insert into public.sns_answers (id, topic_id, author_id, body) values
  ('a7200000-0000-0000-0000-000000000001', 'a7100000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-00000000000b', 'answerA1本文'),
  ('a7200000-0000-0000-0000-000000000002', 'a7100000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-00000000000c', 'answerB1本文');

insert into public.sns_comments (id, answer_id, author_id, body) values
  ('a7300000-0000-0000-0000-000000000001', 'a7200000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-00000000000c', 'commentA1本文'),
  ('a7300000-0000-0000-0000-000000000002', 'a7200000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-00000000000a', 'commentB1本文');

-- 通報記録（reports）：topicAへの通報。target_idにFKは無いため、非表示化の影響を
-- 受けないはず（テスト後半で確認する）。
insert into public.reports (reporter_id, target_type, target_id, target_author_id, reason, snapshot_body)
  values (
    'a7000000-0000-0000-0000-00000000000c', 'sns_topic', 'a7100000-0000-0000-0000-000000000001',
    'a7000000-0000-0000-0000-00000000000a', '不適切な表現', 'topicA本文（通報時点）'
  );

-- 寄合券の消費前後比較用に、関係する全ユーザーの残数・回復時刻を記録しておく
-- （このマイグレーションのRPCはいずれも寄合券に一切触れないため、全ユーザー分が
-- 一切変化しないはず）。
create temporary table _t0067_tickets_before as
select id, tickets_count, tickets_next_recovery_at from public.profiles
  where id in (
    'a7000000-0000-0000-0000-00000000000a',
    'a7000000-0000-0000-0000-00000000000b',
    'a7000000-0000-0000-0000-00000000000c',
    'a7000000-0000-0000-0000-00000000000d'
  );

-- ============================================================
-- テスト1: 他人（userB）はtopicA（userA所有）を削除できない (NOT_OWNER)。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000b', true);
  begin
    perform public.delete_own_sns_topic('a7100000-0000-0000-0000-000000000001');
    raise exception 'FAIL: 他人のお題を削除できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_OWNER' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 他人のお題は削除できない (NOT_OWNER)';
  end;
end $$;

-- ============================================================
-- テスト2: 存在しないIDはTOPIC_NOT_FOUND。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000a', true);
  begin
    perform public.delete_own_sns_topic(gen_random_uuid());
    raise exception 'FAIL: 存在しないお題を削除できてしまった';
  exception
    when others then
      if sqlerrm <> 'TOPIC_NOT_FOUND' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 存在しないお題はTOPIC_NOT_FOUNDで拒否される';
  end;
end $$;

-- ============================================================
-- テスト3: 本人（userA）がtopicAを削除すると、topicA・answerA1・commentA1が
--          まとめて非表示になり、topicB・answerB1・commentB1（対照群）は無傷。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000a', true);
  perform public.delete_own_sns_topic('a7100000-0000-0000-0000-000000000001');
end $$;

reset role;

do $$
declare
  r record;
begin
  select is_hidden, hidden_reason into r from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000001';
  if not r.is_hidden or r.hidden_reason <> 'deleted_by_author' then
    raise exception 'FAIL: topicAが期待どおり非表示になっていない (is_hidden=%, reason=%)', r.is_hidden, r.hidden_reason;
  end if;

  select is_hidden, hidden_reason into r from public.sns_answers where id = 'a7200000-0000-0000-0000-000000000001';
  if not r.is_hidden or r.hidden_reason <> 'deleted_by_author_topic_removed' then
    raise exception 'FAIL: お題削除でanswerA1が非表示になっていない (is_hidden=%, reason=%)', r.is_hidden, r.hidden_reason;
  end if;

  select is_hidden, hidden_reason into r from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000001';
  if not r.is_hidden or r.hidden_reason <> 'deleted_by_author_topic_removed' then
    raise exception 'FAIL: お題削除でcommentA1が非表示になっていない (is_hidden=%, reason=%)', r.is_hidden, r.hidden_reason;
  end if;

  select is_hidden into r from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000002';
  if r.is_hidden then raise exception 'FAIL: 無関係なtopicBまで非表示になった'; end if;
  select is_hidden into r from public.sns_answers where id = 'a7200000-0000-0000-0000-000000000002';
  if r.is_hidden then raise exception 'FAIL: 無関係なanswerB1まで非表示になった'; end if;
  select is_hidden into r from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000002';
  if r.is_hidden then raise exception 'FAIL: 無関係なcommentB1まで非表示になった'; end if;

  raise notice 'PASS: お題削除で、そのお題の回答・ツッコミも非表示になり、無関係な投稿は無傷';
end $$;

-- ============================================================
-- テスト4: 子要素（answerA1・commentA1）をIDで直接取得しても、通常利用者
--          （非所有者・非管理者のuserC）には見えない。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000c', true);

  select count(*) into v_count from public.sns_answers where id = 'a7200000-0000-0000-0000-000000000001';
  if v_count <> 0 then raise exception 'FAIL: 非表示のお題に属するanswerA1が通常利用者から見えている'; end if;

  select count(*) into v_count from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000001';
  if v_count <> 0 then raise exception 'FAIL: 非表示のお題に属するcommentA1が通常利用者から見えている'; end if;

  select count(*) into v_count from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000001';
  if v_count <> 0 then raise exception 'FAIL: 非表示のtopicAが通常利用者から見えている'; end if;

  -- 対照群（topicB系）は引き続き見える。
  select count(*) into v_count from public.sns_answers where id = 'a7200000-0000-0000-0000-000000000002';
  if v_count <> 1 then raise exception 'FAIL: 無関係なanswerB1が通常利用者から見えなくなった'; end if;

  raise notice 'PASS: 非表示のお題に属する回答・ツッコミは、IDを直接指定しても通常利用者には見えない';
end $$;

-- ============================================================
-- テスト5: 管理者（is_host）には非表示になったtopicA・answerA1・commentA1が
--          引き続き見える（監査目的）。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000d', true);

  select count(*) into v_count from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000001';
  if v_count <> 1 then raise exception 'FAIL: 管理者から非表示のtopicAが見えない'; end if;
  select count(*) into v_count from public.sns_answers where id = 'a7200000-0000-0000-0000-000000000001';
  if v_count <> 1 then raise exception 'FAIL: 管理者から非表示のanswerA1が見えない'; end if;
  select count(*) into v_count from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000001';
  if v_count <> 1 then raise exception 'FAIL: 管理者から非表示のcommentA1が見えない'; end if;

  raise notice 'PASS: 管理者には非表示化された投稿が引き続き見える（監査目的）';
end $$;

reset role;

-- ============================================================
-- テスト6: 通報記録（reports）は削除操作の影響を受けず残っている。
-- ============================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.reports
    where target_id = 'a7100000-0000-0000-0000-000000000001' and target_type = 'sns_topic';
  if v_count <> 1 then raise exception 'FAIL: お題削除後に通報記録が消えている/増えている (count=%)', v_count; end if;
  raise notice 'PASS: 通報記録は削除操作の影響を受けず残っている';
end $$;

-- ============================================================
-- テスト7: 寄合券の残数・回復時刻は、削除に関与した全員（userA/B/C/admin）とも
--          削除前後で一切変化していない。
-- ============================================================
do $$
declare
  r record;
  before_row record;
  mismatch boolean := false;
begin
  for r in select id, tickets_count, tickets_next_recovery_at from public.profiles
    where id in (
      'a7000000-0000-0000-0000-00000000000a',
      'a7000000-0000-0000-0000-00000000000b',
      'a7000000-0000-0000-0000-00000000000c',
      'a7000000-0000-0000-0000-00000000000d'
    )
  loop
    select * into before_row from _t0067_tickets_before where id = r.id;
    if before_row.tickets_count <> r.tickets_count
       or before_row.tickets_next_recovery_at is distinct from r.tickets_next_recovery_at then
      mismatch := true;
      raise notice '不一致: user=% before=(%,%) after=(%,%)',
        r.id, before_row.tickets_count, before_row.tickets_next_recovery_at, r.tickets_count, r.tickets_next_recovery_at;
    end if;
  end loop;
  if mismatch then
    raise exception 'FAIL: 削除操作の前後で寄合券の残数・回復時刻が変化した';
  end if;
  raise notice 'PASS: 削除前後で寄合券の残数・回復時刻は誰の分も一切変化しない';
end $$;

-- ============================================================
-- テスト8: 同じ削除（topicAの削除）を再実行しても壊れない（冪等）。
--          hidden_at等が上書きされ続けないことも確認する。
-- ============================================================
do $$
declare
  v_hidden_at_before timestamptz;
  v_hidden_at_after timestamptz;
begin
  select hidden_at into v_hidden_at_before from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000001';

  perform pg_sleep(0.05); -- hidden_atが万一更新されてしまった場合に確実に差が出るようにする

  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000a', true);
  perform public.delete_own_sns_topic('a7100000-0000-0000-0000-000000000001'); -- 例外を投げないことを確認

  reset role;
  select hidden_at into v_hidden_at_after from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000001';
  if v_hidden_at_before is distinct from v_hidden_at_after then
    raise exception 'FAIL: 同じ削除を再実行するとhidden_atが上書きされた（冪等でない）';
  end if;
  raise notice 'PASS: 同じ削除を再実行しても例外にならず、状態も変化しない（冪等）';
end $$;

-- ============================================================
-- テスト9: delete_own_sns_answer単体。他人は削除できず、本人が削除すると
--          その回答のツッコミも非表示になるが、兄弟回答のツッコミには影響しない。
-- ============================================================
insert into public.sns_topics (id, author_id, body) values
  ('a7100000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-00000000000a', 'topicC本文');
insert into public.sns_answers (id, topic_id, author_id, body) values
  ('a7200000-0000-0000-0000-000000000003', 'a7100000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-00000000000b', 'answerC1本文'),
  ('a7200000-0000-0000-0000-000000000004', 'a7100000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-00000000000c', 'answerC2本文（兄弟）');
insert into public.sns_comments (id, answer_id, author_id, body) values
  ('a7300000-0000-0000-0000-000000000003', 'a7200000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-00000000000a', 'commentC1本文'),
  ('a7300000-0000-0000-0000-000000000004', 'a7200000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-00000000000c', 'commentC2本文（兄弟の回答へのツッコミ、投稿者はuserC）');

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000c', true); -- answerC1の投稿者ではない
  begin
    perform public.delete_own_sns_answer('a7200000-0000-0000-0000-000000000003');
    raise exception 'FAIL: 他人の回答を削除できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_OWNER' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000b', true); -- answerC1の投稿者本人
  perform public.delete_own_sns_answer('a7200000-0000-0000-0000-000000000003');
end $$;

reset role;

do $$
declare
  r record;
begin
  select is_hidden, hidden_reason into r from public.sns_answers where id = 'a7200000-0000-0000-0000-000000000003';
  if not r.is_hidden or r.hidden_reason <> 'deleted_by_author' then
    raise exception 'FAIL: answerC1が期待どおり非表示になっていない';
  end if;
  select is_hidden, hidden_reason into r from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000003';
  if not r.is_hidden or r.hidden_reason <> 'deleted_by_author_answer_removed' then
    raise exception 'FAIL: 回答削除でcommentC1が非表示になっていない';
  end if;
  select is_hidden into r from public.sns_answers where id = 'a7200000-0000-0000-0000-000000000004';
  if r.is_hidden then raise exception 'FAIL: 兄弟の回答answerC2まで非表示になった'; end if;
  select is_hidden into r from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000004';
  if r.is_hidden then raise exception 'FAIL: 兄弟の回答へのツッコミcommentC2まで非表示になった'; end if;
  select is_hidden into r from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000003';
  if r.is_hidden then raise exception 'FAIL: 回答削除で親のtopicCまで非表示になった'; end if;
  raise notice 'PASS: 回答削除でそのツッコミも非表示になり、兄弟の回答・親のお題には影響しない';
end $$;

-- ============================================================
-- テスト10: delete_own_sns_comment単体。他の投稿には一切影響しない。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000b', true); -- commentC2の投稿者ではない（投稿者はuserC）
  begin
    perform public.delete_own_sns_comment('a7300000-0000-0000-0000-000000000004');
    raise exception 'FAIL: 他人のツッコミを削除できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_OWNER' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000c', true); -- commentC2の投稿者本人
  perform public.delete_own_sns_comment('a7300000-0000-0000-0000-000000000004');
end $$;

reset role;

do $$
declare
  r record;
begin
  select is_hidden, hidden_reason into r from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000004';
  if not r.is_hidden or r.hidden_reason <> 'deleted_by_author' then
    raise exception 'FAIL: commentC2が期待どおり非表示になっていない';
  end if;
  select is_hidden into r from public.sns_answers where id = 'a7200000-0000-0000-0000-000000000004';
  if r.is_hidden then raise exception 'FAIL: ツッコミ削除で親のanswerC2まで非表示になった'; end if;
  raise notice 'PASS: ツッコミ削除は他の投稿（親の回答等）に一切影響しない';
end $$;

-- ============================================================
-- テスト11: 一般ユーザーに広いUPDATE/DELETE権限が付与されていない
--          （このRPC以外の経路で直接is_hiddenを書き換えたり物理削除したりできない）。
-- 注：sns_topics_write_host/sns_topics_delete_hostはUSING (is_host())のみで
-- テーブル自体へのUPDATE/DELETE権限（GRANT）はauthenticatedに広く付与されている
-- （Supabaseの標準構成、RLSだけで絞る設計）ため、非hostの直接UPDATE/DELETEは
-- 例外にはならず「0行が対象になるだけ」で静かに終わる。よって行が変化していない
-- ことを確認する（例外の有無ではなく実際の効果で判定する）。
-- ============================================================
do $$
declare
  v_is_hidden boolean;
  v_exists boolean;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000b', true); -- topicBの所有者本人（is_hostではない）

  update public.sns_topics set is_hidden = true where id = 'a7100000-0000-0000-0000-000000000002';
  select is_hidden into v_is_hidden from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000002';
  if v_is_hidden then
    raise exception 'FAIL: 一般ユーザーが自分のお題を直接UPDATEで非表示にできてしまった（RPC以外の経路が開いている）';
  end if;

  delete from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000002';
  select exists (select 1 from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000002') into v_exists;
  if not v_exists then
    raise exception 'FAIL: 一般ユーザーが自分のお題を直接DELETEできてしまった';
  end if;

  raise notice 'PASS: 一般ユーザーはRPC以外の経路で自分の投稿を直接UPDATE/DELETEできない（RLSにより0行が対象になるだけ）';
end $$;

-- ============================================================
-- テスト12: 既存の管理機能（/admin/postsの非表示切替・物理削除）は壊れていない。
-- ============================================================
do $$
declare
  v_is_hidden boolean;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7000000-0000-0000-0000-00000000000d', true); -- admin

  update public.sns_topics
    set is_hidden = true, hidden_reason = 'admin_test', hidden_by = 'a7000000-0000-0000-0000-00000000000d', hidden_at = now()
    where id = 'a7100000-0000-0000-0000-000000000002';
  select is_hidden into v_is_hidden from public.sns_topics where id = 'a7100000-0000-0000-0000-000000000002';
  if not v_is_hidden then raise exception 'FAIL: 管理者による直接UPDATE（非表示化）が効いていない'; end if;

  update public.sns_topics set is_hidden = false, hidden_reason = null, hidden_by = null, hidden_at = null
    where id = 'a7100000-0000-0000-0000-000000000002';

  delete from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000002';
  if exists (select 1 from public.sns_comments where id = 'a7300000-0000-0000-0000-000000000002') then
    raise exception 'FAIL: 管理者による直接DELETE（物理削除）が効いていない';
  end if;

  raise notice 'PASS: 既存の管理者向け非表示切替・物理削除は引き続き機能する';
end $$;

reset role;

drop table _t0067_tickets_before;

select 'ALL 0067 TESTS PASSED' as result;
