-- 0084 回帰テスト：限定特典（最初の目撃者・限定アイコン）の条件を一つずつ確認する。
--  対象：本番(official)の開催番号#1〜#5、最終結果画面への到達記録がある、Xログイン会員（プレイヤー・観客）
--  対象外：#6以降、テストライブ、緊急中止、ゲスト（匿名・is_guest）、X以外（メール等）、キック済み
--  離脱して最終結果画面へ戻った場合は、参加登録が残っていれば到達記録を作れる（対象）
--  同じ人が#1〜#5へ複数回参加しても、称号・アイコン・通知は通算1回だけ
--  既存の手動付与（理由・所有行）は書き換えない／参加登録だけでは付与されない
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

-- ============================================================
-- フィクスチャ
-- ============================================================
update public.lives set current_phase = 'closed' where current_phase <> 'closed';
-- 開催番号1〜6は他のテストが使うため、このファイルの間だけ大きな値へ退避する（後で戻さず、1000番台へ移す）
update public.lives set official_sequence_number = official_sequence_number + 982100
  where official_sequence_number between 1 and 6;

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0890000-0000-0000-0000-00000000a109', false, '{"provider":"x"}'::jsonb), -- host（運営）
  ('f0890000-0000-0000-0000-00000000a101', false, '{"provider":"x"}'::jsonb), -- m1：X会員・プレイヤー
  ('f0890000-0000-0000-0000-00000000a102', false, '{"provider":"x"}'::jsonb), -- m2：X会員・観客
  ('f0890000-0000-0000-0000-00000000a103', true,  '{"provider":"anonymous"}'::jsonb), -- g1：匿名ゲスト
  ('f0890000-0000-0000-0000-00000000a104', false, '{"provider":"email"}'::jsonb),  -- e1：メール登録（X以外）
  ('f0890000-0000-0000-0000-00000000a105', false, '{"provider":"x"}'::jsonb), -- k1：X会員・キック済み
  ('f0890000-0000-0000-0000-00000000a106', false, '{"provider":"x"}'::jsonb), -- m3：X会員・離脱して最終結果へ戻る
  ('f0890000-0000-0000-0000-00000000a107', false, '{"provider":"x"}'::jsonb), -- m4：運営の手動付与あり
  ('f0890000-0000-0000-0000-00000000a108', false, '{"provider":"x"}'::jsonb)  -- m5：参加登録のみ（到達記録なし）
on conflict do nothing;

insert into auth.identities (user_id, provider) values
  ('f0890000-0000-0000-0000-00000000a101', 'x'),
  ('f0890000-0000-0000-0000-00000000a102', 'x'),
  ('f0890000-0000-0000-0000-00000000a105', 'x'),
  ('f0890000-0000-0000-0000-00000000a106', 'x'),
  ('f0890000-0000-0000-0000-00000000a107', 'x'),
  ('f0890000-0000-0000-0000-00000000a108', 'x')
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0890000-0000-0000-0000-00000000a109';

-- 補助関数：ライブを作る（直前の非closedライブは閉じる）／参加登録を入れる／到達記録を作る／付与する
create or replace function pg_temp.mk_live(p_id uuid, p_seq int, p_mode text, p_phase text, p_emergency boolean)
returns void language plpgsql as $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
  insert into public.lives (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published, emergency_closed)
  values (p_id, now(), p_phase, p_mode, p_seq, false, p_emergency);
end $$;

-- 既存のライブ行を最終結果の状態へ戻す（直前の非closedライブは閉じる。行は作り直さない）
create or replace function pg_temp.reopen(p_live uuid) returns void
language plpgsql as $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed' and id <> p_live;
  update public.lives set current_phase = 'final_result', emergency_closed = false where id = p_live;
end $$;

create or replace function pg_temp.join_as(p_live uuid, p_user uuid, p_role text, p_guest boolean, p_kicked boolean)
returns void language plpgsql as $$
begin
  insert into public.participants (live_id, user_id, role, preferred_role, is_guest, guest_number, kicked_at)
  values (p_live, p_user, p_role, p_role, p_guest, null, case when p_kicked then now() else null end);
