-- 0081 回帰テスト：称号システム（通常/限定）、初回本番ライブ(#0001)限定特典の
-- 到達記録(mark_final_result_presence)・付与(grant_first_live_reward)・
-- 装備(set_equipped_title/set_equipped_limited_icon)・管理RPCを検証する。
-- 実行方法はsupabase/tests/run.sh参照（全*.test.sqlが同一DBを共有するため、
-- official_sequence_number=1は既存の0068等のテストが使用済みの可能性があり、
-- 冒頭で安全に「空き番号」へ退避してから自前の#1ライブを作る）。

\set ON_ERROR_STOP on

create temporary table _t0081_ctx (key text primary key, id uuid);

-- ============================================================
-- フィクスチャ準備
-- ============================================================
do $$
declare
  v_taken_by uuid;
begin
  -- official_sequence_number=1は既存テスト（0068等）が使用済みの可能性があるため、
  -- 既にそのテストのassertionは完了している前提で、大きな試験専用番号へ退避する
  -- （他の*.test.sqlの既存データそのものは削除しない、番号だけ変更する）。
  select id into v_taken_by from public.lives where official_sequence_number = 1;
  if v_taken_by is not null then
    update public.lives set official_sequence_number = 981099 where id = v_taken_by;
  end if;

  -- lives_one_active_idx（0055、current_phase<>'closed'の行は全体で高々1件という
  -- 部分UNIQUE INDEX）があるため、他の*.test.sqlが非closedのまま残したライブが
  -- あれば、そのテストのassertionは既に完了している前提でclosedへ倒す
  -- （このファイル用の非closedライブを安全に作るため）。
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0810000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- hostU（後でadmin化）
  ('f0810000-0000-0000-0000-00000000a002', false, '{"provider":"x"}'::jsonb), -- x1（メインの正常系ユーザー）
  ('f0810000-0000-0000-0000-00000000a003', false, '{"provider":"x"}'::jsonb), -- x2（観客側）
  ('f0810000-0000-0000-0000-00000000a004', true,  '{"provider":"anonymous"}'::jsonb), -- guest1
  ('f0810000-0000-0000-0000-00000000a005', false, '{"provider":"email"}'::jsonb), -- bot1（ボット＝メール+パスワード）
  ('f0810000-0000-0000-0000-00000000a006', false, '{"provider":"x"}'::jsonb), -- kicked1
  ('f0810000-0000-0000-0000-00000000a007', false, '{"provider":"x"}'::jsonb), -- xOther（到達記録なし）
  ('f0810000-0000-0000-0000-00000000a008', false, '{"provider":"x"}'::jsonb), -- xNeverPresent（final_result中に一度もmarkしない）
  ('f0810000-0000-0000-0000-00000000a009', false, '{"provider":"x"}'::jsonb), -- xReturned（途中離脱→final_result中に戻る想定）
  ('f0810000-0000-0000-0000-00000000a010', false, '{}'::jsonb), -- xViaIdentityOnly（raw_app_meta_dataにproviderが無く、auth.identitiesだけでX判定される）
  ('f0810000-0000-0000-0000-00000000a011', false, '{}'::jsonb), -- noProviderInfo（provider情報が一切無い＝X会員扱いにしない）
  ('f0810000-0000-0000-0000-00000000a012', false, '{"provider":"x"}'::jsonb), -- xCorruptedPresence（存在しないparticipant_idを指す到達記録を人工的に作るテスト専用）
  ('f0810000-0000-0000-0000-00000000a013', false, '{"provider":"x"}'::jsonb)  -- xMismatchedPresence（別ライブのparticipant行を指す到達記録を人工的に作るテスト専用）
on conflict do nothing;

-- xViaIdentityOnlyは、auth.identities.provider='x'の行だけでXログインと判定されることを確認する
-- （raw_app_meta_data->>'provider'は意図的に空にしてある）。
insert into auth.identities (user_id, provider) values
  ('f0810000-0000-0000-0000-00000000a010', 'x')
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0810000-0000-0000-0000-00000000a001';

-- lives_one_active_idx対策：liveOff1だけを非closed('answering')で作り、
-- 残りは最初からclosedにしておく（後続のテストで、使う直前に一時的に
-- final_resultへ進め、確認後は必ずclosedへ戻す＝常に非closedは高々1件を維持する）。
-- 緊急中止のテスト（24番）は、official_sequence_number=1を専有しているliveOff1
-- 自身にemergency_closed=trueを一時的に立てて確認する（official_sequence_number
-- はNULL以外で一意のため、#1を名乗る行をもう1本別に作ることはできない）。
insert into public.lives (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
values
  ('f0810000-0000-0000-0000-00000000b001', now(), 'answering', 'official', 1, false),
  ('f0810000-0000-0000-0000-00000000b002', now(), 'closed', 'official', 981002, false),
  ('f0810000-0000-0000-0000-00000000b003', now(), 'closed', 'test', null, false);

insert into public.participants (id, live_id, user_id, role, preferred_role, is_guest, guest_number, kicked_at) values
  ('f0810000-0000-0000-0000-00000000c001', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a002', 'player', 'player', false, null, null),
  ('f0810000-0000-0000-0000-00000000c002', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a003', 'audience', 'audience', false, null, null),
  ('f0810000-0000-0000-0000-00000000c003', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a004', 'audience', 'audience', true, 1, null),
  ('f0810000-0000-0000-0000-00000000c004', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a005', 'player', 'player', false, null, null),
  ('f0810000-0000-0000-0000-00000000c005', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a006', 'player', 'player', false, null, now()),
  ('f0810000-0000-0000-0000-00000000c006', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a007', 'player', 'player', false, null, null),
  ('f0810000-0000-0000-0000-00000000c007', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a008', 'player', 'player', false, null, null),
  ('f0810000-0000-0000-0000-00000000c011', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a009', 'player', 'player', false, null, null),
  ('f0810000-0000-0000-0000-00000000c008', 'f0810000-0000-0000-0000-00000000b002', 'f0810000-0000-0000-0000-00000000a002', 'player', 'player', false, null, null),
  ('f0810000-0000-0000-0000-00000000c009', 'f0810000-0000-0000-0000-00000000b003', 'f0810000-0000-0000-0000-00000000a002', 'player', 'player', false, null, null),
  -- テスト用（PARTICIPANT_NOT_FOUND・live_id/user_id不一致の検証）：
  -- xCorruptedPresenceはliveOff1の正規のparticipant行を持つが、テスト内で
  -- final_result_presence.participant_idだけを存在しないIDへ人工的に差し替える。
  ('f0810000-0000-0000-0000-00000000c012', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a012', 'player', 'player', false, null, null),
  -- xMismatchedPresenceはliveOff1・liveOff2の両方にparticipant行を持つ。
  -- liveOff1向けのfinal_result_presenceに、liveOff2側のparticipant_idを
  -- 人工的に指定し、「participant_idだけでなくlive_id・user_idも一致させる」
  -- チェックの効果を確認する。
  ('f0810000-0000-0000-0000-00000000c013', 'f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a013', 'player', 'player', false, null, null),
  ('f0810000-0000-0000-0000-00000000c014', 'f0810000-0000-0000-0000-00000000b002', 'f0810000-0000-0000-0000-00000000a013', 'player', 'player', false, null, null);

-- ============================================================
-- テスト1: 通常会員は通常称号を選べる。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  perform public.set_equipped_title('rookie-laugh');
end $$;
reset role;

do $$
declare
  v_slug text;
begin
  select equipped_title_slug into v_slug from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  if v_slug <> 'rookie-laugh' then
    raise exception 'FAIL: 通常称号の装備が反映されていない(got=%)', v_slug;
  end if;
  raise notice 'PASS: 通常会員が通常称号を選べる';
end $$;

-- ============================================================
-- テスト2: 称号なしへ戻せる。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  perform public.set_equipped_title(null);
end $$;
reset role;

do $$
declare
  v_slug text;
begin
  select equipped_title_slug into v_slug from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  if v_slug is not null then
    raise exception 'FAIL: 称号なしへ戻せていない(got=%)', v_slug;
  end if;
  raise notice 'PASS: 称号なしへ戻せる';
end $$;

-- ============================================================
-- テスト3: ゲストは称号を変更できない。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a004', true);
  begin
    perform public.set_equipped_title('rookie-laugh');
    raise exception 'FAIL: ゲストが称号を変更できてしまった';
  exception
    when others then
      if sqlerrm <> 'GUEST_NOT_ELIGIBLE' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: ゲストはGUEST_NOT_ELIGIBLEで拒否される';
  end;
end $$;
reset role;

-- ============================================================
-- テスト4・11: 他人の称号・限定アイコンをprofilesへの直接UPDATEで変更できない
-- （自分の行であっても、この2列にはUPDATE権限自体が無い＝抜け道が無いことの確認）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a003', true);
  begin
    update public.profiles set equipped_title_slug = 'first-witness'
      where id = 'f0810000-0000-0000-0000-00000000a002'; -- 他人(x1)の行
    raise exception 'FAIL: 他人のequipped_title_slugを直接UPDATEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 他人のequipped_title_slugへの直接UPDATEは権限自体が無く拒否される';
  end;
  begin
    update public.profiles set equipped_title_slug = 'rookie-laugh'
      where id = 'f0810000-0000-0000-0000-00000000a003'; -- 自分の行でも同様
    raise exception 'FAIL: 自分のequipped_title_slugすら直接UPDATEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 自分の行でもequipped_title_slugへの直接UPDATEは権限自体が無く拒否される（set_equipped_title経由のみ）';
  end;
  begin
    update public.profiles set equipped_limited_icon_slug = 'first-witness'
      where id = 'f0810000-0000-0000-0000-00000000a003';
    raise exception 'FAIL: equipped_limited_icon_slugを直接UPDATEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: equipped_limited_icon_slugへの直接UPDATEも権限自体が無く拒否される';
  end;
end $$;
reset role;

-- ============================================================
-- テスト5: 未所有の限定称号を装備できない。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  begin
    perform public.set_equipped_title('first-witness');
    raise exception 'FAIL: 未所有の限定称号を装備できてしまった';
  exception
    when others then
      if sqlerrm <> 'TITLE_NOT_OWNED' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 未所有の限定称号はTITLE_NOT_OWNEDで拒否される';
  end;
end $$;
reset role;

-- ============================================================
-- テスト8: 通常アイコン（既存のavatar_icon/avatar_color直接更新）は
-- 今回の変更後も従来どおり動く（回帰確認）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  update public.profiles set avatar_icon = 'afro', avatar_color = '#112233'
    where id = 'f0810000-0000-0000-0000-00000000a002';
end $$;
reset role;

do $$
declare
  v_icon text;
  v_color text;
begin
  select avatar_icon, avatar_color into v_icon, v_color
    from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  if v_icon <> 'afro' or v_color <> '#112233' then
    raise exception 'FAIL: 通常アイコンの直接更新が効いていない(icon=%, color=%)', v_icon, v_color;
  end if;
  raise notice 'PASS: 通常アイコン(avatar_icon/avatar_color)の直接更新は従来どおり動く';
end $$;

-- ============================================================
-- テスト9: 未所有の限定アイコンを選択できない。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  begin
    perform public.set_equipped_limited_icon('first-witness');
    raise exception 'FAIL: 未所有の限定アイコンを選択できてしまった';
  exception
    when others then
      if sqlerrm <> 'ICON_NOT_OWNED' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 未所有の限定アイコンはICON_NOT_OWNEDで拒否される';
  end;
end $$;
reset role;

-- ============================================================
-- テスト31: Xログイン会員（auth.identities.provider='x'のみで判定される
-- xViaIdentityOnly、raw_app_meta_data->>'providerは空）は通常称号を装備できる。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a010', true); -- xViaIdentityOnly
  perform public.set_equipped_title('wannabe-boke');
end $$;
reset role;

do $$
declare
  v_slug text;
begin
  select equipped_title_slug into v_slug from public.profiles where id = 'f0810000-0000-0000-0000-00000000a010';
  if v_slug <> 'wannabe-boke' then
    raise exception 'FAIL: auth.identities経由のXログイン会員が通常称号を装備できない(got=%)', v_slug;
  end if;
  raise notice 'PASS: auth.identities.provider=xのみで判定されるXログイン会員も通常称号を装備できる';
end $$;

-- ============================================================
-- テスト32: email/passwordボットは通常称号を装備できない（ゲストではないが
-- Xログインでもないため拒否される）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a005', true); -- bot1
  begin
    perform public.set_equipped_title('rookie-laugh');
    raise exception 'FAIL: ボットが通常称号を装備できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_X_LOGIN' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: email/passwordボットはNOT_X_LOGINで通常称号を装備できない';
  end;
  begin
    perform public.set_equipped_limited_icon('first-witness');
    raise exception 'FAIL: ボットが限定アイコンを装備できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_X_LOGIN' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: email/passwordボットはNOT_X_LOGINで限定アイコンも装備できない（未所有チェックより先に拒否される）';
  end;
end $$;
reset role;

-- ============================================================
-- テスト33: provider情報が一切無い（raw_app_meta_data={}、auth.identitiesにも
-- 行が無い）非匿名アカウントは、Xログイン会員として扱わない（「非匿名だから」で
-- 推測しないことの確認）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a011', true); -- noProviderInfo
  begin
    perform public.set_equipped_title('rookie-laugh');
    raise exception 'FAIL: provider情報の無いアカウントが通常称号を装備できてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_X_LOGIN' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: provider情報が無いアカウントはNOT_X_LOGINで拒否される（非匿名という理由だけでX会員扱いにしない）';
  end;
end $$;
reset role;

-- ============================================================
-- テスト35: admin_count_x_login_membersは、ゲスト・ボット・provider情報無しを
-- 除外した実際のXログイン会員数を返す。
-- 現時点でのXログイン非ゲスト会員：a001,a002,a003,a006,a007,a008,a009,a010,
-- a012,a013 の10名（a004=ゲスト、a005=ボット、a011=provider情報無し は除外）。
-- ============================================================
do $$
declare
  v_count bigint;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a001', true); -- hostU(admin)
  select public.admin_count_x_login_members() into v_count;
  if v_count <> 10 then
    raise exception 'FAIL: admin_count_x_login_membersがゲスト・ボット等を正しく除外していない(got=%)', v_count;
  end if;
  raise notice 'PASS: admin_count_x_login_membersはゲスト・ボット・provider情報無しを除外したXログイン会員数を返す';
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true); -- x1(一般会員)
  begin
    perform public.admin_count_x_login_members();
    raise exception 'FAIL: 一般会員がadmin_count_x_login_membersを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 一般会員はadmin_count_x_login_membersを実行できない';
  end;
end $$;
reset role;

-- ============================================================
-- テスト21: final_resultより前には到達記録を作れない（liveOff1はまだ'answering'）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a008', true); -- xNeverPresent
  begin
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a008');
    raise exception 'FAIL: final_result前でも到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_FINAL_RESULT_PHASE' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: final_resultより前はNOT_FINAL_RESULT_PHASEで到達記録を作れない';
  end;
end $$;
reset role;

-- liveOff1をfinal_resultへ進める。
update public.lives set current_phase = 'final_result' where id = 'f0810000-0000-0000-0000-00000000b001';

-- ============================================================
-- テスト12: プレイヤーのfinal_result到達記録。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true); -- x1(player)
  perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a002');
end $$;
reset role;

do $$
declare
  v_row record;
begin
  select * into v_row from public.final_result_presence
    where live_id = 'f0810000-0000-0000-0000-00000000b001' and user_id = 'f0810000-0000-0000-0000-00000000a002';
  if v_row.id is null or v_row.participant_id <> 'f0810000-0000-0000-0000-00000000c001' then
    raise exception 'FAIL: プレイヤーの到達記録が正しく保存されていない';
  end if;
  raise notice 'PASS: プレイヤーのfinal_result到達記録が保存される';
end $$;

-- ============================================================
-- テスト13: 観客のfinal_result到達記録。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a003', true); -- x2(audience)
  perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a003');
end $$;
reset role;

do $$
declare
  v_row record;
begin
  select * into v_row from public.final_result_presence
    where live_id = 'f0810000-0000-0000-0000-00000000b001' and user_id = 'f0810000-0000-0000-0000-00000000a003';
  if v_row.id is null then
    raise exception 'FAIL: 観客の到達記録が保存されていない';
  end if;
  raise notice 'PASS: 観客のfinal_result到達記録が保存される';
end $$;

-- ============================================================
-- テスト15: 途中離脱後、final_result中に戻った場合は付与される
-- （xReturnedは他のフェーズには一切接続していなかった想定。final_result中に
-- 呼べば、過去の接続有無に関わらず到達記録が作られることを示す）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a009', true); -- xReturned
  perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a009');
end $$;
reset role;

do $$
declare
  v_result public.first_live_reward_result;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a009', true);
  -- 注意：ここは`select ... into v_result`ではなく`v_result := ...`を使う。
  -- PL/pgSQLは複合型を返す関数呼び出しを`select func() into 複合型変数`で受けると、
  -- 1列しか無い結果セットを「フィールド数ぶんの列がある」ものとして展開しようとし、
  -- 複合値のテキスト表現がそのまま先頭フィールド(boolean)へ渡って
  -- invalid input syntax for type booleanになる（実際に踏んだ挙動、直接代入なら正しく動く）。
  v_result := public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a009');
  if not v_result.newly_granted then
    raise exception 'FAIL: 途中離脱後final_result中に戻ったケースで付与されなかった';
  end if;
  if v_result.title_display_name <> '最初の目撃者' then
    raise exception 'FAIL: 戻り値のtitle_display_nameが想定と違う(got=%)', v_result.title_display_name;
  end if;
end $$;
reset role;
do $$ begin raise notice 'PASS: 途中離脱後、final_result中に戻れば到達記録・付与とも成立し、戻り値に現在の表示名が入る'; end $$;

-- ============================================================
-- テスト16: ゲストは付与されない（到達記録自体が作れない）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a004', true); -- guest1
  begin
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a004');
    raise exception 'FAIL: ゲストが到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'GUEST_NOT_ELIGIBLE' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: ゲストはGUEST_NOT_ELIGIBLEで到達記録を作れない（＝付与もされない）';
  end;
end $$;
reset role;

-- ============================================================
-- テスト17: ボットは付与されない（provider='x'ではないため）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a005', true); -- bot1
  begin
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a005');
    raise exception 'FAIL: ボットが到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_X_LOGIN' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: ボット（provider<>x）はNOT_X_LOGINで到達記録を作れない';
  end;
end $$;
reset role;

-- ============================================================
-- テスト18: 退場済み利用者は付与されない。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a006', true); -- kicked1
  begin
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a006');
    raise exception 'FAIL: 退場済み利用者が到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'PARTICIPANT_KICKED' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 退場済み利用者はPARTICIPANT_KICKEDで到達記録を作れない';
  end;
end $$;
reset role;

-- ============================================================
-- テスト37: mark_final_result_presenceは、p_expected_user_idが実際の認証ユーザー
-- (auth.uid())と一致しない場合はUSER_MISMATCHで拒否する（xOtherは他のテストでは
-- 一度もmarkしない前提のユーザーのため、ここで使っても後続のテスト14の前提
-- 「xOtherは一度もmarkしていない」を崩さない＝この呼び出しは失敗して当然）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a007', true); -- xOther本人として認証
  begin
    -- 期待利用者IDにx1(a002)を渡す（実際の認証ユーザーxOtherとは異なる）。
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a002');
    raise exception 'FAIL: p_expected_user_idが不一致でも到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'USER_MISMATCH' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: mark_final_result_presenceはp_expected_user_idが実際の認証ユーザーと不一致だとUSER_MISMATCHで拒否する';
  end;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.final_result_presence where user_id = 'f0810000-0000-0000-0000-00000000a007';
  if v_count <> 0 then
    raise exception 'FAIL: USER_MISMATCHで拒否されたはずのxOtherに到達記録が作られている';
  end if;
end $$;

-- ============================================================
-- テスト38: grant_first_live_rewardも同様にp_expected_user_idの不一致を
-- USER_MISMATCHで拒否する（x1は既にテスト12で到達記録済みだが、テスト23より前の
-- この時点ではまだ一度もgrantしていないため、誤って付与されていないことも確認できる）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true); -- x1本人として認証
  begin
    -- 期待利用者IDにx2(a003)を渡す（実際の認証ユーザーx1とは異なる）。
    perform public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a003');
    raise exception 'FAIL: p_expected_user_idが不一致でも付与できてしまった';
  exception
    when others then
      if sqlerrm <> 'USER_MISMATCH' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: grant_first_live_rewardはp_expected_user_idが実際の認証ユーザーと不一致だとUSER_MISMATCHで拒否する';
  end;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.user_titles where user_id = 'f0810000-0000-0000-0000-00000000a002';
  if v_count <> 0 then
    raise exception 'FAIL: USER_MISMATCHで拒否されたはずのx1に称号が付与されている（誤って他人の意図で実行された）';
  end if;
  raise notice 'PASS: USER_MISMATCHで拒否された呼び出しでは称号・アイコンのいずれも付与されない';
end $$;

-- ============================================================
-- テスト30（先に計測）：本番開催番号・ポイント・段位・実績への影響が無いことの
-- ベースライン計測（x2は今回一度もgrant_first_live_rewardを呼んでいない）。
-- ============================================================
create temporary table _t0081_baseline as
select last_value as counter_before from public.official_live_counter;

do $$
declare
  v_points int; v_mastery int; v_live_count int;
begin
  select total_points, mastery_meter, live_count into v_points, v_mastery, v_live_count
    from public.profiles where id = 'f0810000-0000-0000-0000-00000000a003';
  if v_points <> 0 or v_mastery <> 0 or v_live_count <> 0 then
    raise exception 'FAIL: テスト前提が崩れている(x2のpoints/mastery/live_countが0でない)';
  end if;
end $$;

-- ============================================================
-- lives_one_active_idx（現在非closedの行は全体で高々1件）があるため、
-- テスト19・20・24はliveOff1をclosedへ進めてから、対象のライブだけを
-- 順番にfinal_resultへ進めて確認し、都度closedへ戻す。
-- ============================================================
update public.lives set current_phase = 'closed' where id = 'f0810000-0000-0000-0000-00000000b001';

-- ---- テスト19: testライブでは付与されない。 ----
update public.lives set current_phase = 'final_result' where id = 'f0810000-0000-0000-0000-00000000b003';
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  begin
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b003', 'f0810000-0000-0000-0000-00000000a002'); -- liveTest1
    raise exception 'FAIL: テストライブで到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_FIRST_OFFICIAL_LIVE' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: テストライブはNOT_FIRST_OFFICIAL_LIVEで到達記録を作れない';
  end;
end $$;
reset role;
update public.lives set current_phase = 'closed' where id = 'f0810000-0000-0000-0000-00000000b003';

-- ---- テスト20: official #2以降では付与されない。 ----
update public.lives set current_phase = 'final_result' where id = 'f0810000-0000-0000-0000-00000000b002';
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  begin
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b002', 'f0810000-0000-0000-0000-00000000a002'); -- liveOff2(#2相当)
    raise exception 'FAIL: official #2で到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_FIRST_OFFICIAL_LIVE' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: official #2以降はNOT_FIRST_OFFICIAL_LIVEで到達記録を作れない';
  end;
end $$;
reset role;
update public.lives set current_phase = 'closed' where id = 'f0810000-0000-0000-0000-00000000b002';

-- ---- テスト24: 緊急中止ライブでは付与されない。 ----
-- official_sequence_number=1はliveOff1が専有しているため（一意制約）、緊急中止
-- 専用の別の#1ライブは作れない。liveOff1自身に一時的にemergency_closed=trueを
-- 立てて確認し、直後に元へ戻す（xNeverPresentはまだ一度も到達記録を作れていない
-- 利用者なので、ここで使っても後続のテスト22の前提を崩さない）。
update public.lives set current_phase = 'final_result', emergency_closed = true
  where id = 'f0810000-0000-0000-0000-00000000b001';
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a008', true); -- xNeverPresent
  begin
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a008'); -- liveOff1(一時的に緊急中止扱い)
    raise exception 'FAIL: 緊急中止ライブで到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'LIVE_EMERGENCY_CLOSED' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 緊急中止ライブはLIVE_EMERGENCY_CLOSEDで到達記録を作れない';
  end;
end $$;
reset role;
update public.lives set current_phase = 'closed', emergency_closed = false
  where id = 'f0810000-0000-0000-0000-00000000b001';

-- liveOff1は既にclosed（このすぐ上で進めた）。final_result中に既に到達記録済みの
-- 利用者は、closed後でも再付与できることを次のテストで確認する。

-- ============================================================
-- テスト22: closed後に新しい到達記録を作れない（xNeverPresentはfinal_result中に
-- 一度もmarkしていなかった）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a008', true); -- xNeverPresent
  begin
    perform public.mark_final_result_presence('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a008');
    raise exception 'FAIL: closed後に到達記録を作れてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_FINAL_RESULT_PHASE' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: closed後はNOT_FINAL_RESULT_PHASEで新しい到達記録を作れない';
  end;
end $$;
reset role;

-- ============================================================
-- テスト14: 到達記録が無ければ付与されない（xOtherは一度もmarkしていない）。
-- 参加者テーブルに行があるだけの一括付与にならないことの確認。
-- この時点でliveOff1は既にclosedのため、「presence無しではclosed後もgrantできない」
-- ことも併せて確認している。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a007', true); -- xOther
  begin
    perform public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a007');
    raise exception 'FAIL: 到達記録が無いのに付与できてしまった';
  exception
    when others then
      if sqlerrm <> 'NO_PRESENCE_RECORD' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 到達記録が無ければNO_PRESENCE_RECORDで付与されない（参加登録だけの一括付与を防止）';
  end;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.user_titles where user_id = 'f0810000-0000-0000-0000-00000000a007';
  if v_count <> 0 then
    raise exception 'FAIL: 到達記録の無いxOtherに称号が付与されている';
  end if;
end $$;

-- ============================================================
-- テスト39: 存在しないparticipant_idを指す到達記録があっても付与されない
-- （PARTICIPANT_NOT_FOUND）。final_result_presence.participant_idはpublic.
-- participants(id)へのFK制約があり通常このズレは起こらないが、防御的に実装した
-- NOT FOUND処理を検証するため、テスト専用にsession_replication_role=replicaで
-- 一時的にFK検証を無効化し、存在しないIDを指す到達記録を人工的に作る
-- （本番運用では絶対に発生しない操作であり、テストの後処理として直ちに元へ戻す）。
-- ============================================================
do $$
begin
  set session_replication_role = replica;
  insert into public.final_result_presence (live_id, user_id, participant_id)
  values (
    'f0810000-0000-0000-0000-00000000b001',
    'f0810000-0000-0000-0000-00000000a012',
    'ffffffff-ffff-ffff-ffff-ffffffffffff' -- 存在しないparticipant_id
  );
  set session_replication_role = default;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a012', true); -- xCorruptedPresence
  begin
    perform public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a012');
    raise exception 'FAIL: 存在しないparticipant_idを指す到達記録でも付与できてしまった';
  exception
    when others then
      if sqlerrm <> 'PARTICIPANT_NOT_FOUND' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 存在しないparticipant_idを指す到達記録はPARTICIPANT_NOT_FOUNDで拒否され、クラッシュせず安全に処理される';
  end;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.user_titles where user_id = 'f0810000-0000-0000-0000-00000000a012';
  if v_count <> 0 then
    raise exception 'FAIL: PARTICIPANT_NOT_FOUNDのはずのxCorruptedPresenceに称号が付与されている';
  end if;
end $$;

-- ============================================================
-- テスト40: 到達記録のparticipant_idが「存在はするが別ライブ・別利用者の
-- participant行」を指している場合も付与されない（participant_idだけでなく
-- live_id・user_idも一致させる条件の効果確認）。xMismatchedPresenceはliveOff1・
-- liveOff2の両方にparticipant行を持つ。liveOff1向けのfinal_result_presenceに、
-- liveOff2側のparticipant_id(c014)を人工的に指定する（FK自体はc014が実在する
-- ため通常のinsertで満たせる。ズレているのはlive_idの対応関係だけ）。
-- ============================================================
insert into public.final_result_presence (live_id, user_id, participant_id) values (
  'f0810000-0000-0000-0000-00000000b001',
  'f0810000-0000-0000-0000-00000000a013',
  'f0810000-0000-0000-0000-00000000c014' -- liveOff2側のparticipant_id（liveOff1向けなのに不一致）
);

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a013', true); -- xMismatchedPresence
  begin
    perform public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a013');
    raise exception 'FAIL: live_idが不一致のparticipant行を参照していても付与できてしまった';
  exception
    when others then
      if sqlerrm <> 'PARTICIPANT_NOT_FOUND' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: participant_idが実在してもlive_id・user_idが一致しなければPARTICIPANT_NOT_FOUNDで拒否される';
  end;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.user_titles where user_id = 'f0810000-0000-0000-0000-00000000a013';
  if v_count <> 0 then
    raise exception 'FAIL: live_id不一致で拒否されたはずのxMismatchedPresenceに称号が付与されている';
  end if;
  raise notice 'PASS: participant_id・live_id・user_idの全一致チェックにより、別ライブのparticipant行を誤って使えない';
end $$;

-- ============================================================
-- テスト23: final_result中に作った到達記録なら、closed後でも再付与できる
-- （x1は既にfinal_result中にmark済み。liveOff1は今closed）。
-- ============================================================
do $$
declare
  v_result public.first_live_reward_result;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true); -- x1
  v_result := public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a002');
  if not v_result.newly_granted then
    raise exception 'FAIL: closed後の再付与でnewly_granted=falseになった（初回付与のはず）';
  end if;
end $$;
reset role;
do $$ begin raise notice 'PASS: final_result中の到達記録があれば、ライブclosed後でも再付与できる'; end $$;

-- ============================================================
-- テスト25・26・27: 複数タブ・再試行（連続呼び出し）でも称号/アイコン所有行・
-- 通知はそれぞれ1件だけ。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  perform public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a002');
  perform public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a002');
  perform public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a002');
end $$;
reset role;

do $$
declare
  v_title_count int;
  v_icon_count int;
  v_notif_count int;
begin
  select count(*) into v_title_count from public.user_titles
    where user_id = 'f0810000-0000-0000-0000-00000000a002' and title_slug = 'first-witness';
  select count(*) into v_icon_count from public.user_limited_icons
    where user_id = 'f0810000-0000-0000-0000-00000000a002' and icon_slug = 'first-witness';
  select count(*) into v_notif_count from public.notifications
    where user_id = 'f0810000-0000-0000-0000-00000000a002' and type = 'first_live_reward';
  if v_title_count <> 1 then raise exception 'FAIL: 称号所有行が1件でない(count=%)', v_title_count; end if;
  if v_icon_count <> 1 then raise exception 'FAIL: アイコン所有行が1件でない(count=%)', v_icon_count; end if;
  if v_notif_count <> 1 then raise exception 'FAIL: 通知が1件でない(count=%)', v_notif_count; end if;
  raise notice 'PASS: 複数回のgrant_first_live_reward呼び出しでも称号・アイコン所有行・通知はそれぞれ1件のまま';
end $$;

-- ============================================================
-- テスト6・10: 所有済み限定称号・限定アイコンは装備できる。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true);
  perform public.set_equipped_title('first-witness');
  perform public.set_equipped_limited_icon('first-witness');
end $$;
reset role;

do $$
declare
  v_title text;
  v_icon text;
begin
  select equipped_title_slug, equipped_limited_icon_slug into v_title, v_icon
    from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  if v_title <> 'first-witness' or v_icon <> 'first-witness' then
    raise exception 'FAIL: 所有済み限定称号/アイコンの装備が反映されない(title=%, icon=%)', v_title, v_icon;
  end if;
  raise notice 'PASS: 所有済みの限定称号・限定アイコンは装備できる';
end $$;

-- ============================================================
-- テスト7: 表示名を変更しても所有情報が残る（管理RPCで表示名を変更）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a001', true); -- hostU(admin)
  perform public.admin_update_title('first-witness', '最初の目撃者（改称）', '表示名変更テスト', 0, true);
end $$;
reset role;

do $$
declare
  v_owned boolean;
  v_equipped text;
  v_display text;
begin
  select exists(
    select 1 from public.user_titles where user_id = 'f0810000-0000-0000-0000-00000000a002' and title_slug = 'first-witness'
  ) into v_owned;
  select equipped_title_slug into v_equipped from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  select display_name into v_display from public.titles where slug = 'first-witness';
  if not v_owned then raise exception 'FAIL: 表示名変更後に所有情報が消えた'; end if;
  if v_equipped <> 'first-witness' then raise exception 'FAIL: 表示名変更後に装備状態が崩れた(got=%)', v_equipped; end if;
  if v_display <> '最初の目撃者（改称）' then raise exception 'FAIL: 管理RPCでの表示名変更が反映されていない(got=%)', v_display; end if;
  raise notice 'PASS: 称号の表示名を変更しても所有情報・装備状態はslugベースでそのまま残る';
end $$;

-- ============================================================
-- テスト36: 改称後に新しく作られる通知本文・戻り値には新しい表示名が使われる
-- （x2は既にfinal_result中にmark済み(テスト13)だが、まだ一度もgrantを呼んでいない）。
-- ============================================================
do $$
declare
  v_result public.first_live_reward_result;
  v_body text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a003', true); -- x2
  v_result := public.grant_first_live_reward('f0810000-0000-0000-0000-00000000b001', 'f0810000-0000-0000-0000-00000000a003');
  if not v_result.newly_granted then
    raise exception 'FAIL: x2への初回付与でnewly_granted=falseになった';
  end if;
  if v_result.title_display_name <> '最初の目撃者（改称）' then
    raise exception 'FAIL: grant_first_live_rewardの戻り値が改称後の表示名になっていない(got=%)', v_result.title_display_name;
  end if;
  select body into v_body from public.notifications
    where user_id = 'f0810000-0000-0000-0000-00000000a003' and type = 'first_live_reward';
  if v_body not like '%最初の目撃者（改称）%' then
    raise exception 'FAIL: 通知本文に改称後の表示名が使われていない(got=%)', v_body;
  end if;
  raise notice 'PASS: 改称後に新しく作られる通知本文・戻り値には現在の表示名が使われる';
end $$;
reset role;

-- ============================================================
-- テスト41: 通常称号を非公開にすると、既に装備中の利用者から解除される
-- （所有記録の概念が無い通常称号でも、装備状態(equipped_title_slug)は解除する）。
-- xViaIdentityOnly(a010)はテスト31で'wannabe-boke'を装備済み。
-- ============================================================
do $$
declare
  v_equipped text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a001', true); -- hostU(admin)
  perform public.admin_update_title('wannabe-boke', 'ボケたがり', null, 20, false); -- 非公開化
end $$;
reset role;

do $$
declare
  v_equipped text;
begin
  select equipped_title_slug into v_equipped from public.profiles where id = 'f0810000-0000-0000-0000-00000000a010';
  if v_equipped is not null then
    raise exception 'FAIL: 通常称号を非公開にしても装備中の利用者から解除されない(got=%)', v_equipped;
  end if;
  raise notice 'PASS: 通常称号を非公開にすると、装備中だった利用者のequipped_title_slugがnullへ解除される';
end $$;

-- 非公開の間は、直接RPCでの新規装備（再装備含む）も拒否される。
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a010', true); -- xViaIdentityOnly
  begin
    perform public.set_equipped_title('wannabe-boke');
    raise exception 'FAIL: 非公開の通常称号を装備できてしまった';
  exception
    when others then
      if sqlerrm <> 'TITLE_NOT_ACTIVE' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 非公開の通常称号はTITLE_NOT_ACTIVEで新規装備（再装備）を拒否する';
  end;
end $$;
reset role;

-- 再公開後は利用者が自分で再装備できる。
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a001', true); -- hostU(admin)
  perform public.admin_update_title('wannabe-boke', 'ボケたがり', null, 20, true); -- 再公開
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a010', true); -- xViaIdentityOnly
  perform public.set_equipped_title('wannabe-boke');
end $$;
reset role;

do $$
declare
  v_equipped text;
begin
  select equipped_title_slug into v_equipped from public.profiles where id = 'f0810000-0000-0000-0000-00000000a010';
  if v_equipped <> 'wannabe-boke' then
    raise exception 'FAIL: 再公開後に利用者が自分で再装備できない(got=%)', v_equipped;
  end if;
  raise notice 'PASS: 再公開後は利用者が自分で再装備できる（通常称号）';
end $$;

-- ============================================================
-- テスト42: 限定称号を非公開にしても同様に解除されるが、所有記録
-- (user_titles)は削除しない。再公開後は再装備できる。x1(a002)は
-- テスト6・10で'first-witness'を装備済み。
-- ============================================================
do $$
declare
  v_equipped text;
begin
  select equipped_title_slug into v_equipped from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  if v_equipped <> 'first-witness' then
    raise exception 'FAIL: テスト前提が崩れている(x1がfirst-witnessを装備していない, got=%)', v_equipped;
  end if;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a001', true); -- hostU(admin)
  perform public.admin_update_title('first-witness', '最初の目撃者（改称）', '表示名変更テスト', 0, false); -- 非公開化
end $$;
reset role;

do $$
declare
  v_equipped text;
  v_owned boolean;
begin
  select equipped_title_slug into v_equipped from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  if v_equipped is not null then
    raise exception 'FAIL: 限定称号を非公開にしても装備中の利用者から解除されない(got=%)', v_equipped;
  end if;
  select exists(
    select 1 from public.user_titles where user_id = 'f0810000-0000-0000-0000-00000000a002' and title_slug = 'first-witness'
  ) into v_owned;
  if not v_owned then
    raise exception 'FAIL: 非公開化で所有記録(user_titles)まで消えてしまった';
  end if;
  raise notice 'PASS: 限定称号を非公開にすると装備は解除されるが、所有記録(user_titles)は削除されない';
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true); -- x1
  begin
    perform public.set_equipped_title('first-witness');
    raise exception 'FAIL: 非公開の限定称号を再装備できてしまった';
  exception
    when others then
      if sqlerrm <> 'TITLE_NOT_ACTIVE' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 非公開の限定称号はTITLE_NOT_ACTIVEで再装備を拒否する（所有していても装備はできない）';
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a001', true); -- hostU(admin)
  perform public.admin_update_title('first-witness', '最初の目撃者（改称）', '表示名変更テスト', 0, true); -- 再公開
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true); -- x1
  perform public.set_equipped_title('first-witness');
end $$;
reset role;

do $$
declare
  v_equipped text;
begin
  select equipped_title_slug into v_equipped from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  if v_equipped <> 'first-witness' then
    raise exception 'FAIL: 再公開後に所有者が自分で再装備できない(got=%)', v_equipped;
  end if;
  raise notice 'PASS: 再公開後は所有者が自分で再装備できる（限定称号）';
end $$;

-- ============================================================
-- テスト28: 一般会員・ゲストは管理RPCを使えない。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a002', true); -- x1(一般会員)
  begin
    perform public.admin_update_title('first-witness', 'x', null, 0, true);
    raise exception 'FAIL: 一般会員がadmin_update_titleを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 一般会員はadmin_update_titleを実行できない';
  end;
  begin
    perform public.admin_list_final_result_presence('f0810000-0000-0000-0000-00000000b001');
    raise exception 'FAIL: 一般会員がadmin_list_final_result_presenceを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 一般会員はadmin_list_final_result_presenceを実行できない';
  end;
  begin
    perform public.admin_regrant_first_live_reward('f0810000-0000-0000-0000-00000000a007', 'f0810000-0000-0000-0000-00000000b001');
    raise exception 'FAIL: 一般会員がadmin_regrant_first_live_rewardを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: 一般会員はadmin_regrant_first_live_rewardを実行できない';
  end;
end $$;
reset role;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a004', true); -- guest1
  begin
    perform public.admin_update_title('first-witness', 'x', null, 0, true);
    raise exception 'FAIL: ゲストがadmin_update_titleを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
      raise notice 'PASS: ゲストはadmin_update_titleを実行できない';
  end;
end $$;
reset role;

-- admin_regrant_first_live_reward自体の正常系（到達記録がある利用者への再付与）も確認しておく。
do $$
declare
  v_result public.first_live_reward_result;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a001', true); -- hostU(admin)
  v_result := public.admin_regrant_first_live_reward('f0810000-0000-0000-0000-00000000a002', 'f0810000-0000-0000-0000-00000000b001');
  if v_result.newly_granted then
    raise exception 'FAIL: 既に付与済みのx1への再付与でnewly_granted=trueになった（冪等でない）';
  end if;
  -- 到達記録の無いxOtherを対象にすると、一括付与にならず失敗する。
  begin
    perform public.admin_regrant_first_live_reward('f0810000-0000-0000-0000-00000000a007', 'f0810000-0000-0000-0000-00000000b001');
    raise exception 'FAIL: 到達記録の無い利用者へ運営が再付与できてしまった（一括付与の抜け道）';
  exception
    when others then
      if sqlerrm <> 'NO_PRESENCE_RECORD' then raise exception 'FAIL: 想定外のエラー(%)', sqlerrm; end if;
  end;
end $$;
reset role;
do $$ begin raise notice 'PASS: admin_regrant_first_live_rewardは到達記録の無い利用者には使えず、参加者全員への一括付与にならない'; end $$;

-- admin_list_final_result_presenceの正常系（到達記録一覧を取得できる）。
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a001', true);
  select count(*) into v_count from public.admin_list_final_result_presence('f0810000-0000-0000-0000-00000000b001');
  if v_count < 2 then
    raise exception 'FAIL: 運営者が到達記録一覧を取得できない(count=%)', v_count;
  end if;
end $$;
reset role;
do $$ begin raise notice 'PASS: 運営者はadmin_list_final_result_presenceで到達記録一覧（利用者名・役割・seen_at・付与状況）を取得できる'; end $$;

-- ============================================================
-- テスト30: ポイント・段位・実績・本番開催番号への影響が無いことの確認
-- （x2はテスト36で称号・限定アイコンの付与を受けたが、称号・アイコンの付与は
-- ポイント・段位・実績に一切影響しない設計であることを確認する。
-- official_live_counterが変化していないことも併せて確認する）。
-- ============================================================
do $$
declare
  v_points int; v_mastery int; v_live_count int;
  v_counter_after bigint;
  v_counter_before bigint;
begin
  select total_points, mastery_meter, live_count into v_points, v_mastery, v_live_count
    from public.profiles where id = 'f0810000-0000-0000-0000-00000000a003';
  if v_points <> 0 or v_mastery <> 0 or v_live_count <> 0 then
    raise exception 'FAIL: 称号・特典まわりの操作でポイント・段位・実績が変化した(points=%, mastery=%, liveCount=%)',
      v_points, v_mastery, v_live_count;
  end if;

  select counter_before into v_counter_before from _t0081_baseline;
  select last_value into v_counter_after from public.official_live_counter;
  if v_counter_before <> v_counter_after then
    raise exception 'FAIL: 称号・特典まわりの操作で本番開催番号カウンターが変化した(before=%, after=%)',
      v_counter_before, v_counter_after;
  end if;
  raise notice 'PASS: 称号・限定特典まわりの一連の操作はポイント・段位・実績・本番開催番号に一切影響しない';
end $$;

-- ============================================================
-- テスト29: アカウント削除後に所有情報が不整合にならない（x1を削除し、
-- user_titles/user_limited_icons/final_result_presenceがcascadeで消えることを
-- 確認する。すべてprofiles(id) on delete cascadeのため、他テーブルとの矛盾は生じない）。
-- ============================================================
delete from auth.users where id = 'f0810000-0000-0000-0000-00000000a002';

do $$
declare
  v_title_count int;
  v_icon_count int;
  v_presence_count int;
  v_profile_count int;
begin
  select count(*) into v_title_count from public.user_titles where user_id = 'f0810000-0000-0000-0000-00000000a002';
  select count(*) into v_icon_count from public.user_limited_icons where user_id = 'f0810000-0000-0000-0000-00000000a002';
  select count(*) into v_presence_count from public.final_result_presence where user_id = 'f0810000-0000-0000-0000-00000000a002';
  select count(*) into v_profile_count from public.profiles where id = 'f0810000-0000-0000-0000-00000000a002';
  if v_title_count <> 0 or v_icon_count <> 0 or v_presence_count <> 0 or v_profile_count <> 0 then
    raise exception 'FAIL: アカウント削除後に所有情報・到達記録・プロフィールが残っている(titles=%, icons=%, presence=%, profiles=%)',
      v_title_count, v_icon_count, v_presence_count, v_profile_count;
  end if;
  raise notice 'PASS: アカウント削除でuser_titles/user_limited_icons/final_result_presenceはcascadeで矛盾なく消える';
end $$;

-- ============================================================
-- テスト43: プライバシーポリシー改定（0081でcurrent_legal_document_versions()を
-- create or replace）により、既に旧バージョンで同意済みの利用者へ再同意ゲートが
-- 出る仕組みを検証する。ConsentRequiredGate（フロント）は
-- 「terms_version=現在値 and privacy_version=現在値」に一致する行がterms_consentsに
-- あるかで判定するため、ここではDB側の実際の挙動（現在バージョンの確認・
-- 旧バージョンの同意記録が新バージョンの判定にヒットしないこと・
-- record_terms_consent_v2が新バージョンで正しく記録し直せること・冪等性）を確認する。
-- x2(a003)は削除されておらず利用可能。
-- 2026-09-28（0083追加対応）：run.shは0001〜全マイグレーションを先に適用してから
-- 全テストファイルを実行するため、この時点でcurrent_legal_document_versions()は
-- 0081ではなく、その時点の最新マイグレーションの最終定義（terms_version・
-- privacy_versionとも更に更新された値）を返す。0081自体（このマイグレーション
-- ファイル）は編集していないが、このテストが検証する「最終的なDBの挙動」は
-- 最新マイグレーション適用後の値を反映する必要があるため、期待値のみをその都度
-- 更新する（各マイグレーション自身の専用テストはsupabase/tests/0083_legal_
-- short_video_consent.test.sql・0088_delete_own_sns_live_result_comment.test.sql
-- を参照）。
-- 2026-10-10（0088追加対応）：ライブ結果コメント自己削除機能に伴う規約改定で
-- current_legal_document_versions()が0088でさらにcreate or replaceされたため、
-- 期待値を0088の最終値へ更新した。
-- 2026-10-14（0090追加対応）：流入アンケートの記載改定・短尺動画の同意条件の文言改定で
-- terms 2026-10-14-v4 / privacy 2026-10-14-v5へ進んだため、期待値を0090の最終値へ更新した。
-- ============================================================
do $$
declare
  v_terms text;
  v_privacy text;
begin
  select terms_version, privacy_version into v_terms, v_privacy
    from public.current_legal_document_versions();
  if v_terms <> '2026-10-14-v4' then
    raise exception 'FAIL: terms_versionが現在の最終値になっていない(got=%)', v_terms;
  end if;
  if v_privacy <> '2026-10-14-v5' then
    raise exception 'FAIL: privacy_versionが現在の最終値になっていない(got=%)', v_privacy;
  end if;
  raise notice 'PASS: current_legal_document_versions()は（最新マイグレーション適用後の最終状態として）利用規約・プライバシーポリシーとも最新の値を返す';
end $$;

-- 0081時点までの現在バージョンで既に同意済みだった状態を模す（本番で実際に起こりうる
-- 既存データ）。
insert into public.terms_consents (user_id, terms_version, privacy_version)
values ('f0810000-0000-0000-0000-00000000a003', '2026-09-25-v1', '2026-09-28-v2');

do $$
declare
  v_count int;
begin
  -- ConsentRequiredGateと同じ条件（現在バージョンに完全一致する行があるか）で確認する。
  select count(*) into v_count from public.terms_consents
    where user_id = 'f0810000-0000-0000-0000-00000000a003'
      and terms_version = '2026-10-14-v4' and privacy_version = '2026-10-14-v5';
  if v_count <> 0 then
    raise exception 'FAIL: 旧バージョンの同意記録が新バージョンの判定に誤ってヒットしている';
  end if;
  raise notice 'PASS: 0081時点までの同意記録は、0083の新しいバージョンの判定にはヒットしない（＝再同意ゲートが表示される状態）';
end $$;

-- 再同意（新しい世代付きRPC。record_terms_consent_v2、0083参照）を行うと、
-- 現在バージョンの行が新たに記録される（旧バージョンの行は履歴として残る＝
-- 上書きしない）。2026-09-28（0083での世代付きRPC導入対応）：退役した引数なし
-- のrecord_terms_consent()はCLIENT_UPDATE_REQUIREDで常に拒否されるため、
-- 新アプリと同じくrecord_terms_consent_v2を呼ぶ。
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a003', true);
  perform public.record_terms_consent_v2('2026-10-14-v4', '2026-10-14-v5');
end $$;
reset role;

do $$
declare
  v_new_count int;
  v_total_count int;
begin
  select count(*) into v_new_count from public.terms_consents
    where user_id = 'f0810000-0000-0000-0000-00000000a003'
      and terms_version = '2026-10-14-v4' and privacy_version = '2026-10-14-v5';
  select count(*) into v_total_count from public.terms_consents
    where user_id = 'f0810000-0000-0000-0000-00000000a003';
  if v_new_count <> 1 then
    raise exception 'FAIL: 再同意後に現在バージョンの同意記録が1件作られていない(got=%)', v_new_count;
  end if;
  if v_total_count <> 2 then
    raise exception 'FAIL: 旧バージョンの同意履歴が消えている、または重複している(total=%)', v_total_count;
  end if;
  raise notice 'PASS: record_terms_consent_v2は新しいバージョンで再同意を記録し、旧バージョンの同意履歴は削除せず残す';
end $$;

-- 冪等性：同じ利用者が同じ現在バージョンで再度record_terms_consent_v2を呼んでも重複しない。
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0810000-0000-0000-0000-00000000a003', true);
  perform public.record_terms_consent_v2('2026-10-14-v4', '2026-10-14-v5');
  perform public.record_terms_consent_v2('2026-10-14-v4', '2026-10-14-v5');
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.terms_consents
    where user_id = 'f0810000-0000-0000-0000-00000000a003'
      and terms_version = '2026-10-14-v4' and privacy_version = '2026-10-14-v5';
  if v_count <> 1 then
    raise exception 'FAIL: 同じ現在バージョンへの再同意の複数回呼び出しで重複行ができている(count=%)', v_count;
  end if;
  raise notice 'PASS: 同じ現在バージョンへの再同意は何度呼んでも1件のまま（冪等）';
end $$;

drop table _t0081_ctx;
drop table _t0081_baseline;

select 'ALL 0081 TITLES AND FIRST LIVE REWARDS TESTS PASSED' as result;
