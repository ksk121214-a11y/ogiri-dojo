-- 0077 回帰テスト：アプリ内アカウント削除申請（account_deletion_requests /
-- create_account_deletion_request / admin_update_account_deletion_request）の
-- 権限・重複防止（部分一意インデックス）・監査記録としての改ざん防止を確認する。
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('a7700000-0000-0000-0000-00000000000a'), -- userA
  ('a7700000-0000-0000-0000-00000000000b'), -- userB
  ('a7700000-0000-0000-0000-00000000000c'), -- userC（rejected→pending系のテスト専用）
  ('a7700000-0000-0000-0000-00000000000d')  -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a7700000-0000-0000-0000-00000000000d';

-- ============================================================
-- テスト0: PUBLIC/anonは両RPCのEXECUTE権限を持たない。
-- ============================================================
do $$
begin
  if has_function_privilege('public', 'create_account_deletion_request()', 'EXECUTE')
     or has_function_privilege('anon', 'create_account_deletion_request()', 'EXECUTE') then
    raise exception 'FAIL: create_account_deletion_request のEXECUTE権限がPUBLIC/anonに付与されている';
  end if;
  if has_function_privilege('public', 'admin_update_account_deletion_request(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'admin_update_account_deletion_request(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: admin_update_account_deletion_request のEXECUTE権限がPUBLIC/anonに付与されている';
  end if;
  raise notice 'PASS: PUBLIC/anon はいずれのRPCのEXECUTE権限も持たない';
end $$;

do $$
begin
  set local role anon;
  begin
    perform public.create_account_deletion_request();
    raise exception 'FAIL: anonがcreate_account_deletion_requestを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 匿名ロールはcreate_account_deletion_requestに到達できない (insufficient_privilege)';
  end;
end $$;

-- ============================================================
-- テスト1: 未ログインではNOT_LOGGED_IN。
-- ============================================================
do $$
begin
  set local role authenticated;
  begin
    perform public.create_account_deletion_request();
    raise exception 'FAIL: 未ログインでも申請できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_LOGGED_IN' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 未ログインはNOT_LOGGED_INで拒否される';
  end;
end $$;

-- ============================================================
-- テスト2: 本人が申請すると申請番号が発行され、pending状態の行が1件できる。
-- 連続で呼んでも新しい行は増えず、同じ申請番号が返る（多重申請の防止）。
-- ============================================================
do $$
declare
  v_number1 text;
  v_number2 text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000a', true);
  v_number1 := public.create_account_deletion_request();
  v_number2 := public.create_account_deletion_request();
  if v_number1 is null or length(v_number1) = 0 then
    raise exception 'FAIL: 申請番号が発行されなかった';
  end if;
  if v_number1 <> v_number2 then
    raise exception 'FAIL: pending中の連続申請で異なる申請番号が発行された (% <> %)', v_number1, v_number2;
  end if;
end $$;

reset role;

do $$
declare
  v_count int;
  r record;
begin
  select count(*) into v_count from public.account_deletion_requests
    where user_id = 'a7700000-0000-0000-0000-00000000000a';
  if v_count <> 1 then
    raise exception 'FAIL: pending中の多重申請で行が増えてしまった (count=%)', v_count;
  end if;

  select status, request_number into r from public.account_deletion_requests
    where user_id = 'a7700000-0000-0000-0000-00000000000a';
  if r.status <> 'pending' or r.request_number is null then
    raise exception 'FAIL: 申請行の初期状態が想定と異なる (status=%, number=%)', r.status, r.request_number;
  end if;

  raise notice 'PASS: 申請は1件だけ作られ、pending中の再申請では同じ申請番号が返る';
end $$;

-- ============================================================
-- テスト3（部分一意インデックスそのもの）：RPCを経由せず直接INSERTしても、
-- 同一user_idでstatus='pending'の2件目は一意制約で拒否される
-- （account_deletion_requests_one_pending_per_user）。
-- ============================================================
do $$
begin
  begin
    insert into public.account_deletion_requests (user_id, request_number)
      values ('a7700000-0000-0000-0000-00000000000a', 'direct-insert-test');
    raise exception 'FAIL: 同一ユーザーの2件目のpending申請が一意制約で拒否されなかった';
  exception
    when unique_violation then
      raise notice 'PASS: 部分一意インデックスにより、同一ユーザーのpending申請は2件目が拒否される';
  end;
end $$;

-- ============================================================
-- テスト4: 本人以外（userB）はuserAの申請をselectできない。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000b', true);
  select count(*) into v_count from public.account_deletion_requests
    where user_id = 'a7700000-0000-0000-0000-00000000000a';
  if v_count <> 0 then
    raise exception 'FAIL: userBからuserAの削除申請が見えている (count=%)', v_count;
  end if;
  raise notice 'PASS: 他人の削除申請はselectできない';
end $$;

reset role;

-- ============================================================
-- テスト5（監査記録としての改ざん防止）：運営者(is_host)でも、
-- account_deletion_requestsへの直接UPDATE/DELETEはテーブル権限自体が
-- revokeされているため拒否される（状態変更はadmin_update_account_deletion_request
-- 経由のみ）。SELECTは全件できる。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000d', true); -- admin

  select count(*) into v_count from public.account_deletion_requests;
  if v_count <> 1 then raise exception 'FAIL: 管理者から全件が見えていない (count=%)', v_count; end if;

  begin
    update public.account_deletion_requests set admin_memo = '直接改ざん'
      where user_id = 'a7700000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: 運営者が直接UPDATEできてしまった（監査記録が改ざん可能）';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 運営者でもaccount_deletion_requestsへの直接UPDATEはテーブル権限自体がrevokeされ拒否される';
  end;

  begin
    delete from public.account_deletion_requests where user_id = 'a7700000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: 運営者が直接DELETEできてしまった（監査記録が改ざん可能）';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 運営者でもaccount_deletion_requestsへの直接DELETEはテーブル権限自体がrevokeされ拒否される';
  end;
end $$;

reset role;

-- ============================================================
-- テスト6: admin_update_account_deletion_requestは、is_host()以外を拒否する。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000b', true); -- 一般ユーザー
  begin
    perform public.admin_update_account_deletion_request(
      (select id from public.account_deletion_requests where user_id = 'a7700000-0000-0000-0000-00000000000a'),
      'rejected', null
    );
    raise exception 'FAIL: 一般ユーザーがadmin_update_account_deletion_requestを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_AUTHORIZED' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
      raise notice 'PASS: 一般ユーザーはNOT_AUTHORIZEDで拒否される';
  end;
end $$;

-- ============================================================
-- テスト7: 運営者はadmin_update_account_deletion_request経由でstatus・
-- admin_memoを変更でき、admin_action_logsへ同一トランザクションで記録される。
-- ただしcompletedへは変更できない（INVALID_STATUS）。
-- ============================================================
do $$
declare
  v_request_id uuid;
  v_log_count_before int;
  v_log_count_after int;
  r record;
begin
  select id into v_request_id from public.account_deletion_requests where user_id = 'a7700000-0000-0000-0000-00000000000a';

  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000d', true); -- admin

  begin
    perform public.admin_update_account_deletion_request(v_request_id, 'completed', null);
    raise exception 'FAIL: 運営者が直接completedへ変更できてしまった';
  exception
    when others then
      if sqlerrm <> 'INVALID_STATUS' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  select count(*) into v_log_count_before from public.admin_action_logs
    where target_type = 'account_deletion_requests' and target_id = v_request_id::text;

  perform public.admin_update_account_deletion_request(v_request_id, 'rejected', '本人確認できず却下');

  select count(*) into v_log_count_after from public.admin_action_logs
    where target_type = 'account_deletion_requests' and target_id = v_request_id::text;
  if v_log_count_after <> v_log_count_before + 1 then
    raise exception 'FAIL: status変更でadmin_action_logsが1件増えていない (before=%, after=%)', v_log_count_before, v_log_count_after;
  end if;
end $$;

reset role;

do $$
declare
  r record;
begin
  select status, admin_memo, processed_by into r from public.account_deletion_requests
    where user_id = 'a7700000-0000-0000-0000-00000000000a';
  if r.status <> 'rejected' or r.admin_memo <> '本人確認できず却下' or r.processed_by <> 'a7700000-0000-0000-0000-00000000000d' then
    raise exception 'FAIL: admin_update_account_deletion_requestの結果が反映されていない (status=%, memo=%, processed_by=%)',
      r.status, r.admin_memo, r.processed_by;
  end if;
  if (select processed_at from public.account_deletion_requests where user_id = 'a7700000-0000-0000-0000-00000000000a') is null then
    raise exception 'FAIL: pending→rejectedなのにprocessed_atが記録されていない';
  end if;
  raise notice 'PASS: 運営者はRPC経由でstatus・admin_memoを変更でき、admin_action_logsへ同一トランザクションで記録される。completedへの直接変更はINVALID_STATUSで拒否される';
end $$;

-- ============================================================
-- テスト7b（再々監査対応）：同じstatusへの変更（rejected→rejected）は
-- 何もしない。processed_at・processed_byは変化せず、admin_action_logsも
-- 増えない。ただし同時に渡したadmin_memoだけは更新される。
-- ============================================================
do $$
declare
  v_request_id uuid;
  v_processed_at_before timestamptz;
  v_processed_by_before uuid;
  v_processed_at_after timestamptz;
  v_processed_by_after uuid;
  v_log_count_before int;
  v_log_count_after int;
  v_memo_after text;
begin
  select id, processed_at, processed_by into v_request_id, v_processed_at_before, v_processed_by_before
    from public.account_deletion_requests where user_id = 'a7700000-0000-0000-0000-00000000000a';
  select count(*) into v_log_count_before from public.admin_action_logs
    where target_type = 'account_deletion_requests' and target_id = v_request_id::text;

  perform pg_sleep(0.05); -- processed_atが万一書き換わった場合に確実に差が出るようにする

  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000d', true); -- admin
  perform public.admin_update_account_deletion_request(v_request_id, 'rejected', '却下理由を追記');
  reset role;

  select processed_at, processed_by, admin_memo into v_processed_at_after, v_processed_by_after, v_memo_after
    from public.account_deletion_requests where id = v_request_id;
  select count(*) into v_log_count_after from public.admin_action_logs
    where target_type = 'account_deletion_requests' and target_id = v_request_id::text;

  if v_processed_at_after is distinct from v_processed_at_before then
    raise exception 'FAIL: 同じstatusへの変更でprocessed_atが書き換わった (before=%, after=%)', v_processed_at_before, v_processed_at_after;
  end if;
  if v_processed_by_after is distinct from v_processed_by_before then
    raise exception 'FAIL: 同じstatusへの変更でprocessed_byが書き換わった';
  end if;
  if v_log_count_after <> v_log_count_before then
    raise exception 'FAIL: 同じstatusへの変更なのにadmin_action_logsが増えた (before=%, after=%)', v_log_count_before, v_log_count_after;
  end if;
  if v_memo_after <> '却下理由を追記' then
    raise exception 'FAIL: 同じstatusへの変更と同時に渡したadmin_memoが更新されていない';
  end if;
  raise notice 'PASS: 同じstatusへの変更（rejected→rejected）はprocessed_at/processed_by/admin_action_logsを変化させず、同時に渡したadmin_memoだけ更新される';
end $$;

-- ============================================================
-- テスト7c（再々監査対応）：新規のpending申請に対してpending→pending
-- （同じstatus）を指定しても、processed_at/processed_byはNULLのままで
-- admin_action_logsも増えない（未対応のまま処理日時が付いてしまう不具合の
-- 回帰確認）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000b', true);
  perform public.create_account_deletion_request();
end $$;

reset role;

do $$
declare
  v_request_id uuid;
  v_log_count_before int;
  v_log_count_after int;
  r record;
begin
  select id into v_request_id from public.account_deletion_requests where user_id = 'a7700000-0000-0000-0000-00000000000b';
  select count(*) into v_log_count_before from public.admin_action_logs
    where target_type = 'account_deletion_requests' and target_id = v_request_id::text;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000d', true); -- admin
  perform public.admin_update_account_deletion_request(v_request_id, 'pending', null);
  reset role;

  select status, processed_at, processed_by into r from public.account_deletion_requests where id = v_request_id;
  select count(*) into v_log_count_after from public.admin_action_logs
    where target_type = 'account_deletion_requests' and target_id = v_request_id::text;

  if r.status <> 'pending' or r.processed_at is not null or r.processed_by is not null then
    raise exception 'FAIL: pending→pending（同じstatus）でprocessed_at/processed_byが設定されてしまった (status=%, processed_at=%, processed_by=%)',
      r.status, r.processed_at, r.processed_by;
  end if;
  if v_log_count_after <> v_log_count_before then
    raise exception 'FAIL: pending→pending（同じstatus）なのにadmin_action_logsが増えた';
  end if;
  raise notice 'PASS: 新規pending申請にpending→pending（同じstatus）を指定しても、処理日時・処理者は設定されず監査ログも増えない';
end $$;

-- ============================================================
-- テスト8: completed済みの申請はstatusをadmin_update_account_deletion_request
-- で変更できない（CANNOT_MODIFY_COMPLETED）が、admin_memoの追記・修正は
-- 引き続き可能（方針の確定：completed済み行は「statusのみ変更不可」）。
-- completedは削除トリガー（0078）だけが設定するため、ここではテスト専用に
-- 直接completedへ更新して準備する（superuser接続のためRLS/GRANTの影響を
-- 受けない）。
-- ============================================================
update public.account_deletion_requests set status = 'completed', processed_at = now(), processed_by = null
  where user_id = 'a7700000-0000-0000-0000-00000000000a';

do $$
declare
  v_request_id uuid;
  v_memo_after text;
begin
  select id into v_request_id from public.account_deletion_requests where user_id = 'a7700000-0000-0000-0000-00000000000a';

  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000d', true); -- admin
  begin
    perform public.admin_update_account_deletion_request(v_request_id, 'rejected', null);
    raise exception 'FAIL: completed済みの申請をrejectedへ変更できてしまった';
  exception
    when others then
      if sqlerrm <> 'CANNOT_MODIFY_COMPLETED' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  begin
    perform public.admin_update_account_deletion_request(v_request_id, 'pending', null);
    raise exception 'FAIL: completed済みの申請をpendingへ変更できてしまった';
  exception
    when others then
      if sqlerrm <> 'CANNOT_MODIFY_COMPLETED' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;

  -- completed済みでも、statusを一切渡さずadmin_memoだけを渡す呼び出しは
  -- 成功する（運用方針：「statusは変更不可、運営メモだけ追記・修正可」）。
  perform public.admin_update_account_deletion_request(v_request_id, null, '削除完了後の補足メモ');
  select admin_memo into v_memo_after from public.account_deletion_requests where id = v_request_id;
  if v_memo_after <> '削除完了後の補足メモ' then
    raise exception 'FAIL: completed済みの申請でadmin_memoだけの更新が反映されなかった';
  end if;
  if (select status from public.account_deletion_requests where id = v_request_id) <> 'completed' then
    raise exception 'FAIL: admin_memoだけの更新でstatusが変化してしまった';
  end if;

  raise notice 'PASS: completed済みの申請はstatusをどちらの方向にも変更できない（CANNOT_MODIFY_COMPLETED）が、admin_memoの追記・修正は引き続き可能';
end $$;

reset role;

-- ============================================================
-- テスト9: rejected→pendingへ戻す操作は、user_idが残っている場合だけ許可され、
-- user_idがNULL化された（＝アカウントが削除された）行では拒否される
-- （USER_ID_MISSING）。userCで新規に用意する。行のidを使い回すため、
-- 一時テーブルに控えておく（doブロックのローカル変数は次のdoブロックへ
-- 引き継げないため）。
-- ============================================================
create temporary table _t0077_scratch (k text primary key, v uuid);

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000c', true);
  perform public.create_account_deletion_request();
end $$;

reset role;

insert into _t0077_scratch (k, v)
  select 'userC_request_id', id from public.account_deletion_requests where user_id = 'a7700000-0000-0000-0000-00000000000c';

update public.account_deletion_requests set status = 'rejected', processed_at = now(), processed_by = 'a7700000-0000-0000-0000-00000000000d'
  where user_id = 'a7700000-0000-0000-0000-00000000000c';

-- account_deletion_requests_scratchのv列はuuid型のため、admin_action_logsの
-- 件数（int）は別の一時テーブルに控えておく。
create temporary table _t0077_scratch_int (k text primary key, v int);
insert into _t0077_scratch_int (k, v)
  select 'userC_log_count_before', count(*) from public.admin_action_logs
    where target_type = 'account_deletion_requests'
      and target_id = (select v::text from _t0077_scratch where k = 'userC_request_id');

do $$
declare
  v_request_id uuid;
begin
  select v into v_request_id from _t0077_scratch where k = 'userC_request_id';

  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000d', true); -- admin
  perform public.admin_update_account_deletion_request(v_request_id, 'pending', null);
end $$;

reset role;

do $$
declare
  v_request_id uuid;
  r record;
  v_log_count_before int;
  v_log_count_after int;
begin
  select v into v_request_id from _t0077_scratch where k = 'userC_request_id';
  select v into v_log_count_before from _t0077_scratch_int where k = 'userC_log_count_before';

  select status, processed_at, processed_by into r from public.account_deletion_requests where id = v_request_id;
  if r.status <> 'pending' then
    raise exception 'FAIL: user_idが残っているrejected申請をpendingへ戻せなかった (status=%)', r.status;
  end if;
  if r.processed_at is not null or r.processed_by is not null then
    raise exception 'FAIL: rejected→pendingで処理日時・処理者がNULLへ戻っていない (processed_at=%, processed_by=%)', r.processed_at, r.processed_by;
  end if;

  select count(*) into v_log_count_after from public.admin_action_logs
    where target_type = 'account_deletion_requests' and target_id = v_request_id::text;
  if v_log_count_after <> v_log_count_before + 1 then
    raise exception 'FAIL: rejected→pendingの再開操作がadmin_action_logsへ記録されていない (before=%, after=%)', v_log_count_before, v_log_count_after;
  end if;

  raise notice 'PASS: rejected→pendingでは処理日時・処理者がNULLへ戻り、再開の事実がadmin_action_logsへ記録される';
end $$;

-- user_idをNULL化（アカウント削除後を模す）した上で、再度rejectedにしてから
-- pendingへ戻そうとするとUSER_ID_MISSINGで拒否されることを確認する
-- （id基準で更新するため、他のテストで作られた行と混同しない）。
update public.account_deletion_requests set status = 'rejected', user_id = null
  where id = (select v from _t0077_scratch where k = 'userC_request_id');

do $$
declare
  v_request_id uuid;
begin
  select v into v_request_id from _t0077_scratch where k = 'userC_request_id';

  set local role authenticated;
  perform set_config('myapp.uid', 'a7700000-0000-0000-0000-00000000000d', true); -- admin
  begin
    perform public.admin_update_account_deletion_request(v_request_id, 'pending', null);
    raise exception 'FAIL: user_idがNULL化された申請をpendingへ戻せてしまった';
  exception
    when others then
      if sqlerrm <> 'USER_ID_MISSING' then raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm; end if;
  end;
  raise notice 'PASS: rejected→pendingは、user_idが残っている場合だけ許可され、NULL化された行はUSER_ID_MISSINGで拒否される';
end $$;

reset role;

drop table _t0077_scratch;
drop table _t0077_scratch_int;

select 'ALL 0077 TESTS PASSED' as result;