end $$;

-- 到達記録：成功なら'ok'、失敗なら例外メッセージ（生のSQLエラーはテストの判定にだけ使う）
create or replace function pg_temp.mark(p_live uuid, p_user uuid) returns text
language plpgsql as $$
begin
  perform set_config('myapp.uid', p_user::text, true);
  perform public.mark_final_result_presence(p_live, p_user);
  perform set_config('myapp.uid', '', true);
  return 'ok';
exception when others then
  perform set_config('myapp.uid', '', true);
  return sqlerrm;
end $$;

-- 本人経由の付与：'new'（今回付与）／'existing'（既に付与済み）／失敗は例外メッセージ
create or replace function pg_temp.grant_as(p_live uuid, p_user uuid) returns text
language plpgsql as $$
declare
  v_r public.first_live_reward_result;
begin
  perform set_config('myapp.uid', p_user::text, true);
  v_r := public.grant_first_live_reward(p_live, p_user);
  perform set_config('myapp.uid', '', true);
  return case when v_r.newly_granted then 'new' else 'existing' end;
exception when others then
  perform set_config('myapp.uid', '', true);
  return sqlerrm;
end $$;

-- 運営による再付与（admin_regrant_first_live_reward）
create or replace function pg_temp.regrant_as_host(p_live uuid, p_user uuid) returns text
language plpgsql as $$
declare
  v_r public.first_live_reward_result;
begin
  perform set_config('myapp.uid', 'f0890000-0000-0000-0000-00000000a109', true);
  v_r := public.admin_regrant_first_live_reward(p_user, p_live);
  perform set_config('myapp.uid', '', true);
  return case when v_r.newly_granted then 'new' else 'existing' end;
exception when others then
  perform set_config('myapp.uid', '', true);
  return sqlerrm;
end $$;

-- ============================================================
-- 1) 対象：開催番号#1〜#5は到達記録・付与の対象になる（#1の付与理由は0001）
-- ============================================================
do $$
declare
  v_m1 uuid := 'f0890000-0000-0000-0000-00000000a101';
  v_seq int;
  v_live uuid;
begin
  for v_seq in 1..5 loop
    v_live := ('f0890000-0000-0000-0000-00000000b00' || v_seq)::uuid;
    perform pg_temp.mk_live(v_live, v_seq, 'official', 'final_result', false);
    perform pg_temp.join_as(v_live, v_m1, 'player', false, false);
    if pg_temp.mark(v_live, v_m1) <> 'ok' then
      raise exception 'FAIL: 開催番号#%は到達記録の対象のはずが拒否された', v_seq;
    end if;
  end loop;
  raise notice 'PASS: 開催番号#1〜#5の最終結果到達記録は対象（拒否されない）';

  -- #1（最初の回）で初めて付与される。理由は実際の開催番号
  if pg_temp.grant_as(('f0890000-0000-0000-0000-00000000b001')::uuid, v_m1) <> 'new' then
    raise exception 'FAIL: 開催番号#1の到達者に限定特典が付与されない';
  end if;
  if not exists (select 1 from public.user_titles where user_id = v_m1 and title_slug = 'first-witness' and granted_reason = 'official_0001_final_result') then
    raise exception 'FAIL: #1の付与理由がofficial_0001_final_resultになっていない';
  end if;
  if not exists (select 1 from public.user_limited_icons where user_id = v_m1 and icon_slug = 'first-witness' and granted_reason = 'official_0001_final_result') then
    raise exception 'FAIL: #1の限定アイコンの付与理由がofficial_0001_final_resultになっていない';
  end if;
  raise notice 'PASS: 開催番号#1の到達者は限定称号・限定アイコンを獲得し、理由はofficial_0001_final_result';
end $$;

-- ============================================================
-- 2) 同じ人が#2〜#5にも参加しても、称号・アイコン・通知は通算1回だけ（理由も書き換えない）
-- ============================================================
do $$
declare
  v_m1 uuid := 'f0890000-0000-0000-0000-00000000a101';
  v_seq int;
  v_live uuid;
