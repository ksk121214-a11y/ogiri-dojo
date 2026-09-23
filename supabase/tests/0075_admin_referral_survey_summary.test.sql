-- 0075 回帰テスト：全体アンケート集計RPC（admin_referral_survey_summary）の確認。
-- ライブ単位の集計（0074・participants基準）とは別物で、profiles.referral_source
-- を1アカウント1件で集計すること・権限が運営者だけに絞られていることを確認する。
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

insert into auth.users (id, is_anonymous) values
  ('a9500000-0000-0000-0000-00000000000f', false), -- 運営者(admin)
  ('a9500000-0000-0000-0000-000000000001', false), -- 通常会員1：x回答・複数ライブに参加（二重カウント確認用）
  ('a9500000-0000-0000-0000-000000000002', false), -- 通常会員2：friend回答
  ('a9500000-0000-0000-0000-000000000003', false), -- 通常会員3：app回答
  ('a9500000-0000-0000-0000-000000000004', false), -- 通常会員4：other回答
  ('a9500000-0000-0000-0000-000000000005', false), -- 通常会員5：未回答（referral_source=null、含めない）
  ('a9500000-0000-0000-0000-000000000006', true),  -- ゲスト（is_guest=true、含めない）
  ('a9500000-0000-0000-0000-000000000007', false)  -- 一般会員（RPC拒否確認用、未回答のまま）
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a9500000-0000-0000-0000-00000000000f';

-- ============================================================
-- 事前準備：運営者として現時点（他テストの残留データを含む）の集計を取得しておく。
-- 以降のテストはこの値からの差分で検証する（他のテストファイルが作った
-- profiles.referral_sourceの値に依存せず、確実に自分が入れた分だけを確認できる）。
-- ============================================================
-- 注意：set local roleでauthenticatedへ切り替えた間は、その後の全ての権限判定が
-- authenticatedロール自身の権限で行われる（呼び出し元が元々スーパーユーザーでも、
-- SET ROLE後は対象ロールの権限に従う）。そのため、テーブルの所有者である
-- 元のロールに戻す（reset role）までは、この一時テーブルへ直接INSERTしない
-- （authenticatedにこの一時テーブルへのINSERT権限を与えていないため失敗する）。
-- 代わりにRPCの結果を一旦スカラー変数へ受け取ってからreset roleし、その後で
-- 一時テーブルへ書き込む。
create temporary table _t0075_before (
  x_count int, friend_count int, app_count int, other_count int, answered_total int
);
do $$
declare
  v_x int; v_friend int; v_app int; v_other int; v_total int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9500000-0000-0000-0000-00000000000f', true);
  select x_count, friend_count, app_count, other_count, answered_total
    into v_x, v_friend, v_app, v_other, v_total
    from public.admin_referral_survey_summary();
  reset role;
  insert into _t0075_before values (v_x, v_friend, v_app, v_other, v_total);
end $$;

-- ============================================================
-- テスト1〜5：x/friend/app/other/未回答/ゲスト/adminの扱い、および同一会員が
-- 複数ライブへ参加していても1人としてしか数えられないことを、一括で検証する。
-- ============================================================

-- 運営者自身もx回答済みにしておく（role='admin'は除外されることの確認用）。
update public.profiles set referral_source = 'x', referral_source_answered_at = now()
  where id = 'a9500000-0000-0000-0000-00000000000f';

-- 通常会員1〜4の回答。
update public.profiles set referral_source = 'x', referral_source_answered_at = now()
  where id = 'a9500000-0000-0000-0000-000000000001';
update public.profiles set referral_source = 'friend', referral_source_answered_at = now()
  where id = 'a9500000-0000-0000-0000-000000000002';
update public.profiles set referral_source = 'app', referral_source_answered_at = now()
  where id = 'a9500000-0000-0000-0000-000000000003';
update public.profiles set referral_source = 'other', referral_source_answered_at = now()
  where id = 'a9500000-0000-0000-0000-000000000004';
-- 通常会員5は意図的に未回答のまま（referral_source=null）にしておく。
-- 一般会員7も未回答のまま（RPC拒否確認専用）。

