-- P0権限回帰テスト（0059対応）。
-- pgTAP等の追加ライブラリは導入せず、DOブロック＋RAISE EXCEPTIONによる素朴なアサーションで、
-- psqlさえあれば実行できるようにしてある（このリポジトリの既存migrationsの検証ルーチン
-- ＝安全チェックDOブロックと同じ書き方に揃えた）。
--
-- 実行方法：リポジトリ直下で
--   supabase/tests/run.sh
-- を実行するだけでよい（bootstrap.sqlのような、リポジトリに存在しない外部パスへの
-- 依存は無い。シムはsupabase/tests/fixtures/local_supabase_shim.sqlとして
-- リポジトリに同梱している）。使い捨ての一時データベースを作成・削除するため、
-- 本番のSupabaseプロジェクトに対しては絶対に実行しないこと。
--
-- Supabase CLI（supabase start）＋pgTAPで実行したい場合：このリポジトリの開発環境には
-- Dockerが無く動作確認ができていないため未整備だが、移行は難しくない。
-- supabase/tests/fixtures/local_supabase_shim.sqlの内容（auth スキーマ・ロール・
-- 標準権限の再現）はsupabase start済みの環境ではSupabase自身が既に用意している
-- ため不要になり、以下のDOブロック内のRAISE EXCEPTIONによるアサーションを、
-- pgTAPの ok()/is()/throws_ok() に機械的に置き換えるだけで移行できる
-- （ロール切り替え・auth.uidの模し方は変更不要）。
--
-- 全テストが失敗せずに完走すれば最後に「ALL P0 TESTS PASSED」が出力される。
-- 1つでもFAILすればRAISE EXCEPTIONでその場で止まる（ON_ERROR_STOPと合わせて使うこと）。

\set ON_ERROR_STOP on

-- ============================================================
-- テストデータ：一般ユーザーA・B、管理者
-- ============================================================
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-00000000000a'), -- userA（一般）
  ('a0000000-0000-0000-0000-00000000000b'), -- userB（一般、標的役）
  ('a0000000-0000-0000-0000-00000000000c')  -- admin
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'a0000000-0000-0000-0000-00000000000c';

-- ============================================================
-- テスト1: 一般ユーザーが自分のrole/suspended_until/is_permanently_suspended/
--          admin_memoを直接UPDATEできない（P0-1・P0-2の核心）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  begin
    update public.profiles set role = 'admin' where id = 'a0000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: userAが自分のroleをadminへ更新できてしまった（重大な権限昇格）';
  exception
    when insufficient_privilege then
      raise notice 'PASS: userAは自分のroleを更新できない(insufficient_privilege)';
  end;

  begin
    update public.profiles set is_permanently_suspended = false where id = 'a0000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: userAが自分のis_permanently_suspendedを更新できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: userAは自分のis_permanently_suspendedを更新できない';
  end;

  begin
    update public.profiles set suspended_until = null where id = 'a0000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: userAが自分のsuspended_untilを更新できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: userAは自分のsuspended_untilを更新できない';
  end;

  begin
    update public.profiles set admin_memo = 'self-inserted' where id = 'a0000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: userAが自分のadmin_memoを更新できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: userAは自分のadmin_memoを更新できない';
  end;
end $$;

-- ============================================================
-- テスト2: 一般ユーザーが他人(userB)の同列も当然更新できない（念のため）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  begin
    update public.profiles set role = 'admin' where id = 'a0000000-0000-0000-0000-00000000000b';
    raise exception 'FAIL: userAが他人(userB)のroleを更新できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: userAは他人(userB)のroleを更新できない';
  end;
end $$;

-- ============================================================
-- テスト3: 一般ユーザーの正当な自己編集（display_name等）は引き続き成功する
--          （回帰確認：column revokeが必要な列以外まで巻き込んでいないこと）。
-- ============================================================
do $$
declare
  v_name text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  update public.profiles set display_name = 'テスト太郎' where id = 'a0000000-0000-0000-0000-00000000000a';
  select display_name into v_name from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a';
  if v_name <> 'テスト太郎' then
    raise exception 'FAIL: userAが自分のdisplay_nameを更新できなかった（回帰）';
  end if;
  raise notice 'PASS: userAは引き続き自分のdisplay_nameを更新できる';
end $$;

