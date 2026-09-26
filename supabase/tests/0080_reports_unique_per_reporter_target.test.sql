-- 0080 回帰テスト：同じ利用者による同じ対象への通報は1件だけ。
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

insert into auth.users (id, is_anonymous) values
  ('d0000000-0000-0000-0000-00000000000b', false), -- 会員1
  ('d0000000-0000-0000-0000-00000000000c', false), -- 会員2
  ('d0000000-0000-0000-0000-00000000001a', true),  -- ゲスト
  ('d0000000-0000-0000-0000-00000000000d', false)  -- 後で削除される会員
on conflict do nothing;

do $$
declare
  v_t1 uuid := 'd1000000-0000-0000-0000-000000000001';
  v_t2 uuid := 'd1000000-0000-0000-0000-000000000002';
  v_count int;
  v_failed boolean;
  v_state text;
begin
  -- 1) 会員1がt1(sns_topic)を通報できる。同じ組み合わせの2回目はunique_violation(23505)で拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000000b', true);
  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
    values ('d0000000-0000-0000-0000-00000000000b', 'sns_topic', v_t1, 'スパム', '本文');
  v_failed := false;
  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
      values ('d0000000-0000-0000-0000-00000000000b', 'sns_topic', v_t1, '別の理由', '本文');
  exception when unique_violation then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '23505' then reset role; raise exception 'FAIL: SQLSTATEが23505でない(%)', v_state; end if;
    v_failed := true;
  end;
  reset role;
  if not v_failed then raise exception 'FAIL: 同じ利用者が同じ対象を2回通報できてしまった'; end if;
  select count(*) into v_count from public.reports where target_id = v_t1;
  if v_count <> 1 then raise exception 'FAIL: 重複通報が保存された(% 件)', v_count; end if;
  raise notice 'PASS: 同じ利用者・同じ種別・同じ対象への2回目の通報は拒否される（23505）';

  -- 2) 別の利用者は同じ対象を通報できる。
  set local role authenticated;
  perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000000c', true);
  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
    values ('d0000000-0000-0000-0000-00000000000c', 'sns_topic', v_t1, 'スパム', '本文');
  reset role;
  raise notice 'PASS: 別の利用者は同じ対象を通報できる';

  -- 3) 同じ利用者でも別の対象IDなら通報できる。4) 対象種別が違えば通報できる。
  set local role authenticated;
  perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000000b', true);
  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
    values ('d0000000-0000-0000-0000-00000000000b', 'sns_topic', v_t2, 'スパム', '別対象');
  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
    values ('d0000000-0000-0000-0000-00000000000b', 'sns_answer', v_t1, 'スパム', '別種別');
  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
    values ('d0000000-0000-0000-0000-00000000000b', 'live_result_comment', v_t1, 'スパム', 'ライブ結果コメント');
  reset role;
  raise notice 'PASS: 同じ利用者でも対象ID・対象種別が違えば通報できる';

  -- 5) 通報者のアカウント削除でreporter_idがNULLになった記録が複数あっても、制約は壊れない。
  --    削除後も既存の内容（理由・詳細・状態）は残る。
  insert into public.reports (reporter_id, target_type, target_id, reason, detail, snapshot_body, status, admin_memo)
    values ('d0000000-0000-0000-0000-00000000000d', 'sns_topic', v_t2, '理由X', '詳細X', '本文X', 'reviewing', 'メモX');
  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
    values ('d0000000-0000-0000-0000-00000000000d', 'sns_answer', v_t2, '理由Y', '本文Y');
  delete from auth.users where id = 'd0000000-0000-0000-0000-00000000000d';
  select count(*) into v_count from public.reports where reporter_id is null and target_id = v_t2;
  if v_count <> 2 then raise exception 'FAIL: 通報者削除後の記録が残っていない(% 件)', v_count; end if;
  if not exists (select 1 from public.reports where reason = '理由X' and detail = '詳細X' and status = 'reviewing' and admin_memo = 'メモX' and reporter_id is null) then
    raise exception 'FAIL: 通報者削除後に既存の内容が変わった';
  end if;
  -- reporter_idがNULLの行同士は重複扱いにならない（同じ対象への別記録を追加できる）。
  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
    values (null, 'sns_topic', v_t2, '匿名化済みの別記録', '本文Z');
  raise notice 'PASS: reporter_idがNULLの保存済み記録は一意制約の対象外で、内容も保たれる';

  -- 6) 未ログイン・ゲスト・なりすましの拒否は引き続き機能する（拒否理由は重複ではなくRLS）。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000001a', true);
  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
      values ('d0000000-0000-0000-0000-00000000001a', 'sns_topic', 'd1000000-0000-0000-0000-000000000009', 'スパム', 'ゲスト');
  exception when others then
    if sqlerrm like '%row-level security%' then v_failed := true; else reset role; raise exception 'FAIL: 想定外(%)', sqlerrm; end if;
  end;
  reset role;
  if not v_failed then raise exception 'FAIL: ゲストが通報できた'; end if;

  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000000b', true);
  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
      values ('d0000000-0000-0000-0000-00000000000c', 'sns_topic', 'd1000000-0000-0000-0000-000000000009', 'スパム', 'なりすまし');
  exception when others then
    if sqlerrm like '%row-level security%' then v_failed := true; else reset role; raise exception 'FAIL: 想定外(%)', sqlerrm; end if;
  end;
  reset role;
  if not v_failed then raise exception 'FAIL: なりすまし通報ができた'; end if;

  v_failed := false;
  set local role anon;
  perform set_config('myapp.uid', '', true);
  begin
    insert into public.reports (reporter_id, target_type, target_id, reason, snapshot_body)
      values (null, 'sns_topic', 'd1000000-0000-0000-0000-000000000009', 'スパム', '未ログイン');
  exception when others then
    if sqlerrm like '%row-level security%' or sqlerrm like '%permission denied%' then v_failed := true; else reset role; raise exception 'FAIL: 想定外(%)', sqlerrm; end if;
  end;
  reset role;
  if not v_failed then raise exception 'FAIL: 未ログインが通報できた'; end if;
  raise notice 'PASS: ゲスト・なりすまし・未ログインの拒否は引き続き機能する';

  -- 7) 会員は通報一覧を読み取れない。
  set local role authenticated;
  perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000000b', true);
  select count(*) into v_count from public.reports;
  reset role;
  if v_count <> 0 then raise exception 'FAIL: 会員が通報一覧を読める(% 件)', v_count; end if;
  raise notice 'PASS: 会員は通報一覧を読み取れない';
end $$;
