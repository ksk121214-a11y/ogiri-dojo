-- 0074 回帰テスト：流入元の許可値チェック・アカウント単位の流入アンケート
-- 永続化（初回のみ保存・以後上書き不可・ゲストは対象外・他人から見えない）の確認。
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id, is_anonymous) values
  ('a9400000-0000-0000-0000-00000000000f', false), -- admin(host)
  ('a9400000-0000-0000-0000-000000000001', false), -- 通常会員1
  ('a9400000-0000-0000-0000-000000000002', false), -- 通常会員2（他人からの不可視確認用）
  ('a9400000-0000-0000-0000-000000000003', true)   -- 匿名ゲスト
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a9400000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a9410000-0000-0000-0000-000000000001', '0074テスト用お題1', 'text', true)
on conflict do nothing;

-- ============================================================
-- テスト1: 不正な流入元は拒否される（DB側でも許可値だけを受け付ける）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_failed boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0074テスト-不正流入元', 20, 1,
    array['a9410000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000001', true);
  begin
    perform public.join_live(v_live_id, 'audience', 'not_a_valid_value');
    raise exception 'FAIL: 不正な流入元でjoin_liveが成功してしまった';
  exception
    when others then
      if sqlerrm like '%INVALID_REFERRAL_SOURCE%' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;

  if not v_failed then
    raise exception 'FAIL: 想定した拒否が発生しなかった';
  end if;
  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: 不正な流入元(not_a_valid_value)はINVALID_REFERRAL_SOURCEで拒否される';
end $$;

-- ============================================================
-- テスト2: CHECK制約自体も不正値を拒否する（関数を経由しない直接updateでも防ぐ）。
-- ============================================================
do $$
declare
  v_failed boolean := false;
begin
  begin
    update public.profiles set referral_source = 'bogus' where id = 'a9400000-0000-0000-0000-000000000001';
    raise exception 'FAIL: 不正な流入元へのprofiles直接updateがCHECK制約で拒否されなかった';
  exception
    when check_violation then
      v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: 想定したcheck制約違反が発生しなかった';
  end if;
  raise notice 'PASS: profiles.referral_sourceへのCHECK制約が効いている';
end $$;

-- ============================================================
-- テスト3: 初回の非空回答が保存される（participants.referral_source・
--          profiles.referral_source/referral_source_answered_atの両方）。
-- ============================================================
create temporary table _t0074_ctx (key text primary key, live_id uuid);

do $$
declare
  v_live_id uuid;
  v_p_referral text;
  v_answered_at timestamptz;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0074テスト-初回回答', 20, 1,
    array['a9410000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000001', true);
  perform public.join_live(v_live_id, 'audience', 'x');
  reset role;

  select referral_source, referral_source_answered_at into v_p_referral, v_answered_at
    from public.profiles where id = 'a9400000-0000-0000-0000-000000000001';

  if v_p_referral <> 'x' or v_answered_at is null then
    raise exception 'FAIL: 初回回答がprofilesへ保存されていない(referral_source=%, answered_at=%)', v_p_referral, v_answered_at;
  end if;
  insert into _t0074_ctx (key, live_id) values ('live1', v_live_id);
  raise notice 'PASS: 初回の流入元回答(x)がprofilesへ保存される';
end $$;

-- ============================================================
-- テスト4: 2回目以降は改ざんした値を送っても上書きされない
--          （既に回答済みのユーザーが別の値・別のライブで再度回答しても無視される）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_p_referral text;
  v_answered_at_before timestamptz;
  v_answered_at_after timestamptz;
begin
  select referral_source_answered_at into v_answered_at_before
    from public.profiles where id = 'a9400000-0000-0000-0000-000000000001';

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0074テスト-上書き試行', 20, 1,
    array['a9410000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000001', true);
  perform public.join_live(v_live_id, 'audience', 'other'); -- 改ざんを模した別の値
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  select referral_source, referral_source_answered_at into v_p_referral, v_answered_at_after
    from public.profiles where id = 'a9400000-0000-0000-0000-000000000001';

  if v_p_referral <> 'x' then
    raise exception 'FAIL: 2回目の回答(other)でprofiles.referral_sourceが上書きされた(got=%)', v_p_referral;
  end if;
  if v_answered_at_after <> v_answered_at_before then
    raise exception 'FAIL: 2回目の回答でreferral_source_answered_atが更新されてしまった';
  end if;
  raise notice 'PASS: 既に回答済みのユーザーが別の値を送っても上書きされない(referral_source=xのまま)';