-- ============================================================
-- テスト4: 一般ユーザーはadmin_set_profile_memo/admin_apply_user_sanctionを
--          呼べない（is_host()チェック）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  begin
    perform public.admin_set_profile_memo('a0000000-0000-0000-0000-00000000000b', 'hacked');
    raise exception 'FAIL: 非管理者がadmin_set_profile_memoを実行できてしまった';
  exception
    when others then
      if sqlerrm = 'not authorized' then
        raise notice 'PASS: 非管理者はadmin_set_profile_memoを実行できない';
      else
        raise exception 'FAIL: 想定外のエラーで停止(admin_set_profile_memo): %', sqlerrm;
      end if;
  end;

  begin
    perform public.admin_apply_user_sanction('a0000000-0000-0000-0000-00000000000b', 'suspend_permanent', 'いたずら', null, null, null);
    raise exception 'FAIL: 非管理者がadmin_apply_user_sanctionを実行できてしまった';
  exception
    when others then
      if sqlerrm = 'not authorized' then
        raise notice 'PASS: 非管理者はadmin_apply_user_sanctionを実行できない';
      else
        raise exception 'FAIL: 想定外のエラーで停止(admin_apply_user_sanction): %', sqlerrm;
      end if;
  end;
end $$;

-- ============================================================
-- テスト5: anonロールはRPC自体を実行する権限が無い（EXECUTE権限のrevoke確認）。
-- ============================================================
do $$
begin
  set local role anon;

  begin
    perform public.admin_set_profile_memo('a0000000-0000-0000-0000-00000000000b', 'anon攻撃');
    raise exception 'FAIL: anonがadmin_set_profile_memoを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonはadmin_set_profile_memoを実行できない';
  end;
end $$;

-- ============================================================
-- テスト6: 管理者は正規のRPC経由でuserBの状態を変更でき、
--          profiles・user_sanctions・admin_action_logsが同一トランザクションで
--          正しく更新される。
-- ============================================================
do $$
declare
  v_until timestamptz;
  v_memo text;
  v_sanction_count int;
  v_log_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a0000000-0000-0000-0000-00000000000c', true);

  perform public.admin_apply_user_sanction('a0000000-0000-0000-0000-00000000000b', 'suspend_temporary', 'テスト理由', null, null, 3);
  perform public.admin_set_profile_memo('a0000000-0000-0000-0000-00000000000b', '要注意');

  reset role;
  select suspended_until, admin_memo into v_until, v_memo
    from public.profiles where id = 'a0000000-0000-0000-0000-00000000000b';
  if v_until is null then
    raise exception 'FAIL: admin_apply_user_sanctionでsuspended_untilが更新されなかった';
  end if;
  if v_memo <> '要注意' then
    raise exception 'FAIL: admin_set_profile_memoでadmin_memoが更新されなかった';
  end if;

  select count(*) into v_sanction_count from public.user_sanctions
    where user_id = 'a0000000-0000-0000-0000-00000000000b' and type = 'suspend_temporary';
  if v_sanction_count <> 1 then
    raise exception 'FAIL: user_sanctionsに記録されなかった(件数=%)', v_sanction_count;
  end if;

  select count(*) into v_log_count from public.admin_action_logs
    where target_id = 'a0000000-0000-0000-0000-00000000000b'
      and action in ('user_suspend_temporary', 'user_memo_updated');
  if v_log_count <> 2 then
    raise exception 'FAIL: admin_action_logsに記録されなかった(件数=%)', v_log_count;
  end if;

  raise notice 'PASS: 管理者は正規のRPC経由でuserBの状態を変更でき、記録も正しく残る';
end $$;

-- ============================================================
-- レビュー指摘対応の追加テスト。userB使用中の件数集計テストと干渉しないよう、
-- 専用のuserDを対象にする。
-- ============================================================
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-00000000000d') -- userD（レビュー対応テスト専用の標的）
on conflict do nothing;

-- ============================================================
-- テスト7: admin_set_profile_memoの監査ログには本文を複製せず、
--          {"changed": true}という事実だけを記録する（レビュー指摘b）。
-- ============================================================
do $$
declare
  v_detail jsonb;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a0000000-0000-0000-0000-00000000000c', true); -- admin

  perform public.admin_set_profile_memo('a0000000-0000-0000-0000-00000000000d', '極めて機微な内部メモ本文');

  reset role;
  select detail into v_detail from public.admin_action_logs
    where target_id = 'a0000000-0000-0000-0000-00000000000d' and action = 'user_memo_updated'
    order by created_at desc limit 1;

  if v_detail is null or v_detail ? 'memo' then
    raise exception 'FAIL: admin_action_logsにメモ本文（またはmemoキー）が記録されてしまっている: %', coalesce(v_detail::text, 'null');
  end if;
  if (v_detail ->> 'changed') is distinct from 'true' then
    raise exception 'FAIL: admin_action_logsに変更した事実(changed:true)が記録されていない: %', coalesce(v_detail::text, 'null');
  end if;
  raise notice 'PASS: admin_set_profile_memoの監査ログはメモ本文を複製せず、変更した事実だけを記録する';
