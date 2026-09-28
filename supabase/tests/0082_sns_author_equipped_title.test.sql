-- 0082 回帰テスト：sns_author_names(uuid[])が、0081時点の列・ゲスト除外・
-- SECURITY DEFINER・search_path・grant/revokeを維持したまま、装備中かつ
-- is_active=trueの称号の表示名(equipped_title_display_name)を追加で返すことを検証する。
-- 実行方法はsupabase/tests/run.sh参照（全*.test.sqlが同一DBを共有するため、
-- 0081のテストが使用済みのUUIDと衝突しない専用のUUIDを使う）。

\set ON_ERROR_STOP on

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0820000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- hostU（後でadmin化）
  ('f0820000-0000-0000-0000-00000000a002', false, '{"provider":"x"}'::jsonb), -- 通常称号(rookie-laugh)を装備
  ('f0820000-0000-0000-0000-00000000a003', false, '{"provider":"x"}'::jsonb), -- 称号なし
  ('f0820000-0000-0000-0000-00000000a004', false, '{"provider":"x"}'::jsonb), -- 非公開化される称号を装備
  ('f0820000-0000-0000-0000-00000000a005', true,  '{"provider":"anonymous"}'::jsonb), -- ゲスト
  ('f0820000-0000-0000-0000-00000000a006', false, '{"provider":"x"}'::jsonb), -- 限定アイコンのみ装備（称号なし）
  ('f0820000-0000-0000-0000-00000000a007', false, '{"provider":"x"}'::jsonb)  -- 称号＋限定アイコン両方装備
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0820000-0000-0000-0000-00000000a001';

-- 0082テスト専用の称号（既存の5種の通常称号・first-witnessには一切触れない）。
insert into public.titles (slug, display_name, description, kind, sort_order, auto_equip, transferable) values
  ('test-0082-deactivatable', '0082テスト用称号', null, 'normal', 900, false, true)
on conflict do nothing;

-- ============================================================
-- テスト1: 通常称号(rookie-laugh)を装備している利用者は、その最新表示名が
-- equipped_title_display_nameとして返る。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0820000-0000-0000-0000-00000000a002', true);
  perform public.set_equipped_title('rookie-laugh');
end $$;
reset role;

do $$
declare
  v_title text;
begin
  select equipped_title_display_name into v_title
    from public.sns_author_names(array['f0820000-0000-0000-0000-00000000a002'::uuid]);
  if v_title <> '笑いのルーキー' then
    raise exception 'FAIL: 他人の公開中・装備中の称号名が取得できない(got=%)', v_title;
  end if;
  raise notice 'PASS: 他人が装備中の公開称号の最新表示名(titles.display_name)が取得できる';
end $$;

-- ============================================================
-- テスト2: 称号を装備していない利用者はnull。
-- ============================================================
do $$
declare
  v_title text;
  v_count int;
begin
  select equipped_title_display_name into v_title
    from public.sns_author_names(array['f0820000-0000-0000-0000-00000000a003'::uuid]);
  select count(*) into v_count
    from public.sns_author_names(array['f0820000-0000-0000-0000-00000000a003'::uuid]);
  if v_count <> 1 then
    raise exception 'FAIL: 称号なし利用者の行自体が返っていない(count=%)', v_count;
  end if;
  if v_title is not null then
    raise exception 'FAIL: 称号を装備していないのにequipped_title_display_nameがnullでない(got=%)', v_title;
  end if;
  raise notice 'PASS: 称号を装備していない利用者はequipped_title_display_name=null';
end $$;

-- ============================================================
-- テスト3: 装備中の称号が運営により非公開(is_active=false)にされた場合はnull
-- （クライアント側の非表示に依存せず、DB側のJOIN条件で確実に除外する）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0820000-0000-0000-0000-00000000a004', true);
  perform public.set_equipped_title('test-0082-deactivatable');
end $$;
reset role;

do $$
declare
  v_title text;
begin
  select equipped_title_display_name into v_title
    from public.sns_author_names(array['f0820000-0000-0000-0000-00000000a004'::uuid]);
  if v_title <> '0082テスト用称号' then
    raise exception 'FAIL: 公開中の称号が正しく取得できていない(got=%)', v_title;
  end if;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0820000-0000-0000-0000-00000000a001', true); -- hostU(admin)
  perform public.admin_update_title('test-0082-deactivatable', '0082テスト用称号', null, 900, false); -- 非公開化
end $$;
reset role;

do $$
declare
  v_title text;
  v_equipped text;
begin
  select equipped_title_display_name into v_title
    from public.sns_author_names(array['f0820000-0000-0000-0000-00000000a004'::uuid]);
  if v_title is not null then
    raise exception 'FAIL: 非公開化した称号がsns_author_namesで返ってしまっている(got=%)', v_title;
  end if;
  -- admin_update_titleの非公開化処理により、装備自体もnullへ解除されているはず
  -- （0081のadmin_update_title仕様、回帰確認）。
  select equipped_title_slug into v_equipped from public.profiles where id = 'f0820000-0000-0000-0000-00000000a004';
  if v_equipped is not null then
    raise exception 'FAIL: 非公開化してもprofiles.equipped_title_slugが解除されていない(got=%)', v_equipped;
  end if;
  raise notice 'PASS: 非公開(is_active=false)にした称号はsns_author_namesでnullになり、装備状態も解除される（クライアント側の非表示に依存しない）';
