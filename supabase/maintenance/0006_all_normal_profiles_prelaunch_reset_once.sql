-- ============================================================
-- 【一度限りのメンテナンスSQL】本番前テストデータ初期化（全通常プロフィール版）。
-- ============================================================
-- 対象：2026-09-22ユーザー確認時点の本番Supabaseで、is_guest=falseの通常
-- プロフィール17件すべて。内訳は
--   - 運営者本人のアカウント：2件（うちrole='admin'は1件、もう1件は運営者が
--     別の通常会員として使っているアカウントでrole='user'）
--   - ボット：14件
--   - 友達：1件
-- 匿名ゲスト5件は対象外。友達アカウントも今回の初期化対象に含めてよいことを
-- ユーザーに確認済み。
--
-- 実行前に必ず 0005_all_normal_profiles_reset_check_readonly.sql の結果を
-- 確認し、下記ガードが想定どおり通る状態であることを目で見て確認してから
-- 実行すること。
--
-- 旧・0002/0004（admin単独／一般会員0件前提）はこのファイルに統合し、
-- 対象を「is_guest=falseの全プロフィール」へ正しく広げた。0002/0004は
-- 「現在の本番環境では使用禁止」として残置し、削除はしていない。
--
-- 「現在存在する通常プロフィールを無条件で全部消す」設計ではない。
-- 17件・admin1件・一般16件・ゲスト5件という、ユーザーが確認済みの具体的な
-- 件数と一致した場合だけ実行する。本番公開後に新しい通常会員が増えていた
-- 場合は件数が17件からズレるため、下のガードが必ず停止させる。
--
-- 通常のmigrationsディレクトリには含めない（一度限りの初期化であり、新しい
-- 環境やテストDBに対して再適用すべきものではないため）。
--
-- 本番のSupabaseプロジェクトに対しては、ユーザーが内容を確認し明示的に
-- 実行を指示するまで絶対に実行しないこと。
--
-- auth.usersは一切変更しない（このSQL内にauth.usersへのUPDATE/DELETE文は
-- 存在しない）。
--
-- 初期化する項目：
--   - 対象17件のmastery_meter / total_points / points_balance を0にする
--   - 対象17件のpoint_historyを全削除（#0001ぶんも含めて、対象17件の
--     point_historyは元々17件の外に出ないため、この1回の削除で両方満たす）
--   - 対象17件が投稿したsns_topics / sns_answers / sns_comments /
--     sns_live_result_comments を削除する（いいねはON DELETE CASCADEで
--     自動的に削除される）
--   - 上記削除対象を指していたreports（通報。target_idにFKが無く孤立するため
--     明示的に削除する）
--   - 誤って本番扱いにした#0001をテストライブへ戻す（live_mode='test'・
--     official_sequence_number=null・results_published=false・
--     rank_rewards_applied=false）、official_live_counter.last_valueを0へ戻す
--
-- 初期化しない項目（トランザクション内で変化していないことを検証する）：
--   - auth.users、profiles行そのもの（display_name/x_username/avatar_url/
--     avatar_icon/avatar_color/bio/role/is_guest/referral_source/
--     referral_source_answered_atは一切変更しない）
--   - tickets_count / tickets_next_recovery_at（寄合券は投稿削除で返却しない）
--   - live_count / award_count_first / award_count_second / award_count_third /
--     best_answer_count（参加回数・入賞回数・運営ベスト回数）
--   - sns_follows（フォロー関係）
--   - 匿名ゲストのプロフィール5件（is_guest=trueは対象外）
--   - #0001以外のlives・participants・answers・groups・turns・topics・topic_bank
--
-- 同時書き込み対策：トランザクション冒頭でprofiles/lives/official_live_counter/
-- point_history/sns_topics/sns_answers/sns_comments/sns_live_result_comments/
-- sns_answer_likes/sns_follows/reportsをSHAREモードでロックする（読み取りは
-- 妨げず、通常のINSERT/UPDATE/DELETEだけを妨げる）。sns_followsは初期化対象
-- ではないが、事後検証で実行前後のスナップショットを完全一致で比較するため、
-- 実行中のフォロー・解除で比較結果が不安定にならないようロック対象に含める。
-- lock_timeoutを短く設定し、ロックを取得できない場合は待ち続けずエラーで
-- 停止する（begin/commitの外に一切変更が漏れないため、安全にロールバック
-- される）。create_live_preparation()自体が使うのと同じadvisory lockも維持する。

begin;

