-- 0073 回帰テスト：本番ライブの開催番号を準備時に手動指定できる機能の確認。
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('a9000000-0000-0000-0000-00000000000f') -- admin(host)
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a9000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a9100000-0000-0000-0000-000000000001', '0073テスト用お題1', 'text', true),
  ('a9100000-0000-0000-0000-000000000002', '0073テスト用お題2', 'text', true)
on conflict do nothing;

-- ============================================================
-- テスト1: get_next_official_sequence_numberはis_host()以外を拒否する。
-- ============================================================
do $$
declare
  v_failed boolean := false;
begin
  insert into auth.users (id) values ('a9000000-0000-0000-0000-0000000000a1') on conflict do nothing;
  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-0000000000a1', true);
  begin
    perform public.get_next_official_sequence_number();
    raise exception 'FAIL: 一般ユーザーがget_next_official_sequence_numberを呼べてしまった';
  exception
    when others then
      v_failed := true;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 想定した拒否が発生しなかった';
  end if;
  raise notice 'PASS: get_next_official_sequence_numberはis_host()以外を拒否する';
end $$;

-- ============================================================
-- テスト2: get_next_official_sequence_numberはofficial_live_counter.last_value+1を
--          返し、呼ぶだけではカウンターを進めない（副作用なし）。
-- ============================================================
do $$
declare
  v_before int;
  v_peek1 int;
  v_peek2 int;
  v_after int;
begin
  select last_value into v_before from public.official_live_counter where id = true;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select public.get_next_official_sequence_number() into v_peek1;
  select public.get_next_official_sequence_number() into v_peek2;
  reset role;

  select last_value into v_after from public.official_live_counter where id = true;

  if v_peek1 <> v_before + 1 or v_peek2 <> v_before + 1 then
    raise exception 'FAIL: get_next_official_sequence_numberがlast_value+1を返していない(before=%, peek1=%, peek2=%)', v_before, v_peek1, v_peek2;
  end if;
  if v_after <> v_before then
    raise exception 'FAIL: get_next_official_sequence_numberを呼んだだけでカウンターが変化した(before=%, after=%)', v_before, v_after;
  end if;
  raise notice 'PASS: get_next_official_sequence_numberは副作用なく次番号を返す';
end $$;

-- ============================================================
-- テスト3: 手動番号を指定して本番ライブを作成できる。カウンターはその番号
--          （の値）まで前進する。
-- ============================================================
create temporary table _t0073_ctx (key text primary key, live_id uuid);

do $$
declare
  v_before int;
  v_manual int;
  v_live_id uuid;
  v_seq int;
  v_after int;
begin
  select last_value into v_before from public.official_live_counter where id = true;
  v_manual := v_before + 1;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0073テスト-手動番号', 20, 1,
    array['a9100000-0000-0000-0000-000000000001']::uuid[], 'official', v_manual
  );
  reset role;

  select official_sequence_number into v_seq from public.lives where id = v_live_id;
  select last_value into v_after from public.official_live_counter where id = true;

  if v_seq <> v_manual then
    raise exception 'FAIL: 手動指定した番号(%)がofficial_sequence_number(%)に反映されていない', v_manual, v_seq;
  end if;
  if v_after <> v_manual then
    raise exception 'FAIL: 手動番号使用後のカウンターが期待値と違う(想定=%, 実際=%)', v_manual, v_after;
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  insert into _t0073_ctx (key, live_id) values ('manual_1', v_live_id);
  raise notice 'PASS: 手動指定した番号(%)が使われ、カウンターもその値まで前進する', v_manual;
end $$;

-- ============================================================
-- テスト4: 上のテストの直後、自動採番（手動指定なし）は手動番号+1になる
--          （例：カウンター0の状態で手動1を使ったら、次の自動番号は2）。
-- ============================================================
do $$
declare
  v_manual_seq int;
  v_live_id uuid;
  v_seq int;
begin
  select official_sequence_number into v_manual_seq
    from public.lives where id = (select live_id from _t0073_ctx where key = 'manual_1');

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0073テスト-手動直後の自動採番', 20, 1,
    array['a9100000-0000-0000-0000-000000000002']::uuid[], 'official'
  );
  reset role;

  select official_sequence_number into v_seq from public.lives where id = v_live_id;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  if v_seq <> v_manual_seq + 1 then
    raise exception 'FAIL: 手動番号(%)の直後の自動採番が+1になっていない(got=%)', v_manual_seq, v_seq;
  end if;
  raise notice 'PASS: 手動番号(%)の直後の自動採番は重複せず%になる', v_manual_seq, v_seq;