begin
  for v_seq in 2..5 loop
    v_live := ('f0890000-0000-0000-0000-00000000b00' || v_seq)::uuid;
    if pg_temp.grant_as(v_live, v_m1) <> 'existing' then
      raise exception 'FAIL: #%で既に獲得済みの利用者に再付与された', v_seq;
    end if;
  end loop;
  if (select count(*) from public.user_titles where user_id = v_m1 and title_slug = 'first-witness') <> 1 then
    raise exception 'FAIL: 称号の所有行が通算1件になっていない';
  end if;
  if (select count(*) from public.user_limited_icons where user_id = v_m1 and icon_slug = 'first-witness') <> 1 then
    raise exception 'FAIL: 限定アイコンの所有行が通算1件になっていない';
  end if;
  if (select count(*) from public.notifications where user_id = v_m1 and type = 'first_live_reward') <> 1 then
    raise exception 'FAIL: 限定特典の通知が通算1件になっていない';
  end if;
  if not exists (select 1 from public.user_titles where user_id = v_m1 and granted_reason = 'official_0001_final_result') then
    raise exception 'FAIL: 後のライブの処理で最初の付与理由（#0001）が書き換わった';
  end if;
  raise notice 'PASS: #1〜#5へ複数回参加しても、称号・アイコン・通知は通算1回だけで、付与理由は最初のまま';
end $$;

-- ============================================================
-- 3) 対象外：#6以降・テストライブ・緊急中止（いずれも到達記録が作れない）
-- ============================================================
do $$
declare
  v_m2 uuid := 'f0890000-0000-0000-0000-00000000a102';
  v_live6 uuid := 'f0890000-0000-0000-0000-00000000b006';
  v_test uuid := 'f0890000-0000-0000-0000-00000000b030';
  v_live5 uuid := 'f0890000-0000-0000-0000-00000000b005';
  v_r text;
begin
  perform pg_temp.mk_live(v_live6, 6, 'official', 'final_result', false);
  perform pg_temp.join_as(v_live6, v_m2, 'audience', false, false);
  v_r := pg_temp.mark(v_live6, v_m2);
  if v_r not like '%NOT_FIRST_OFFICIAL_LIVE%' then raise exception 'FAIL: #6が対象外になっていない(got=%)', v_r; end if;

  perform pg_temp.mk_live(v_test, null, 'test', 'final_result', false);
  perform pg_temp.join_as(v_test, v_m2, 'player', false, false);
  v_r := pg_temp.mark(v_test, v_m2);
  if v_r not like '%NOT_FIRST_OFFICIAL_LIVE%' then raise exception 'FAIL: テストライブが対象外になっていない(got=%)', v_r; end if;

  -- 緊急中止：#5の行を一時的に緊急中止にして確認（開催番号は一意のため行を増やさない）
  perform pg_temp.reopen(v_live5);
  update public.lives set emergency_closed = true where id = v_live5;
  perform pg_temp.join_as(v_live5, v_m2, 'audience', false, false);
  v_r := pg_temp.mark(v_live5, v_m2);
  if v_r not like '%LIVE_EMERGENCY_CLOSED%' then raise exception 'FAIL: 緊急中止のライブが対象外になっていない(got=%)', v_r; end if;
  update public.lives set emergency_closed = false where id = v_live5;
  raise notice 'PASS: #6以降・テストライブ・緊急中止のライブは、到達記録も限定特典も対象外';
end $$;

-- ============================================================
-- 4) 到達記録が必須：参加登録だけでは付与されない（本人・運営の両方）
-- ============================================================
do $$
declare
  v_m5 uuid := 'f0890000-0000-0000-0000-00000000a108';
  v_live3 uuid := 'f0890000-0000-0000-0000-00000000b003';
  v_r text;