do $$
declare
  v_normal_count int;
  v_admin_count int;
  v_non_admin_count int;
  v_guest_count int;
  v_target_count int;
  v_target_guest_count int;
  v_all_profiles_count_before int;
  v_official_count int;
  v_official_live_id uuid;
  v_official_live_seq int;
  v_seq1_count int;
  v_counter_row_count int;
  v_counter_before int;
  v_counter_rows_updated int;
  v_counter_after int;
  v_ph_outside_target int;
  v_posts_outside_target int;
  v_ph_before int;
  v_lives_rows_updated int;
  v_profiles_rows_updated int;
  v_topics_deleted int;
  v_answers_deleted int;
  v_comments_deleted int;
  v_live_result_comments_deleted int;
  v_reports_deleted int;
  v_point_history_deleted int;
  v_mismatch int;
begin
  -- ------------------------------------------------------------
  -- 0) ロック：実行中に対象件数・対象外データが変化しないようにする。
  -- ------------------------------------------------------------
  -- ロック待ちで無限に待機しない。取得できなければ即座にエラーとし、
  -- begin/commitの外に一切変更が漏れないため安全にロールバックされる。
  set local lock_timeout = '5s';

  -- create_live_preparation()自体が使うのと同じadvisory lockを取り、
  -- このトランザクションの実行中は新しい本番ライブの作成（およびofficial_
  -- live_counterの更新）と競合しないようにする。
  perform pg_advisory_xact_lock(hashtext('create_live_preparation'));

  -- 以下、今回読み書きするテーブルすべてを固定順序でSHAREロックする。
  -- SHAREモードは通常のINSERT/UPDATE/DELETE（ROW EXCLUSIVE）と競合するが、
  -- 単純なSELECT（ACCESS SHARE）とは競合しないため、他セッションからの
  -- 読み取りは妨げない。このトランザクション自身が後段でUPDATE/DELETEする
  -- ことは、同一トランザクション内で保持している自分自身のロックとは
  -- 競合しないため問題ない。
  lock table public.profiles in share mode;
  lock table public.lives in share mode;
  lock table public.official_live_counter in share mode;
  lock table public.point_history in share mode;
  lock table public.sns_topics in share mode;
  lock table public.sns_answers in share mode;
  lock table public.sns_comments in share mode;
  lock table public.sns_live_result_comments in share mode;
  lock table public.sns_answer_likes in share mode;
  -- sns_followsは初期化対象ではないが、実行前後で完全一致を検証するため
  -- （手順10-d参照）、実行中のフォロー・解除で比較結果が不安定にならないよう
  -- ロック対象に含める。
  lock table public.sns_follows in share mode;
  lock table public.reports in share mode;

  -- ------------------------------------------------------------
  -- 1) 安全ガード：プロフィール構成が想定（通常17/admin1/一般16/ゲスト5）と
  --    完全に一致すること。
  -- ------------------------------------------------------------
  select count(*) into v_normal_count from public.profiles where is_guest = false;
  if v_normal_count is distinct from 17 then
    raise exception '安全ガード停止：通常プロフィール(is_guest=false)が17件ではありません（%件）。想定外のため中止します。', v_normal_count;
  end if;

  select count(*) into v_admin_count from public.profiles where is_guest = false and role = 'admin';
  if v_admin_count is distinct from 1 then
    raise exception '安全ガード停止：admin（role=admin）の通常プロフィールが1件ではありません（%件）。想定外のため中止します。', v_admin_count;
  end if;

  select count(*) into v_non_admin_count from public.profiles where is_guest = false and role <> 'admin';
  if v_non_admin_count is distinct from 16 then
    raise exception '安全ガード停止：一般（role<>admin）の通常プロフィールが16件ではありません（%件）。想定外のため中止します。', v_non_admin_count;
  end if;

  select count(*) into v_guest_count from public.profiles where is_guest = true;
  if v_guest_count is distinct from 5 then
    raise exception '安全ガード停止：匿名ゲスト(is_guest=true)が5件ではありません（%件）。想定外のため中止します。', v_guest_count;
  end if;

  select count(*) into v_all_profiles_count_before from public.profiles;

  -- 対象プロフィールidをこのトランザクション内で確定させる（以後の削除・
  -- 更新・検証はすべてこの集合だけを参照する）。
  create temporary table _t0006_target_profiles on commit drop as
    select id from public.profiles where is_guest = false;

  select count(*) into v_target_count from _t0006_target_profiles;
  if v_target_count is distinct from 17 then
    raise exception '安全ガード停止：対象プロフィール一時テーブルが17件ではありません（%件）。想定外のため中止します。', v_target_count;
  end if;

  select count(*) into v_target_guest_count
    from _t0006_target_profiles t
    join public.profiles p on p.id = t.id
    where p.is_guest = true;
  if v_target_guest_count is distinct from 0 then
    raise exception '安全ガード停止：対象一時テーブルにゲスト（is_guest=true）が%件含まれています。想定外のため中止します。', v_target_guest_count;
  end if;

  -- ------------------------------------------------------------
  -- 2) 対象外データのスナップショット（この後の変更で一切変化しないことを
  --    commit前に検証するため、書き込みを始める前の状態を保存しておく）。
  -- ------------------------------------------------------------
  create temporary table _t0006_all_profile_ids_before on commit drop as
    select id from public.profiles;

  create temporary table _t0006_guest_snapshot on commit drop as
    select id, display_name, x_username, avatar_url, avatar_icon, avatar_color, bio, role, is_guest,
           referral_source, referral_source_answered_at, mastery_meter, total_points, points_balance,
           live_count, award_count_first, award_count_second, award_count_third, best_answer_count,
           tickets_count, tickets_next_recovery_at
    from public.profiles where is_guest = true;

  -- 対象17件について、今回は変更しない列だけをスナップショットする
  -- （mastery_meter/total_points/points_balanceは意図的に含めない＝この3列は
  -- 変化して当然であり、それ以外が変化していないことだけを確認したいため）。
  create temporary table _t0006_target_snapshot on commit drop as
    select id, display_name, x_username, avatar_url, avatar_icon, avatar_color, bio, role, is_guest,
           referral_source, referral_source_answered_at,
           live_count, award_count_first, award_count_second, award_count_third, best_answer_count,
           tickets_count, tickets_next_recovery_at
    from public.profiles where id in (select id from _t0006_target_profiles);

  create temporary table _t0006_sns_follows_snapshot on commit drop as
    select follower_id, following_id, created_at from public.sns_follows;

  -- ------------------------------------------------------------
  -- 3) 安全ガード：本番ライブが#0001の1件だけであること。
  -- ------------------------------------------------------------
  select count(*) into v_official_count from public.lives where live_mode = 'official';
  if v_official_count is distinct from 1 then
    raise exception '安全ガード停止：本番ライブ(live_mode=official)が1件ではありません（%件）。想定外のため中止します。', v_official_count;
  end if;

  select id, official_sequence_number into v_official_live_id, v_official_live_seq
    from public.lives where live_mode = 'official';
  if v_official_live_seq is distinct from 1 then
    raise exception '安全ガード停止：唯一の本番ライブのofficial_sequence_numberが1ではありません（%）。想定外のため中止します。', v_official_live_seq;
  end if;

  select count(*) into v_seq1_count from public.lives where official_sequence_number = 1;
  if v_seq1_count is distinct from 1 then
    raise exception '安全ガード停止：official_sequence_number=1のライブが1件ではありません（%件）。想定外のため中止します。', v_seq1_count;
  end if;

  -- official_live_counterは常にid=trueの1行だけが存在する設計（0068で
  -- singleton制約付きで作成）だが、行そのものが欠けている異常事態も
  -- 明示的に検出する（欠けていればlast_valueがNULLになり、素の"<>"比較では
  -- NULLとの比較がNULL＝ガードを素通りしてしまうため、まず行数を確認し、
  -- 値の比較はすべてIS DISTINCT FROMで行う）。
  select count(*) into v_counter_row_count from public.official_live_counter;
  if v_counter_row_count is distinct from 1 then
    raise exception '安全ガード停止：official_live_counterの行が1件ではありません（%件）。想定外のため中止します。', v_counter_row_count;
  end if;

  select last_value into v_counter_before from public.official_live_counter where id = true;
  if v_counter_before is distinct from 1 then
    raise exception '安全ガード停止：official_live_counter.last_valueが1ではありません（%）。想定外のため中止します。', v_counter_before;
  end if;

  -- ------------------------------------------------------------
  -- 4) 安全ガード：#0001のpoint_history・初期化対象投稿が対象17件の
  --    範囲内に完全に収まっていること（対象外ユーザーを巻き込まない）。
  -- ------------------------------------------------------------
  select count(*) into v_ph_outside_target
    from public.point_history
    where live_id = v_official_live_id
      and user_id not in (select id from _t0006_target_profiles);
  if v_ph_outside_target is distinct from 0 then
    raise exception '安全ガード停止：#0001のpoint_historyに対象17件以外のuser_idが%件含まれています。想定外のため中止します。', v_ph_outside_target;
  end if;

  select
    (select count(*) from public.sns_topics where author_id not in (select id from _t0006_target_profiles))
    + (select count(*) from public.sns_answers where author_id not in (select id from _t0006_target_profiles))
    + (select count(*) from public.sns_comments where author_id not in (select id from _t0006_target_profiles))
    + (select count(*) from public.sns_live_result_comments where author_id not in (select id from _t0006_target_profiles))
    into v_posts_outside_target;
  if v_posts_outside_target is distinct from 0 then
    raise exception '安全ガード停止：初期化対象の投稿系テーブルに対象17件以外のauthor_idが合計%件含まれています。想定外のため中止します。', v_posts_outside_target;
  end if;

  -- ------------------------------------------------------------
  -- 5) #0001の補正：本番扱いを解除し、テストライブとしての整合性に戻す。
  -- ------------------------------------------------------------
  select count(*) into v_ph_before from public.point_history where live_id = v_official_live_id;
  raise notice '対象ライブID=%、補正前point_history件数=%、補正前counter.last_value=%', v_official_live_id, v_ph_before, v_counter_before;

  update public.lives
    set live_mode = 'test',
        official_sequence_number = null,
        results_published = false,
        rank_rewards_applied = false
    where id = v_official_live_id;
  get diagnostics v_lives_rows_updated = row_count;
  if v_lives_rows_updated is distinct from 1 then
    raise exception '事後検証失敗：#0001のlives更新件数が1件ではありません（%件）。', v_lives_rows_updated;
  end if;

  if (select count(*) from public.lives where live_mode = 'official') is distinct from 0 then
    raise exception '想定外：補正後も本番ライブが残っています。カウンターは変更せず中止します。';
  end if;

  update public.official_live_counter set last_value = 0 where id = true;
  get diagnostics v_counter_rows_updated = row_count;
  if v_counter_rows_updated is distinct from 1 then
    raise exception '事後検証失敗：official_live_counterの更新件数が1件ではありません（%件）。', v_counter_rows_updated;
  end if;

  select last_value into v_counter_after from public.official_live_counter where id = true;
  if v_counter_after is distinct from 0 then
    raise exception '事後検証失敗：official_live_counter.last_valueが0になっていません（%）。', v_counter_after;
  end if;

  if (select live_mode from public.lives where id = v_official_live_id) is distinct from 'test'
    or (select official_sequence_number from public.lives where id = v_official_live_id) is not null
    or (select results_published from public.lives where id = v_official_live_id) is distinct from false
    or (select rank_rewards_applied from public.lives where id = v_official_live_id) is distinct from false
  then
    raise exception '事後検証失敗：対象ライブがテストライブの整合状態になっていません。';
  end if;

  -- ------------------------------------------------------------
  -- 6) 対象17件が投稿した寄合帳コンテンツの削除（子→親の順）。
  --    sns_answer_likesはsns_answersへのON DELETE CASCADEで自動削除される。
  -- ------------------------------------------------------------
  create temporary table _t0006_topic_ids on commit drop as
    select id from public.sns_topics where author_id in (select id from _t0006_target_profiles);
  create temporary table _t0006_answer_ids on commit drop as
    select id from public.sns_answers where author_id in (select id from _t0006_target_profiles);
  create temporary table _t0006_comment_ids on commit drop as
    select id from public.sns_comments where author_id in (select id from _t0006_target_profiles);
  create temporary table _t0006_live_result_comment_ids on commit drop as
    select id from public.sns_live_result_comments where author_id in (select id from _t0006_target_profiles);

  -- 通報（reports）を先に削除する（target_idにFKが無く孤立して残るため、
  -- 削除対象コンテンツを指している行を明示的に消す。対象外ユーザーの投稿・
  -- 対象外を対象にした通報には一切触れない）。
  delete from public.reports
    where (target_type = 'sns_topic' and target_id in (select id from _t0006_topic_ids))
       or (target_type = 'sns_answer' and target_id in (select id from _t0006_answer_ids))
       or (target_type = 'sns_comment' and target_id in (select id from _t0006_comment_ids))
       or (target_type = 'live_result_comment' and target_id in (select id from _t0006_live_result_comment_ids));
  get diagnostics v_reports_deleted = row_count;

  delete from public.sns_live_result_comments where id in (select id from _t0006_live_result_comment_ids);
  get diagnostics v_live_result_comments_deleted = row_count;

  delete from public.sns_comments where id in (select id from _t0006_comment_ids);
  get diagnostics v_comments_deleted = row_count;

  delete from public.sns_answers where id in (select id from _t0006_answer_ids);
  get diagnostics v_answers_deleted = row_count;

  delete from public.sns_topics where id in (select id from _t0006_topic_ids);
  get diagnostics v_topics_deleted = row_count;

  -- ------------------------------------------------------------
  -- 7) point_historyの全削除（対象17件ぶん。#0001の分もこの中に含まれる
  --    ため、ガード4で確認済みの前提のもとこれ1回の削除で両方満たす）。
  -- ------------------------------------------------------------
  delete from public.point_history where user_id in (select id from _t0006_target_profiles);
  get diagnostics v_point_history_deleted = row_count;

  -- ------------------------------------------------------------
  -- 8) ポイント関連値を0にする（live_count/award_count_*/best_answer_count/
  --    tickets_count/tickets_next_recovery_at/表示名/X連携情報/ロール/
  --    referral_source系は意図的に変更しない）。
  -- ------------------------------------------------------------
  update public.profiles
    set mastery_meter = 0,
        total_points = 0,
        points_balance = 0
    where id in (select id from _t0006_target_profiles);
  get diagnostics v_profiles_rows_updated = row_count;
  if v_profiles_rows_updated is distinct from 17 then
    raise exception '事後検証失敗：対象プロフィールのポイント更新件数が17件ではありません（%件）。', v_profiles_rows_updated;
  end if;

  raise notice '初期化完了：対象%件 / sns_topics削除%件 / sns_answers削除%件 / sns_comments削除%件 / sns_live_result_comments削除%件 / reports削除%件 / point_history削除%件',
    v_target_count, v_topics_deleted, v_answers_deleted, v_comments_deleted, v_live_result_comments_deleted, v_reports_deleted, v_point_history_deleted;

  -- ------------------------------------------------------------
  -- 9) 事後検証（commit前）。
  -- ------------------------------------------------------------
  if exists (
    select 1 from public.profiles
    where id in (select id from _t0006_target_profiles)
      and (mastery_meter is distinct from 0 or total_points is distinct from 0 or points_balance is distinct from 0)
  ) then
    raise exception '事後検証失敗：初期化後もポイント関連値が0になっていない対象プロフィールがあります。';
  end if;

  if (select count(*) from public.point_history where user_id in (select id from _t0006_target_profiles)) is distinct from 0 then
    raise exception '事後検証失敗：初期化後も対象プロフィールのpoint_historyが残っています。';
  end if;
  if (select count(*) from public.sns_topics where author_id in (select id from _t0006_target_profiles)) is distinct from 0 then
    raise exception '事後検証失敗：初期化後も対象プロフィールのsns_topicsが残っています。';
  end if;
  if (select count(*) from public.sns_answers where author_id in (select id from _t0006_target_profiles)) is distinct from 0 then
    raise exception '事後検証失敗：初期化後も対象プロフィールのsns_answersが残っています。';
  end if;
  if (select count(*) from public.sns_comments where author_id in (select id from _t0006_target_profiles)) is distinct from 0 then
    raise exception '事後検証失敗：初期化後も対象プロフィールのsns_commentsが残っています。';
  end if;
  if (select count(*) from public.sns_live_result_comments where author_id in (select id from _t0006_target_profiles)) is distinct from 0 then
    raise exception '事後検証失敗：初期化後も対象プロフィールのsns_live_result_commentsが残っています。';
  end if;
  if exists (
    select 1 from public.reports
    where (target_type = 'sns_topic' and target_id in (select id from _t0006_topic_ids))
       or (target_type = 'sns_answer' and target_id in (select id from _t0006_answer_ids))
       or (target_type = 'sns_comment' and target_id in (select id from _t0006_comment_ids))
       or (target_type = 'live_result_comment' and target_id in (select id from _t0006_live_result_comment_ids))
  ) then
    raise exception '事後検証失敗：削除済み投稿を指すreportsが残っています。';
  end if;

  if (select count(*) from public.lives where live_mode = 'official') is distinct from 0 then
    raise exception '事後検証失敗：初期化後も本番ライブが残っています。';
  end if;
  if (select count(*) from public.official_live_counter) is distinct from 1 then
    raise exception '事後検証失敗：official_live_counterの行数が1件ではありません。';
  end if;
  if (select last_value from public.official_live_counter where id = true) is distinct from 0 then
    raise exception '事後検証失敗：初期化後もofficial_live_counter.last_valueが0になっていません。';
  end if;

  -- ------------------------------------------------------------
  -- 10) 対象外データが一切変化していないことの検証（スナップショット比較）。
  -- ------------------------------------------------------------
  -- 10-a) profilesの行数とID集合：insert/deleteをprofilesへ一切行っていない
  --       ため一致するはずだが、想定外の混入がないか明示的に確認する。
  if (select count(*) from public.profiles) is distinct from v_all_profiles_count_before then
    raise exception '事後検証失敗：profilesの行数が実行前後で変化しています（前=%, 後=%）。', v_all_profiles_count_before, (select count(*) from public.profiles);
  end if;
  if exists (select id from _t0006_all_profile_ids_before except select id from public.profiles) then
    raise exception '事後検証失敗：実行前に存在したprofiles idが実行後に見つかりません。';
  end if;
  if exists (select id from public.profiles except select id from _t0006_all_profile_ids_before) then
    raise exception '事後検証失敗：実行前に存在しなかったprofiles idが実行後に増えています。';
  end if;

  -- 10-b) ゲスト5件：件数・主要値のいずれも実行前スナップショットと完全一致すること。
  if (select count(*) from public.profiles where is_guest = true) is distinct from 5 then
    raise exception '事後検証失敗：ゲストプロフィールが5件ではなくなっています。';
  end if;
  select count(*) into v_mismatch from (
    select * from _t0006_guest_snapshot
    except
    select id, display_name, x_username, avatar_url, avatar_icon, avatar_color, bio, role, is_guest,
           referral_source, referral_source_answered_at, mastery_meter, total_points, points_balance,
           live_count, award_count_first, award_count_second, award_count_third, best_answer_count,
           tickets_count, tickets_next_recovery_at
    from public.profiles where is_guest = true
  ) diff;
  if v_mismatch is distinct from 0 then
    raise exception '事後検証失敗：ゲストプロフィールの内容が実行前後で変化しています（%件不一致）。', v_mismatch;
  end if;

  -- 10-c) 対象17件の初期化対象外の列（mastery_meter/total_points/
  --       points_balanceを除く）が実行前後で完全一致すること。
  select count(*) into v_mismatch from (
    select * from _t0006_target_snapshot
    except
    select id, display_name, x_username, avatar_url, avatar_icon, avatar_color, bio, role, is_guest,
           referral_source, referral_source_answered_at,
           live_count, award_count_first, award_count_second, award_count_third, best_answer_count,
           tickets_count, tickets_next_recovery_at
    from public.profiles where id in (select id from _t0006_target_profiles)
  ) diff;
  if v_mismatch is distinct from 0 then
    raise exception '事後検証失敗：対象17件の初期化対象外の列が実行前後で変化しています（%件不一致）。', v_mismatch;
  end if;

  -- 10-d) sns_follows：件数・内容とも実行前スナップショットと完全一致すること。
  if (select count(*) from public.sns_follows) is distinct from (select count(*) from _t0006_sns_follows_snapshot) then
    raise exception '事後検証失敗：sns_follows件数が実行前後で変化しています。';
  end if;
  select count(*) into v_mismatch from (
    select * from _t0006_sns_follows_snapshot
    except
    select follower_id, following_id, created_at from public.sns_follows
  ) diff;
  if v_mismatch is distinct from 0 then
    raise exception '事後検証失敗：sns_followsの内容が実行前後で変化しています（%件不一致）。', v_mismatch;
  end if;

  raise notice '事後検証OK：対象%件のポイント・投稿・#0001補正がすべて完了し、対象外データ（ゲスト5件・sns_follows・profiles件数/ID集合・対象17件の初期化対象外列）は一切変化していません。', v_target_count;
end $$;

commit;

-- ============================================================
-- 実行後の確認（読み取り専用）。
-- ============================================================
select
  (select count(*) from public.profiles where is_guest = false) as normal_profile_count_should_be_17,
  (select count(*) from public.profiles where is_guest = true) as guest_profile_count_should_be_5;

select id, display_name, role, mastery_meter, total_points, points_balance,
       live_count, award_count_first, award_count_second, award_count_third, best_answer_count,
       tickets_count, tickets_next_recovery_at
from public.profiles
where is_guest = false
order by role, created_at;

select count(*) as official_lives_remaining_should_be_0 from public.lives where live_mode = 'official';
select last_value as counter_last_value_should_be_0 from public.official_live_counter where id = true;
