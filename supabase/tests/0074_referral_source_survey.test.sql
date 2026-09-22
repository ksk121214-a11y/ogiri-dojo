-- 0074 回帰テスト：流入元の許可値チェック・アカウント単位の流入アンケート
-- 永続化（初回のみ保存・以後上書き不可・ゲストは対象外・他人から見えない）の確認。
-- 2026-09-22（レビュー対応）：join_liveがv_effective_referral_sourceを
-- DB側で確定し、participants.referral_sourceにはクライアント値ではなく
-- その確定値だけを書き込むようになったことの確認を追加・修正した。
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id, is_anonymous) values
  ('a9400000-0000-0000-0000-00000000000f', false), -- admin(host)
  ('a9400000-0000-0000-0000-000000000001', false), -- 通常会員A（初回x→引き継ぎ→改ざん試行）
  ('a9400000-0000-0000-0000-000000000002', false), -- 通常会員B（選択しない→次回回答）
  ('a9400000-0000-0000-0000-000000000003', true)   -- 匿名ゲスト
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a9400000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a9410000-0000-0000-0000-000000000001', '0074テスト用お題1', 'text', true)
on conflict do nothing;

-- 参加登録用のライブを1本作って現在のフェーズをopeningにし、closeして次を作る、を
-- 繰り返すヘルパー的な流れ。テストごとに新しいライブを作る。
create or replace function _t0074_make_opening_live(p_title text) returns uuid
language plpgsql as $f$
declare
  v_live_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), p_title, 20, 1,
    array['a9410000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;
  return v_live_id;
end;
$f$;

-- ============================================================
-- テスト1: 不正な流入元は拒否される（DB側でも許可値だけを受け付ける）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_failed boolean := false;
begin
  v_live_id := _t0074_make_opening_live('0074テスト-不正流入元');

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
-- テスト3: referral_sourceだけ値ありのprofiles行はCHECK制約で拒否される
--          （referral_source_answered_atとの対応関係チェック）。
-- ============================================================
do $$
declare
  v_failed boolean := false;
begin
  begin
    update public.profiles
      set referral_source = 'x', referral_source_answered_at = null
      where id = 'a9400000-0000-0000-0000-000000000001';
    raise exception 'FAIL: referral_sourceだけ値ありの更新がCHECK制約で拒否されなかった';
  exception
    when check_violation then
      v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: 想定したcheck制約違反が発生しなかった';
  end if;
  raise notice 'PASS: referral_sourceだけ値あり（answered_atがnull）はCHECK制約で拒否される';
end $$;

-- ============================================================
-- テスト4: referral_source_answered_atだけ値ありのprofiles行もCHECK制約で拒否される。
-- ============================================================
do $$
declare
  v_failed boolean := false;
begin
  begin
    update public.profiles
      set referral_source = null, referral_source_answered_at = now()
      where id = 'a9400000-0000-0000-0000-000000000001';
    raise exception 'FAIL: referral_source_answered_atだけ値ありの更新がCHECK制約で拒否されなかった';
  exception
    when check_violation then
      v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: 想定したcheck制約違反が発生しなかった';
  end if;
  raise notice 'PASS: referral_source_answered_atだけ値あり（referral_sourceがnull）はCHECK制約で拒否される';
end $$;

-- ============================================================
-- テスト5: 初回にxを回答した通常会員（会員A）が、別のライブへnullで参加しても
--          participants.referral_sourceはxになる（アカウント単位の引き継ぎ）。
-- ============================================================
do $$
declare
  v_live1 uuid;
  v_live2 uuid;
  v_p_referral text;
  v_answered_at timestamptz;
  v_participants1_referral text;
  v_participants2_referral text;
begin
  v_live1 := _t0074_make_opening_live('0074テスト-会員A初回x');

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000001', true);
  perform public.join_live(v_live1, 'audience', 'x');
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live1;

  select referral_source, referral_source_answered_at into v_p_referral, v_answered_at
    from public.profiles where id = 'a9400000-0000-0000-0000-000000000001';
  if v_p_referral <> 'x' or v_answered_at is null then
    raise exception 'FAIL: 初回回答がprofilesへ保存されていない(referral_source=%, answered_at=%)', v_p_referral, v_answered_at;
  end if;

  select referral_source into v_participants1_referral
    from public.participants where live_id = v_live1 and user_id = 'a9400000-0000-0000-0000-000000000001';
  if v_participants1_referral <> 'x' then
    raise exception 'FAIL: 初回参加のparticipants.referral_sourceがxでない(got=%)', v_participants1_referral;
  end if;

  -- 別のライブへ「選択しない」（null）で参加しても、participantsにはxが入る。
  v_live2 := _t0074_make_opening_live('0074テスト-会員Aひきつぎ');
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000001', true);
  perform public.join_live(v_live2, 'audience', null);
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live2;

  select referral_source into v_participants2_referral
    from public.participants where live_id = v_live2 and user_id = 'a9400000-0000-0000-0000-000000000001';
  if v_participants2_referral <> 'x' then
    raise exception 'FAIL: 2つ目のライブへnullで参加したのに、参加者一覧の流入元がxに引き継がれていない(got=%)', v_participants2_referral;
  end if;
  raise notice 'PASS: アカウント単位で保存済みの流入元(x)が、次のライブへnullで参加してもparticipants.referral_sourceへ正しく引き継がれる';
end $$;

-- ============================================================
-- テスト6: 保存済みがxの会員Aが、別のライブへ改ざんしたother送っても、
--          profilesとparticipantsの両方がxのまま（上書きされない）。
-- ============================================================
do $$
declare
  v_live3 uuid;
  v_p_referral text;
  v_participants3_referral text;
begin
  v_live3 := _t0074_make_opening_live('0074テスト-会員A改ざん試行');

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000001', true);
  perform public.join_live(v_live3, 'audience', 'other'); -- 改ざんを模した別の値
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live3;

  select referral_source into v_p_referral
    from public.profiles where id = 'a9400000-0000-0000-0000-000000000001';
  if v_p_referral <> 'x' then
    raise exception 'FAIL: 改ざん(other)送信でprofiles.referral_sourceが上書きされた(got=%)', v_p_referral;
  end if;

  select referral_source into v_participants3_referral
    from public.participants where live_id = v_live3 and user_id = 'a9400000-0000-0000-0000-000000000001';
  if v_participants3_referral <> 'x' then
    raise exception 'FAIL: 改ざん(other)送信なのにparticipants.referral_sourceがotherになった(got=%)', v_participants3_referral;
  end if;
  raise notice 'PASS: 保存済み(x)の会員が別の値(other)を送っても、profiles・participantsともxのまま（DB側のeffective値が優先される）';
end $$;

-- ============================================================
-- テスト7:「選択しない」（null）のまま参加した場合は回答済みにならず、
--          次回のライブでは実際に回答を保存できる（会員B）。
-- ============================================================
do $$
declare
  v_live4 uuid;
  v_live5 uuid;
  v_p_referral text;
  v_answered_at timestamptz;
begin
  v_live4 := _t0074_make_opening_live('0074テスト-会員B未回答');

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000002', true);
  perform public.join_live(v_live4, 'audience', null);
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live4;

  select referral_source, referral_source_answered_at into v_p_referral, v_answered_at
    from public.profiles where id = 'a9400000-0000-0000-0000-000000000002';
  if v_p_referral is not null or v_answered_at is not null then
    raise exception 'FAIL: 「選択しない」で参加したのに回答済み扱いになった(referral_source=%, answered_at=%)', v_p_referral, v_answered_at;
  end if;

  -- 未回答のままなので、次のライブでは実際に回答を保存できる。
  v_live5 := _t0074_make_opening_live('0074テスト-会員B次回回答');
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000002', true);
  perform public.join_live(v_live5, 'audience', 'friend');
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live5;

  select referral_source, referral_source_answered_at into v_p_referral, v_answered_at
    from public.profiles where id = 'a9400000-0000-0000-0000-000000000002';
  if v_p_referral <> 'friend' or v_answered_at is null then
    raise exception 'FAIL: 次回ライブでの回答(friend)が保存されていない(referral_source=%, answered_at=%)', v_p_referral, v_answered_at;
  end if;
  raise notice 'PASS: 「選択しない」のまま参加しても回答済みにならず、次回は実際に回答(friend)を保存できる';
end $$;

-- ============================================================
-- テスト8: ゲストがRPCへxを直接送っても、profiles・participantsの両方が
--          nullのまま（運営の流入元集計を汚さない）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_p_referral text;
  v_participants_referral text;
begin
  v_live_id := _t0074_make_opening_live('0074テスト-ゲスト直接送信');

  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000003', true);
  perform public.join_live(v_live_id, 'audience', 'x');
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  select referral_source into v_p_referral from public.profiles where id = 'a9400000-0000-0000-0000-000000000003';
  if v_p_referral is not null then
    raise exception 'FAIL: ゲストのprofiles.referral_sourceが保存されてしまった(got=%)', v_p_referral;
  end if;

  select referral_source into v_participants_referral
    from public.participants where live_id = v_live_id and user_id = 'a9400000-0000-0000-0000-000000000003';
  if v_participants_referral is not null then
    raise exception 'FAIL: ゲストのparticipants.referral_sourceが保存されてしまった(got=%)（新仕様ではゲストは常にnull）', v_participants_referral;
  end if;
  raise notice 'PASS: ゲストがxを直接送っても、profiles・participantsの両方がnullのまま（運営集計を汚さない）';
end $$;

-- ============================================================
-- テスト9: 一般ユーザーは他人のprofiles.referral_sourceを取得できない
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
    where id = 'a9400000-0000-0000-0000-000000000001'; -- 他人（会員A）の行
  reset role;

  if v_count <> 0 then
    raise exception 'FAIL: 一般ユーザーが他人のprofiles行を取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 一般ユーザーは他人のprofiles行（referral_source含む）を取得できない';
end $$;

-- ============================================================
-- テスト10: 運営者(is_host)は各ライブのparticipantsから正しい流入元を確認できる
--          （会員Aの3ライブ全てでxのまま引き継がれていることを、運営視点で再確認する）。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9400000-0000-0000-0000-00000000000f', true);
  select count(*) into v_count
    from public.participants p
    join public.lives l on l.id = p.live_id
    where p.user_id = 'a9400000-0000-0000-0000-000000000001'
      and l.title like '0074テスト-会員A%'
      and p.referral_source = 'x';
  reset role;

  if v_count <> 3 then
    raise exception 'FAIL: 運営者が会員Aの3ライブ全てでreferral_source=xを確認できなかった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 運営者は複数ライブのparticipants一覧から、引き継がれた正しい流入元(x)を確認できる';
end $$;

-- ============================================================
-- テスト11: 本人でも直接updateで自分のreferral_sourceを書き換えられない
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

-- ============================================================
-- テスト12（同時実行でも初回回答が上書きされない）：dblinkを使った実際の
--          並行呼び出しで、profiles行のFOR UPDATE直列化を検証する。
--          dblink拡張が使えない環境ではスキップする。
-- ============================================================
insert into auth.users (id, is_anonymous) values ('a9400000-0000-0000-0000-000000000004', false)
  on conflict do nothing; -- 会員C（並行回答テスト専用）

do $$
declare
  v_has_dblink boolean;
begin
  begin
    create extension if not exists dblink;
    v_has_dblink := true;
  exception when others then
    v_has_dblink := false;
  end;
  if not v_has_dblink then
    raise notice 'SKIP: dblink拡張が利用できないため、並行回答テストを省略';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    return;
  end if;

  -- 会員Cとしてjoin_liveを呼び、そのままp_hold_seconds秒だけトランザクションを
  -- 保持し続ける（join_live内のFOR UPDATEロックがこの間ずっと保持される）。
  create or replace function public._t0074_join_and_hold(
    p_live_id uuid, p_referral text, p_hold_seconds numeric
  ) returns uuid
  language plpgsql
  as $f$
  declare
    v_row public.participants;
  begin
    set local role authenticated;
    perform set_config('myapp.uid', 'a9400000-0000-0000-0000-000000000004', true);
    v_row := public.join_live(p_live_id, 'audience', p_referral);
    perform pg_sleep(p_hold_seconds);
    reset role;
    return v_row.id;
  end;
  $f$;
end $$;

-- 2026-09-22追加：dblink接続は別セッション（別トランザクション）になるため、
-- ここで作るライブはdblink側から見えるよう、事前にコミット済みにしておく
-- 必要がある（同じdoブロック内で作るとuncommittedのままdblink側から
-- LIVE_NOT_FOUNDになる）。一時テーブルもセッションローカルでdblink越しに
-- 見えないため、通常テーブルで橋渡しする（テスト終了時にdropする）。
create table if not exists _t0074_dblink_ctx (key text primary key, value uuid);

do $$
begin
  if to_regprocedure('public._t0074_join_and_hold(uuid, text, numeric)') is null then
    return; -- dblinkが使えずスキップ済み
  end if;
  insert into _t0074_dblink_ctx (key, value)
    values ('live_bg', _t0074_make_opening_live('0074テスト-並行bg'))
  on conflict (key) do update set value = excluded.value;
end $$;

do $$
begin
  if to_regprocedure('public._t0074_join_and_hold(uuid, text, numeric)') is null then
    return;
  end if;
  insert into _t0074_dblink_ctx (key, value)
    values ('live_main', _t0074_make_opening_live('0074テスト-並行main'))
  on conflict (key) do update set value = excluded.value;
end $$;

do $$
declare
  v_live_bg uuid;
  v_live_main uuid;
  v_conn text := 'dbname=' || current_database();
  v_connected boolean := false;
  v_bg_participant uuid;
  v_main_participant uuid;
  v_started_at timestamptz;
  v_elapsed_ms numeric;
  v_p_referral text;
  v_bg_referral text;
  v_main_referral text;
begin
  if to_regprocedure('public._t0074_join_and_hold(uuid, text, numeric)') is null then
    return; -- dblinkが使えずスキップ済み
  end if;

  select value into v_live_bg from _t0074_dblink_ctx where key = 'live_bg';
  select value into v_live_main from _t0074_dblink_ctx where key = 'live_main';

  begin
    perform dblink_connect('t0074bg', v_conn);
    v_connected := true;
  exception when others then
    raise notice 'SKIP: dblink接続に失敗したため、並行回答テストを省略 (%)', sqlerrm;
  end;

  if v_connected then
    -- 別セッションが会員Cとしてxで参加し、profiles行のFOR UPDATEロックを
    -- 1.5秒間保持し続ける。
    perform dblink_send_query(
      't0074bg',
      format('select public._t0074_join_and_hold(%L, %L, 1.5)', v_live_bg, 'x')
    );
    perform pg_sleep(0.3); -- 別セッションが実際にFOR UPDATEの行ロックを取るまで少し待つ

    -- 本セッションも同時に、同じ会員Cとして別の値(friend)・別のライブで参加を試みる。
    -- 別セッションのロックが解放されるまでブロックされるはず。
    v_started_at := clock_timestamp();
    v_main_participant := public._t0074_join_and_hold(v_live_main, 'friend', 0);
    v_elapsed_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;

    select ok into v_bg_participant from dblink_get_result('t0074bg') as t(ok uuid);
    perform dblink_disconnect('t0074bg');

    if v_elapsed_ms < 800 then
      raise exception
        'FAIL: 並行回答がprofilesのFOR UPDATEロックを待たずに完了した（約%ms、直列化が効いていない疑い）', round(v_elapsed_ms);
    end if;

    select referral_source into v_bg_referral
      from public.participants where id = v_bg_participant;
    select referral_source into v_main_referral
      from public.participants where id = v_main_participant;
    select referral_source into v_p_referral
      from public.profiles where id = 'a9400000-0000-0000-0000-000000000004';

    -- 先にロックを取ったbg側(x)がfirst-write-winsになり、profiles・
    -- 両方のparticipants行ともxで揃うはず（後発mainのfriendは反映されない）。
    if v_p_referral <> 'x' then
      raise exception 'FAIL: 並行回答後のprofiles.referral_sourceがxでない(got=%)', v_p_referral;
    end if;
    if v_bg_referral <> 'x' or v_main_referral <> 'x' then
      raise exception 'FAIL: 並行回答後、両方のparticipants行がxで揃っていない(bg=%, main=%)', v_bg_referral, v_main_referral;
    end if;

    raise notice
      'PASS: dblinkによる実際の並行呼び出しでも、profiles行のFOR UPDATEにより先着(x)がfirst-write-winsになり、後発(friend)は反映されない（約%ms待機）',
      round(v_elapsed_ms);
  end if;
end $$;

do $$
begin
  if to_regprocedure('public._t0074_join_and_hold(uuid, text, numeric)') is not null then
    drop function public._t0074_join_and_hold(uuid, text, numeric);
  end if;
end $$;

drop table if exists _t0074_dblink_ctx;
drop function _t0074_make_opening_live(text);

select 'ALL 0074 TESTS PASSED' as result;