end $$;

-- ============================================================
-- テスト8: warningのadmin_apply_user_sanctionが、notificationsも同一
--          トランザクションで正しく作成する（レビュー指摘a、正常系）。
-- ============================================================
do $$
declare
  v_count int;
  v_title text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a0000000-0000-0000-0000-00000000000c', true); -- admin

  perform public.admin_apply_user_sanction(
    'a0000000-0000-0000-0000-00000000000d', 'warning', '迷惑行為のため', null, null, null,
    '次は利用停止になります'
  );

  reset role;
  select count(*), max(title) into v_count, v_title
    from public.notifications
    where user_id = 'a0000000-0000-0000-0000-00000000000d' and type = 'warning';

  if v_count < 1 then
    raise exception 'FAIL: warning時にnotificationsが作成されなかった（クライアント側の別呼び出しに依存していないか要確認）';
  end if;
  if v_title <> '運営からの警告' then
    raise exception 'FAIL: notificationsのtitleが想定と異なる: %', v_title;
  end if;

  raise notice 'PASS: warningのadmin_apply_user_sanctionはnotificationsも同一トランザクションで正しく作成する';
end $$;

-- ============================================================
-- テスト9: notifications insertが失敗した場合、user_sanctions・
--          admin_action_logsを含めて全体がロールバックされる
--          （レビュー指摘aの核心＝「同一トランザクション」であることの証明）。
--          一時的なトリガーで意図的に失敗させ、副作用が一切残らないことを確認する。
-- ============================================================
create or replace function public._test_force_notification_failure() returns trigger
language plpgsql as $$
begin
  if new.body = '__FORCE_TEST_FAILURE__' then
    raise exception 'FORCED_TEST_FAILURE';
  end if;
  return new;
end;
$$;

create trigger _test_force_notification_failure_trg
  before insert on public.notifications
  for each row execute function public._test_force_notification_failure();

do $$
declare
  v_sanction_before int;
  v_sanction_after int;
  v_log_before int;
  v_log_after int;
begin
  select count(*) into v_sanction_before from public.user_sanctions where user_id = 'a0000000-0000-0000-0000-00000000000d';
  select count(*) into v_log_before from public.admin_action_logs where target_id = 'a0000000-0000-0000-0000-00000000000d';

  set local role authenticated;
  perform set_config('myapp.uid', 'a0000000-0000-0000-0000-00000000000c', true); -- admin

  begin
    perform public.admin_apply_user_sanction(
      'a0000000-0000-0000-0000-00000000000d', 'warning', 'ロールバック確認用', null, null, null,
      '__FORCE_TEST_FAILURE__'
    );
    raise exception 'FAIL: notifications insertが失敗するはずなのにRPCが成功してしまった';
  exception
    when others then
      if sqlerrm <> 'FORCED_TEST_FAILURE' then
        raise exception 'FAIL: 想定外のエラーで停止: %', sqlerrm;
      end if;
  end;

  reset role;
  select count(*) into v_sanction_after from public.user_sanctions where user_id = 'a0000000-0000-0000-0000-00000000000d';
  select count(*) into v_log_after from public.admin_action_logs where target_id = 'a0000000-0000-0000-0000-00000000000d';

  if v_sanction_after <> v_sanction_before then
    raise exception 'FAIL: notifications失敗にもかかわらずuser_sanctionsが記録されてしまった（同一トランザクションになっていない）';
  end if;
  if v_log_after <> v_log_before then
    raise exception 'FAIL: notifications失敗にもかかわらずadmin_action_logsが記録されてしまった（同一トランザクションになっていない）';
  end if;

  raise notice 'PASS: notifications insert失敗時、user_sanctions/admin_action_logsも含めて全体がロールバックされる';
end $$;

drop trigger _test_force_notification_failure_trg on public.notifications;
drop function public._test_force_notification_failure();

select 'ALL P0 TESTS PASSED' as result;