begin
  -- m5は#3の参加登録だけ（最終結果到達の記録は作らない）
  perform pg_temp.join_as(v_live3, v_m5, 'player', false, false);
  v_r := pg_temp.grant_as(v_live3, v_m5);
  if v_r not like '%NO_PRESENCE_RECORD%' then raise exception 'FAIL: 到達記録が無いのに本人経由で付与された(got=%)', v_r; end if;
  v_r := pg_temp.regrant_as_host(v_live3, v_m5);
  if v_r not like '%NO_PRESENCE_RECORD%' then raise exception 'FAIL: 到達記録が無いのに運営の再付与で付与された(got=%)', v_r; end if;
  if exists (select 1 from public.user_titles where user_id = v_m5) or exists (select 1 from public.user_limited_icons where user_id = v_m5) then
    raise exception 'FAIL: 参加登録だけの利用者に限定特典の所有行がある';
  end if;
  raise notice 'PASS: 参加登録だけ・到達記録なしの利用者には、本人経由でも運営の再付与でも付与されない';

  -- 到達記録は最終結果画面（final_result）でだけ作れる：回答中のライブでは作れない
  perform pg_temp.mk_live('f0890000-0000-0000-0000-00000000b040', null, 'test', 'answering', false);
  perform pg_temp.join_as('f0890000-0000-0000-0000-00000000b040', v_m5, 'player', false, false);
  if pg_temp.mark('f0890000-0000-0000-0000-00000000b040', v_m5) not like '%NOT_FINAL_RESULT_PHASE%' then
    raise exception 'FAIL: 最終結果画面以外（回答中）で到達記録が作れてしまった';
  end if;
  raise notice 'PASS: 到達記録は最終結果画面（final_result）でのみ作成でき、回答中などでは作れない';
end $$;

-- ============================================================
-- 5) 対象外の利用者：ゲスト（匿名）・X以外（メール）・キック済み
-- ============================================================
do $$
declare
  v_g1 uuid := 'f0890000-0000-0000-0000-00000000a103';
  v_e1 uuid := 'f0890000-0000-0000-0000-00000000a104';
  v_k1 uuid := 'f0890000-0000-0000-0000-00000000a105';
  v_live2 uuid := 'f0890000-0000-0000-0000-00000000b002';
  v_r text;
begin
  perform pg_temp.reopen(v_live2);
  -- 匿名ゲストはプレイヤーになれない（DBのトリガーで拒否される）ため、観客として参加登録する
  perform pg_temp.join_as(v_live2, v_g1, 'audience', false, false);
  v_r := pg_temp.mark(v_live2, v_g1);
  if v_r not like '%GUEST_NOT_ELIGIBLE%' then raise exception 'FAIL: 匿名ゲストが到達記録を作れた(got=%)', v_r; end if;
  if pg_temp.grant_as(v_live2, v_g1) like 'new' then raise exception 'FAIL: 匿名ゲストに限定特典が付与された'; end if;

  perform pg_temp.join_as(v_live2, v_e1, 'player', false, false);
  v_r := pg_temp.mark(v_live2, v_e1);
  if v_r not like '%NOT_X_LOGIN%' then raise exception 'FAIL: メール登録（X以外）の利用者が到達記録を作れた(got=%)', v_r; end if;

  perform pg_temp.join_as(v_live2, v_k1, 'player', false, true);
  v_r := pg_temp.mark(v_live2, v_k1);
  if v_r not like '%PARTICIPANT_KICKED%' then raise exception 'FAIL: キック済みの利用者が到達記録を作れた(got=%)', v_r; end if;

  if exists (select 1 from public.user_titles where user_id in (v_g1, v_e1, v_k1)) then
    raise exception 'FAIL: ゲスト・X以外・キック済みの利用者に限定称号の所有行がある';
  end if;
  raise notice 'PASS: ゲスト（匿名）・X以外（メール）・キック済みの利用者は、到達記録も限定特典も対象外';
end $$;

-- ============================================================
-- 6) 途中で離脱しても、最終結果画面へ戻って到達記録を作れれば対象（参加登録は残る）
-- ============================================================
do $$
declare
  v_m3 uuid := 'f0890000-0000-0000-0000-00000000a106';
  v_live4 uuid := 'f0890000-0000-0000-0000-00000000b004';