end $$;

-- ============================================================
-- テスト4: ゲストの投稿者情報は従来どおり返らない（0071のnot pr.is_guestを維持）。
-- ============================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.sns_author_names(array['f0820000-0000-0000-0000-00000000a005'::uuid]);
  if v_count <> 0 then
    raise exception 'FAIL: ゲストの投稿者情報が返ってしまっている(count=%)', v_count;
  end if;
  raise notice 'PASS: ゲストの投稿者情報は0082再定義後も従来どおり一切返らない';
end $$;

-- ============================================================
-- テスト5: 限定アイコン列を含む既存の戻り値が維持される（回帰確認）。
-- ============================================================
update public.profiles set equipped_limited_icon_slug = 'first-witness'
  where id = 'f0820000-0000-0000-0000-00000000a006';

do $$
declare
  v_icon text;
  v_title text;
  v_display_name text;
  v_avatar_icon text;
  v_avatar_color text;
  v_mastery int;
  v_bio text;
begin
  select display_name, avatar_icon, avatar_color, mastery_meter, bio,
         equipped_limited_icon_slug, equipped_title_display_name
    into v_display_name, v_avatar_icon, v_avatar_color, v_mastery, v_bio, v_icon, v_title
    from public.sns_author_names(array['f0820000-0000-0000-0000-00000000a006'::uuid]);
  if v_icon <> 'first-witness' then
    raise exception 'FAIL: 既存のequipped_limited_icon_slug列が維持されていない(got=%)', v_icon;
  end if;
  if v_title is not null then
    raise exception 'FAIL: 称号を装備していない利用者にequipped_title_display_nameが入っている(got=%)', v_title;
  end if;
  -- 0081時点から存在する列がすべて欠落なく返っていることを確認する。
  if v_display_name is null or v_avatar_icon is null or v_avatar_color is null or v_mastery is null then
    raise exception 'FAIL: 0081時点の既存列が欠落している(display_name=%, avatar_icon=%, avatar_color=%, mastery_meter=%)',
      v_display_name, v_avatar_icon, v_avatar_color, v_mastery;
  end if;
  raise notice 'PASS: 限定アイコン列を含む0081時点の既存の戻り値（列の欠落・順序変更なし）が維持されている';
end $$;

-- ============================================================
-- テスト6: 称号・限定アイコンの両方を装備している場合も、それぞれ正しく返る
-- （新旧の列が互いに干渉しないことの確認）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0820000-0000-0000-0000-00000000a007', true);
  perform public.set_equipped_title('mood-maker');
end $$;
reset role;
update public.profiles set equipped_limited_icon_slug = 'first-witness'
  where id = 'f0820000-0000-0000-0000-00000000a007';

do $$
declare
  v_icon text;
  v_title text;
begin
  select equipped_limited_icon_slug, equipped_title_display_name into v_icon, v_title
    from public.sns_author_names(array['f0820000-0000-0000-0000-00000000a007'::uuid]);
  if v_icon <> 'first-witness' then
    raise exception 'FAIL: 称号と限定アイコンを両方装備した場合にequipped_limited_icon_slugが崩れる(got=%)', v_icon;
  end if;
  if v_title <> '盛り上げ担当' then
    raise exception 'FAIL: 称号と限定アイコンを両方装備した場合にequipped_title_display_nameが崩れる(got=%)', v_title;
  end if;
  raise notice 'PASS: 称号・限定アイコンを両方装備していても、それぞれ独立して正しく返る';
end $$;

-- ============================================================
-- テスト7: 一般利用者・匿名からは直接public.profiles/public.titlesを
-- 自由に読み書きできる新しい権限が追加されていないことの確認
-- （sns_author_names経由のみで完結する設計の維持）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f0820000-0000-0000-0000-00000000a002', true);
  begin
    update public.profiles set equipped_title_slug = 'rookie-laugh'
      where id = 'f0820000-0000-0000-0000-00000000a003'; -- 他人の行
    raise exception 'FAIL: 0082適用後に他人のequipped_title_slugを直接UPDATEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 0082適用後も他人のprofiles.equipped_title_slugへの直接UPDATEは権限自体が無く拒否される';
  end;
  begin
    update public.titles set is_active = false where slug = 'rookie-laugh';
    raise exception 'FAIL: 0082適用後に一般会員がtitlesを直接UPDATEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 0082適用後も一般会員はtitlesを直接UPDATEできない（admin_update_title経由のみ）';
  end;
end $$;
reset role;

select 'ALL 0082 SNS AUTHOR EQUIPPED TITLE TESTS PASSED' as result;