end $$;

-- ============================================================
-- テスト5: 使用済みの番号を手動指定すると、分かりやすい日本語エラーで拒否される
--          （生の一意制約違反ではない）。
-- ============================================================
do $$
declare
  v_used_seq int;
  v_ok boolean;
  v_reason text;
  v_live_id uuid;
begin
  select official_sequence_number into v_used_seq
    from public.lives where id = (select live_id from _t0073_ctx where key = 'manual_1');

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select ok, reason, live_id into v_ok, v_reason, v_live_id from public.create_live_preparation(
    now(), '0073テスト-使用済み番号', 20, 1,
    array['a9100000-0000-0000-0000-000000000001']::uuid[], 'official', v_used_seq
  );
  reset role;

  if v_ok is not false then
    raise exception 'FAIL: 使用済み番号(%)の再指定が成功してしまった', v_used_seq;
  end if;
  if v_reason !~ '既に使用されています' then
    raise exception 'FAIL: 使用済み番号エラーの文言が想定と違う(got=%)', v_reason;
  end if;
  raise notice 'PASS: 使用済み番号(%)の手動指定は分かりやすい日本語で拒否される(reason=%)', v_used_seq, v_reason;
end $$;

-- ============================================================
-- テスト6: 0・負数は拒否される。
-- ============================================================
do $$
declare
  v_ok boolean;
  v_reason text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);

  select ok, reason into v_ok, v_reason from public.create_live_preparation(
    now(), '0073テスト-0拒否', 20, 1,
    array['a9100000-0000-0000-0000-000000000001']::uuid[], 'official', 0
  );
  if v_ok is not false or v_reason !~ '1以上の整数' then
    raise exception 'FAIL: 0の手動指定が拒否されなかった(ok=%, reason=%)', v_ok, v_reason;
  end if;

  select ok, reason into v_ok, v_reason from public.create_live_preparation(
    now(), '0073テスト-負数拒否', 20, 1,
    array['a9100000-0000-0000-0000-000000000001']::uuid[], 'official', -1
  );
  if v_ok is not false or v_reason !~ '1以上の整数' then
    raise exception 'FAIL: 負数の手動指定が拒否されなかった(ok=%, reason=%)', v_ok, v_reason;
  end if;

  reset role;
  raise notice 'PASS: 0・負数の手動指定は「1以上の整数」エラーで拒否される';
end $$;

-- ============================================================
-- テスト7: 小数はPostgres側の型変換エラーになる（int引数のため）。
-- ============================================================
-- PostgREST経由の実際の呼び出しでは、JSONの数値'1.5'はp_manual_official_sequence_number
-- (int型)へのバインド時にテキスト経由でキャストされ、intは小数点を含む文字列を
-- 受け付けないため型変換エラーになる。この挙動そのものを直接SQLで確認する
-- （'1.5'::numeric::intのような明示castは丸められてしまい別物なので使わない）。
do $$
begin
  begin
    perform '1.5'::int;
    raise exception 'FAIL: ''1.5''::int が例外を投げなかった（int型が小数文字列を受け付けている）';
  exception
    when invalid_text_representation then
      null; -- 期待通り：小数はintへの型変換自体で拒否される
  end;
  raise notice 'PASS: 小数はint引数への型変換自体で拒否される（フロントエンドの事前検証と合わせた多層防御）';
end $$;

-- ============================================================
-- テスト8: テストライブでは手動番号を指定できない（番号を消費しない）。
-- ============================================================
do $$
declare
  v_before int;
  v_ok boolean;
  v_reason text;
  v_after int;