begin
  -- 離脱の操作は参加登録を消さない（サーバー側の参加行はそのまま）。最終結果へ戻った時点で到達記録を作る。
  perform pg_temp.reopen(v_live4);
  perform pg_temp.join_as(v_live4, v_m3, 'player', false, false);
  if pg_temp.mark(v_live4, v_m3) <> 'ok' then raise exception 'FAIL: 離脱して戻った利用者が到達記録を作れない'; end if;
  if pg_temp.grant_as(v_live4, v_m3) <> 'new' then raise exception 'FAIL: 離脱して戻った利用者に限定特典が付与されない'; end if;
  raise notice 'PASS: 途中で離脱しても、最終結果画面へ戻って到達記録を作れれば限定特典の対象になる';
end $$;

-- ============================================================
-- 7) 既存の手動付与（理由・所有行）は書き換えない。運営の再付与は、ライブ番号を付けて通す。
-- ============================================================
do $$
declare
  v_m4 uuid := 'f0890000-0000-0000-0000-00000000a107';
  v_live2 uuid := 'f0890000-0000-0000-0000-00000000b002';
  v_r text;
begin
  perform pg_temp.reopen(v_live2);
  insert into public.user_titles (user_id, title_slug, granted_reason) values (v_m4, 'first-witness', 'manual_admin_20260901');
  insert into public.user_limited_icons (user_id, icon_slug, granted_reason) values (v_m4, 'first-witness', 'manual_admin_20260901');

  perform pg_temp.join_as(v_live2, v_m4, 'player', false, false);
  if pg_temp.mark(v_live2, v_m4) <> 'ok' then raise exception 'FAIL: 手動付与済みの利用者が到達記録を作れない'; end if;
  if pg_temp.grant_as(v_live2, v_m4) <> 'existing' then raise exception 'FAIL: 手動付与済みの利用者が新規扱いになった'; end if;
  if not exists (select 1 from public.user_titles where user_id = v_m4 and granted_reason = 'manual_admin_20260901')
     or (select count(*) from public.user_titles where user_id = v_m4) <> 1 then
    raise exception 'FAIL: 既存の手動付与の称号行が書き換わった・増えた';
  end if;
  if not exists (select 1 from public.user_limited_icons where user_id = v_m4 and granted_reason = 'manual_admin_20260901')
     or (select count(*) from public.user_limited_icons where user_id = v_m4) <> 1 then
    raise exception 'FAIL: 既存の手動付与のアイコン行が書き換わった・増えた';
  end if;
  if exists (select 1 from public.notifications where user_id = v_m4 and type = 'first_live_reward') then
    raise exception 'FAIL: 新規付与が無いのに限定特典の通知が作られた';
  end if;

  -- 運営の再付与（#2）：既に持っていれば変更せず、理由もそのまま
  v_r := pg_temp.regrant_as_host(v_live2, v_m4);
  if v_r <> 'existing' then raise exception 'FAIL: 運営の再付与が既存の手動付与を変えた(got=%)', v_r; end if;
  raise notice 'PASS: 既存の運営の手動付与（理由・所有行）は、本人経由・運営の再付与のいずれでも変更・削除されない';
end $$;

-- ============================================================
-- 8) 運営の再付与は、到達記録のある利用者へ対象ライブ（#2）の理由で付与する
-- ============================================================
do $$
declare
  v_m2 uuid := 'f0890000-0000-0000-0000-00000000a102';
  v_live2 uuid := 'f0890000-0000-0000-0000-00000000b002';
  v_r text;
begin
  -- m2は#2で観客として到達記録を作る（前の手順で#2の到達記録はまだ作っていない）
  perform pg_temp.reopen(v_live2);
  perform pg_temp.join_as(v_live2, v_m2, 'audience', false, false);
  if pg_temp.mark(v_live2, v_m2) <> 'ok' then raise exception 'FAIL: 観客の#2到達記録が作れない'; end if;
  v_r := pg_temp.regrant_as_host(v_live2, v_m2);
  if v_r <> 'new' then raise exception 'FAIL: 到達記録のある観客に運営の再付与ができない(got=%)', v_r; end if;
  if not exists (select 1 from public.user_titles where user_id = v_m2 and granted_reason = 'official_0002_final_result') then
    raise exception 'FAIL: 運営の再付与の理由が対象ライブ（#0002）になっていない';
  end if;
  if (select count(*) from public.notifications where user_id = v_m2 and type = 'first_live_reward') <> 1 then
    raise exception 'FAIL: 運営の再付与で通知が1件になっていない';
  end if;
  raise notice 'PASS: 運営の再付与は到達記録のある観客に対象ライブ（#0002）の理由で付与され、通知は1件';