-- ゲストにも（本来あり得ないが）xが入っていた場合を想定し、is_guestだけで
-- 確実に除外されることを確認する（値の有無で判定していないことの証明）。
update public.profiles set referral_source = 'x', referral_source_answered_at = now()
  where id = 'a9500000-0000-0000-0000-000000000006';

-- 通常会員1を2本の別ライブへ参加させる（participantsを2行作る）。全体集計は
-- participantsではなくprofilesを見るため、これで x_count が2重に増えては
-- いけない。
-- current_phase='closed'で作る（lives_one_active_idxにより、未終了(closed以外)の
-- ライブは同時に高々1件しか存在できないため、このテストのために新たに
-- 進行中のライブを作らない）。
insert into public.lives (scheduled_at, current_phase) values (now(), 'closed') returning id \gset live1_
insert into public.lives (scheduled_at, current_phase) values (now(), 'closed') returning id \gset live2_
insert into public.participants (live_id, user_id, referral_source, is_guest)
  values
    (:'live1_id', 'a9500000-0000-0000-0000-000000000001', 'x', false),
    (:'live2_id', 'a9500000-0000-0000-0000-000000000001', 'x', false);

create temporary table _t0075_after (
  x_count int, friend_count int, app_count int, other_count int, answered_total int
);
do $$
declare
  v_x int; v_friend int; v_app int; v_other int; v_total int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9500000-0000-0000-0000-00000000000f', true);
  select x_count, friend_count, app_count, other_count, answered_total
    into v_x, v_friend, v_app, v_other, v_total
    from public.admin_referral_survey_summary();
  reset role;
  insert into _t0075_after values (v_x, v_friend, v_app, v_other, v_total);
end $$;

do $$
declare
  v_before record;
  v_after record;
begin
  select * into v_before from _t0075_before;
  select * into v_after from _t0075_after;

  if v_after.x_count - v_before.x_count <> 1 then
    raise exception 'FAIL: x_countの増分が1でない(got=%)。通常会員1(x)は複数ライブに参加しているが、profiles基準なら1人としてしか増えないはず（ゲスト・adminのxは除外されるはず）',
      v_after.x_count - v_before.x_count;
  end if;
  raise notice 'PASS: 通常会員1が2本のライブへ参加していても、全体集計のx_countは1人分（+1）しか増えない（participantsではなくprofiles基準で集計されている）';

  if v_after.friend_count - v_before.friend_count <> 1 then
    raise exception 'FAIL: friend_countの増分が1でない(got=%)', v_after.friend_count - v_before.friend_count;
  end if;
  if v_after.app_count - v_before.app_count <> 1 then
    raise exception 'FAIL: app_countの増分が1でない(got=%)', v_after.app_count - v_before.app_count;
  end if;
  if v_after.other_count - v_before.other_count <> 1 then
    raise exception 'FAIL: other_countの増分が1でない(got=%)', v_after.other_count - v_before.other_count;
  end if;
  raise notice 'PASS: x/friend/app/otherそれぞれの回答が正しく1件ずつ加算される';

  -- 未回答(会員5)・一般会員7(未回答)・ゲスト(会員6、xを入れたが除外)・
  -- admin(運営者自身、xを入れたが除外)を合わせても、answered_totalの増分は
  -- x/friend/app/otherの4件（会員1〜4）だけのはず。
  if v_after.answered_total - v_before.answered_total <> 4 then
    raise exception 'FAIL: answered_totalの増分が4でない(got=%)。未回答・ゲスト・adminが誤って含まれている疑い',
      v_after.answered_total - v_before.answered_total;
  end if;
  raise notice 'PASS: referral_source=null（未回答）の会員はanswered_totalに含まれない';
  raise notice 'PASS: is_guest=trueのゲストは、referral_sourceに値が入っていても一切カウントされない';
  raise notice 'PASS: role=adminの運営者アカウントは、referral_sourceに値が入っていても一切カウントされない';
end $$;

-- ============================================================
-- テスト6：一般会員（role='user'・is_guest=false）がRPCを実行すると拒否される。
-- ============================================================
do $$
declare
  v_rejected boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9500000-0000-0000-0000-000000000007', true);
  begin
    perform public.admin_referral_survey_summary();
    raise exception 'FAIL: 一般会員がadmin_referral_survey_summary()を実行できてしまった';
  exception
    when others then
      if sqlerrm like '%not authorized%' then
        v_rejected := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_rejected then
    raise exception 'FAIL: 想定した拒否が発生しなかった';
  end if;
  raise notice 'PASS: 一般会員（role=user）がRPCを実行するとnot authorizedで拒否される';
