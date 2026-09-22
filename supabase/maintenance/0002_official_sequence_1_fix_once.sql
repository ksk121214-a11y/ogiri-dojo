-- ============================================================
-- 【一度限りのメンテナンスSQL】誤って本番扱いにした#0001をテストライブへ戻す。
-- ============================================================
-- 実行前に必ず 0001_official_sequence_1_check_readonly.sql の結果を確認し、
-- 「#0001以外に本番ライブが存在しない」「一般会員（role<>'admin'の通常会員）が
-- 存在しない」ことをユーザー自身の目で確認してから実行すること。
-- 想定外の状態が1件でもあれば、下のガードが例外を発生させてロールバックする
-- （＝何も変更されずに終わる）ため、想定と違えば安全に停止する設計。
--
-- 通常のmigrationsディレクトリには含めない（一度限りの補正であり、新しい
-- 環境やテストDBに対して再適用すべきものではないため）。
--
-- 本番のSupabaseプロジェクトに対しては、ユーザーが内容を確認し明示的に
-- 実行を指示するまで絶対に実行しないこと。

begin;

do $$
declare
  v_official_count int;
  v_target_seq1_count int;
  v_bad_profile_count int;
  v_live_id uuid;
  v_ph_before int;
  v_counter_before int;
begin
  -- ガード1：本番扱い(live_mode='official')のライブが#0001以外に存在しないこと。
  select count(*) into v_official_count from public.lives where live_mode = 'official';
  select count(*) into v_target_seq1_count
    from public.lives where live_mode = 'official' and official_sequence_number = 1;
  if v_official_count <> 1 or v_target_seq1_count <> 1 then
    raise exception '安全ガード停止：本番ライブが想定（official_sequence_number=1の1件だけ）と異なります(official_count=%, seq1_count=%)。0001の確認結果を見直してください。',
      v_official_count, v_target_seq1_count;
  end if;

  -- ガード2：通常会員（is_guest=false）にrole<>'admin'（一般会員）が1件も存在しないこと。
  select count(*) into v_bad_profile_count
    from public.profiles where is_guest = false and role <> 'admin';
  if v_bad_profile_count <> 0 then
    raise exception '安全ガード停止：一般会員（role<>adminの通常会員）が%件存在します。想定外のため中止します。', v_bad_profile_count;
  end if;

  select id into v_live_id from public.lives where official_sequence_number = 1;
  select count(*) into v_ph_before from public.point_history where live_id = v_live_id;
  select last_value into v_counter_before from public.official_live_counter where id = true;
  raise notice '対象ライブID=%、補正前point_history件数=%、補正前counter.last_value=%', v_live_id, v_ph_before, v_counter_before;

  -- 補正1〜3：本番扱いを解除し、テストライブとしての整合性に戻す。
  update public.lives
    set live_mode = 'test',
        official_sequence_number = null,
        results_published = false,
        rank_rewards_applied = false
    where id = v_live_id;

  -- 補正4：テストライブはpoint_historyを持たない、という既存の不変条件
  -- （0068テスト8で検証済み）に合わせる。このライブに紐づく行だけを対象にする
  -- （他のライブ・他ユーザーのpoint_historyには一切触れない）。
  delete from public.point_history where live_id = v_live_id;

  -- 補正5：本番ライブが実際に0件になったことを確認してからカウンターを0に戻す
  -- （確認を挟まずに戻すと、万一他にも本番ライブが残っていた場合に採番が
  -- 巻き戻ってしまうため）。
  if (select count(*) from public.lives where live_mode = 'official') <> 0 then
    raise exception '想定外：補正後も本番ライブが残っています。カウンターは変更せず中止します。';
  end if;
  update public.official_live_counter set last_value = 0 where id = true;

  -- 事後検証：次回の本番ライブが#0001になることを確認する。
  if (select last_value from public.official_live_counter where id = true) <> 0 then
    raise exception '事後検証失敗：official_live_counter.last_valueが0になっていません。';
  end if;
  if (select live_mode from public.lives where id = v_live_id) <> 'test'
    or (select official_sequence_number from public.lives where id = v_live_id) is not null
    or (select results_published from public.lives where id = v_live_id) is not false
    or (select rank_rewards_applied from public.lives where id = v_live_id) is not false
  then
    raise exception '事後検証失敗：対象ライブがテストライブの整合状態になっていません。';
  end if;

  raise notice '補正完了：ライブ%をtestへ戻し、official_live_counter.last_value=0にしました（次回の本番ライブは#0001になります）。', v_live_id;
end $$;

commit;

-- 実行後の確認（読み取り専用）。本番扱いのライブが0件で、カウンターが0に
-- 戻っていることを確認する（次回の本番ライブがofficial_sequence_number=1、
-- つまり#0001になる）。
select count(*) as official_lives_remaining from public.lives where live_mode = 'official';
select last_value as counter_last_value_should_be_0 from public.official_live_counter where id = true;