end $$;

-- ============================================================
-- テスト5:「選択しない」（null）のまま参加した場合は回答済みにならない
--          （別の通常会員で確認、次回も表示してよい状態のまま）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_p_referral text;
  v_answered_at timestamptz;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0074テスト-未回答', 20, 1,
    array['a9410000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000002', true);
  perform public.join_live(v_live_id, 'audience', null);
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  select referral_source, referral_source_answered_at into v_p_referral, v_answered_at
    from public.profiles where id = 'a9400000-0000-0000-0000-000000000002';

  if v_p_referral is not null or v_answered_at is not null then
    raise exception 'FAIL: 「選択しない」で参加したのに回答済み扱いになった(referral_source=%, answered_at=%)', v_p_referral, v_answered_at;
  end if;
  raise notice 'PASS: 「選択しない」のまま参加しても回答済みにならない（次回も表示してよい）';
end $$;

-- ============================================================
-- テスト6: ゲストが流入元を送っても、ゲストのprofilesには保存されない
--          （使い捨てプロフィールへの書き込み対象外）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_p_referral text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0074テスト-ゲスト回答', 20, 1,
    array['a9410000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000003', true);
  perform public.join_live(v_live_id, 'audience', 'x');
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  select referral_source into v_p_referral from public.profiles where id = 'a9400000-0000-0000-0000-000000000003';
  if v_p_referral is not null then
    raise exception 'FAIL: ゲストのprofiles.referral_sourceが保存されてしまった(got=%)', v_p_referral;
  end if;

  -- participants.referral_source自体（司会コンソール表示用）は従来どおり保存される。
  if (select referral_source from public.participants where live_id = v_live_id and user_id = 'a9400000-0000-0000-0000-000000000003') <> 'x' then
    raise exception 'FAIL: ゲストでもparticipants.referral_source（司会コンソール表示用）は保存されるべきなのに保存されていない';
  end if;
  raise notice 'PASS: ゲストのアカウント単位の流入元(profiles)は保存されず、participants.referral_source（一覧表示用）は従来どおり保存される';
end $$;

-- ============================================================
-- テスト7: 一般ユーザーは他人のprofiles.referral_sourceを取得できない
--          （既存のprofiles_select_own RLSのみで防御、追加RLS不要）。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000002', true);
  select count(*) into v_count
    from public.profiles
    where id = 'a9400000-0000-0000-0000-000000000001'; -- 他人（通常会員1）の行
  reset role;

  if v_count <> 0 then
    raise exception 'FAIL: 一般ユーザーが他人のprofiles行を取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 一般ユーザーは他人のprofiles行（referral_source含む）を取得できない';
end $$;

-- ============================================================
-- テスト8: 運営者(is_host)は参加者一覧から流入元を確認できる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_count int;
begin
  select live_id into v_live_id from _t0074_ctx where key = 'live1';

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-00000000000f', true);
  select count(*) into v_count
    from public.participants
    where live_id = v_live_id and user_id = 'a9400000-0000-0000-0000-000000000001' and referral_source = 'x';
  reset role;

  if v_count <> 1 then
    raise exception 'FAIL: 運営者がparticipants.referral_sourceを確認できなかった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 運営者は参加者一覧からreferral_sourceを確認できる';
end $$;

-- ============================================================
-- テスト9: 本人でも直接updateで自分のreferral_sourceを書き換えられない
--          （authenticatedロールにUPDATE権限をgrantしていない）。
-- ============================================================
do $$
declare
  v_failed boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000001', true);
  begin
    update public.profiles set referral_source = 'friend' where id = 'a9400000-0000-0000-0000-000000000001';
    raise exception 'FAIL: 本人がprofiles.referral_sourceを直接updateできてしまった';
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  reset role;

  if not v_failed then
    raise exception 'FAIL: 想定した権限エラーが発生しなかった';
  end if;
  raise notice 'PASS: 本人でもprofiles.referral_sourceを直接updateできない（join_live経由のみ）';
end $$;

drop table _t0074_ctx;

select 'ALL 0074 TESTS PASSED' as result;