end $$;

-- ============================================================
-- 9) 参加者行のゲストフラグ単独（匿名認証ではない・X identityあり・観客・participants.is_guest=true）は除外される
--    profiles.is_guest・auth.users.is_anonymousのどちらも偽のまま、参加者行のフラグだけで拒否されることを示す。
-- ============================================================
insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0890000-0000-0000-0000-00000000a110', false, '{"provider":"x"}'::jsonb)
on conflict do nothing;
insert into auth.identities (user_id, provider) values
  ('f0890000-0000-0000-0000-00000000a110', 'x')
on conflict do nothing;

do $$
declare
  v_g uuid := 'f0890000-0000-0000-0000-00000000a110';
  v_live2 uuid := 'f0890000-0000-0000-0000-00000000b002';
  v_r text;
begin
  -- 前提の確認：本人の判定（匿名・is_guest）は偽、X identityは真
  if (select is_anonymous from auth.users where id = v_g) or (select is_guest from public.profiles where id = v_g) then
    raise exception 'FAIL: 前提が崩れている（匿名・プロフィールのis_guestが真）';
  end if;
  if not public._is_x_login_identity(v_g) or public._is_guest_identity(v_g, false) then
    raise exception 'FAIL: 前提が崩れている（X identityなし、または身元判定でゲスト扱い）';
  end if;

  perform pg_temp.reopen(v_live2);
  insert into public.participants (live_id, user_id, role, preferred_role, is_guest, guest_number)
    values (v_live2, v_g, 'audience', 'audience', true, 9);

  -- (a) 本人の到達記録は拒否（参加者行のフラグで判定）
  v_r := pg_temp.mark(v_live2, v_g);
  if v_r not like '%GUEST_NOT_ELIGIBLE%' then raise exception 'FAIL: 参加者行がゲストの利用者が到達記録を作れた(got=%)', v_r; end if;

  -- (b) 到達記録を直接用意しても、本人経由の付与は拒否
  insert into public.final_result_presence (live_id, user_id, participant_id)
    select v_live2, v_g, p.id from public.participants p where p.live_id = v_live2 and p.user_id = v_g;
  v_r := pg_temp.grant_as(v_live2, v_g);
  if v_r not like '%GUEST_NOT_ELIGIBLE%' then raise exception 'FAIL: 到達記録があっても参加者行がゲストなら本人付与できてしまった(got=%)', v_r; end if;

  -- (c) 運営の再付与も拒否
  v_r := pg_temp.regrant_as_host(v_live2, v_g);
  if v_r not like '%GUEST_NOT_ELIGIBLE%' then raise exception 'FAIL: 運営の再付与で参加者行がゲストの利用者に付与された(got=%)', v_r; end if;

  -- (d) 称号・限定アイコン・通知は一切作られない
  if exists (select 1 from public.user_titles where user_id = v_g)
     or exists (select 1 from public.user_limited_icons where user_id = v_g)
     or exists (select 1 from public.notifications where user_id = v_g and type = 'first_live_reward') then
    raise exception 'FAIL: 参加者行のゲストフラグだけの利用者に限定特典（称号・アイコン・通知）が作られた';
  end if;
  raise notice 'PASS: 匿名認証ではなくX identityがあっても、参加者行のis_guest=trueだけで到達記録・本人付与・運営の再付与が拒否され、限定特典は作られない';
end $$;

-- ============================================================
-- 後始末：このファイルのライブを閉じ、開催番号を1000番台へ退避する（後続のテストと衝突させない）
-- ============================================================
update public.lives set current_phase = 'closed' where current_phase <> 'closed';
update public.lives set official_sequence_number = official_sequence_number + 1000
  where official_sequence_number between 1 and 9;