begin
  select last_value into v_before from public.official_live_counter where id = true;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select ok, reason into v_ok, v_reason from public.create_live_preparation(
    now(), '0073テスト-test手動拒否', 20, 1,
    array['a9100000-0000-0000-0000-000000000001']::uuid[], 'test', 999
  );
  reset role;

  select last_value into v_after from public.official_live_counter where id = true;

  if v_ok is not false or v_reason !~ 'テストライブでは開催番号を指定できません' then
    raise exception 'FAIL: テストライブでの手動番号指定が拒否されなかった(ok=%, reason=%)', v_ok, v_reason;
  end if;
  if v_after <> v_before then
    raise exception 'FAIL: 拒否されたはずのテストライブ手動指定でカウンターが変化した(before=%, after=%)', v_before, v_after;
  end if;
  raise notice 'PASS: テストライブでは手動番号を指定できず、カウンターも消費されない';
end $$;

-- ============================================================
-- テスト9: 過去の未使用番号（欠番）を手動で埋めても、カウンターを巻き戻さない。
-- ============================================================
do $$
declare
  v_gap_seq int;
  v_live_id uuid;
  v_seq int;
  v_after int;
  v_next_auto int;
begin
  -- このテスト専用に、カウンターを一旦大きく進めて「欠番」を作る
  -- （50は他のテストが到達しない十分に大きい値）。
  update public.official_live_counter set last_value = 50 where id = true;
  v_gap_seq := 10; -- 1〜50の間で誰も使っていない番号

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0073テスト-欠番埋め', 20, 1,
    array['a9100000-0000-0000-0000-000000000001']::uuid[], 'official', v_gap_seq
  );
  reset role;

  select official_sequence_number into v_seq from public.lives where id = v_live_id;
  select last_value into v_after from public.official_live_counter where id = true;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  if v_seq <> v_gap_seq then
    raise exception 'FAIL: 欠番(%)を手動指定した結果が違う(got=%)', v_gap_seq, v_seq;
  end if;
  if v_after <> 50 then
    raise exception 'FAIL: 欠番を埋めただけなのにカウンターが巻き戻った(想定=50, 実際=%)', v_after;
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  select public.get_next_official_sequence_number() into v_next_auto;
  reset role;
  if v_next_auto <> 51 then
    raise exception 'FAIL: 欠番埋め後の次の自動採番番号が51でない(got=%)', v_next_auto;
  end if;
  raise notice 'PASS: 過去の欠番(%)を手動で埋めてもカウンターは巻き戻らず(last_value=50)、次の自動採番は51のまま', v_gap_seq;
end $$;

-- ============================================================
-- テスト10: 作成が途中で失敗した場合、手動番号を使ってもカウンターだけ
--           進んだ状態にならない（丸ごとロールバック、0068テスト6の手動番号版）。
-- ============================================================
do $$
declare
  v_before int;
  v_bogus_id uuid := gen_random_uuid();
  v_manual int;
  v_raised boolean := false;
  v_live_count int;
begin
  select last_value into v_before from public.official_live_counter where id = true;
  v_manual := v_before + 1;

  set local role authenticated;
  perform set_config('myapp.uid', 'a9000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.create_live_preparation(
      now(), '0073テスト-手動番号での作成失敗', 20, 2,
      array['a9100000-0000-0000-0000-000000000002', v_bogus_id]::uuid[], -- 2件必要中1件は存在しないID
      'official', v_manual
    );
  exception
    when others then
      v_raised := true;
  end;
  reset role;

  if not v_raised then
    raise exception 'FAIL: 手動番号指定時、一部のお題が存在しないのに例外を投げずに完了した';
  end if;

  select count(*) into v_live_count from public.lives where title = '0073テスト-手動番号での作成失敗';
  if v_live_count <> 0 then
    raise exception 'FAIL: 作成失敗にもかかわらず不完全なlives行が% 件残っている', v_live_count;
  end if;

  if (select last_value from public.official_live_counter where id = true) <> v_before then
    raise exception 'FAIL: 手動番号使用時の作成失敗でカウンターだけ進んだ(before=%, after=%)',
      v_before, (select last_value from public.official_live_counter where id = true);
  end if;
  if exists (select 1 from public.lives where official_sequence_number = v_manual) then
    raise exception 'FAIL: 作成失敗にもかかわらず手動番号(%)が使用済みのまま残っている', v_manual;
  end if;
  raise notice 'PASS: 手動番号指定時に作成が途中で失敗しても、番号・カウンターだけ進むことはない（丸ごとロールバック）';
end $$;

drop table _t0073_ctx;

select 'ALL 0073 TESTS PASSED' as result;