end $$;

-- ============================================================
-- テスト7：ゲストがRPCを実行すると拒否される。
-- ============================================================
do $$
declare
  v_rejected boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9500000-0000-0000-0000-000000000006', true);
  begin
    perform public.admin_referral_survey_summary();
    raise exception 'FAIL: ゲストがadmin_referral_survey_summary()を実行できてしまった';
  exception
    when others then
      if sqlerrm like '%not authorized%' then
        v_rejected := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_rejected then
    raise exception 'FAIL: 想定した拒否が発生しなかった';
  end if;
  raise notice 'PASS: ゲストがRPCを実行するとnot authorizedで拒否される';
end $$;

-- ============================================================
-- テスト8：未ログイン（anonロール、セッション無し）ではEXECUTE権限自体が
--          剥奪されているため実行できない。
-- ============================================================
do $$
declare
  v_rejected boolean := false;
begin
  set local role anon;
  begin
    perform public.admin_referral_survey_summary();
    raise exception 'FAIL: anon(未ログイン)がadmin_referral_survey_summary()を実行できてしまった';
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  reset role;
  if not v_rejected then
    raise exception 'FAIL: 想定した権限エラーが発生しなかった';
  end if;
  raise notice 'PASS: 未ログイン（anon）はEXECUTE権限自体が無く、権限エラーで実行できない';
end $$;

-- 補足：authenticatedロールであってもuidが確定しない場合、内部のauth.uid()
-- チェックにより安全側でnot authorizedになることも確認する（is_host()だけに
-- 頼っていないことの確認）。
do $$
declare
  v_rejected boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', '', true);
  begin
    perform public.admin_referral_survey_summary();
    raise exception 'FAIL: uid未確定のauthenticatedロールで実行できてしまった';
  exception
    when others then
      if sqlerrm like '%not authorized%' then
        v_rejected := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_rejected then
    raise exception 'FAIL: 想定した拒否が発生しなかった';
  end if;
  raise notice 'PASS: authenticatedロールでもuidが確定しない場合、内部のauth.uid()チェックでnot authorizedになる';
end $$;

-- ============================================================
-- テスト9：運営者だけが集計結果を取得できる（既に上のbefore/after取得が
--          例外なく成功していることそのものが証明になっているが、明示的にも確認する）。
-- ============================================================
do $$
declare
  v_total int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9500000-0000-0000-0000-00000000000f', true);
  select answered_total into v_total from public.admin_referral_survey_summary();
  reset role;
  if v_total is null then
    raise exception 'FAIL: 運営者でも集計結果を取得できなかった';
  end if;
  raise notice 'PASS: 運営者（role=admin）だけが集計結果を正常に取得できる';
end $$;

-- ============================================================
-- テスト10：RPCの戻り値には個人を特定できる情報（id・表示名等）が一切含まれず、
--          選択肢ごとの件数・回答済み合計の5列だけが返る。関数のカタログ定義
--          （pg_proc）から戻り値の列構成そのものを確認する（実行結果の値では
--          なく宣言そのものを見るため、将来列を増やした際にも確実に検知できる）。
-- ============================================================
do $$
declare
  v_result_desc text;
  v_expected text :=
    'TABLE(x_count integer, friend_count integer, app_count integer, other_count integer, answered_total integer)';
begin
  select pg_get_function_result(p.oid) into v_result_desc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_referral_survey_summary';

  if v_result_desc is distinct from v_expected then
    raise exception 'FAIL: RPCの戻り値の列構成が想定と異なる(got=%, expected=%)。個人情報列が混入していないか確認が必要',
      v_result_desc, v_expected;
  end if;
  raise notice 'PASS: RPCの戻り値はx_count/friend_count/app_count/other_count/answered_totalの5列だけで、個人を特定できる情報を含まない';
end $$;

drop table _t0075_before;
drop table _t0075_after;

select 'ALL 0075 TESTS PASSED' as result;
