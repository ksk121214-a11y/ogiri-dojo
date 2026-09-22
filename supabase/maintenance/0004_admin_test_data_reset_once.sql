-- ============================================================
-- 【一度限りのメンテナンスSQL】admin通常会員のテストデータ初期化。
-- ============================================================
-- 実行前に必ず 0003_admin_test_data_check_readonly.sql の結果を確認し、
-- 「通常会員（is_guest=false）にrole<>'admin'の一般会員が1件も存在しない」
-- ことをユーザー自身の目で確認してから実行すること。1件でも存在すれば、
-- 下のガードが例外を発生させてロールバックする（＝何も変更されずに終わる）。
--
-- 初期化する項目：
--   - 対象adminのmastery_meter / total_points / points_balance を0にする
--   - 対象adminのpoint_historyを削除する
--   - 対象adminが投稿したsns_topics / sns_answers / sns_comments /
--     sns_live_result_comments を削除する（いいねはON DELETE CASCADEで
--     自動的に削除される）
--   - 上記削除対象を指していたreports（通報。target_idにFKが無く孤立するため
--     明示的に削除する）
--
-- 初期化しない項目（今回の依頼外。値は変更しない）：
--   - auth.users、profiles行そのもの、ログイン設定（x_username等）
--   - 匿名ゲストのプロフィール（is_guest=trueは対象外）
--   - tickets_count / tickets_next_recovery_at（寄合券は投稿削除で返却しない）
--   - live_count / award_count_first / award_count_second / award_count_third /
--     best_answer_count（参加回数・入賞回数・運営ベスト回数）
--   - sns_follows（フォロー関係）
--   - ライブ本体・live答え（answers）データ（#0001補正に必要なもの以外）
--
-- 通常のmigrationsディレクトリには含めない（一度限りの初期化であり、新しい
-- 環境やテストDBに対して再適用すべきものではないため）。
--
-- 本番のSupabaseプロジェクトに対しては、ユーザーが内容を確認し明示的に
-- 実行を指示するまで絶対に実行しないこと。

begin;

do $$
declare
  v_bad_profile_count int;
  v_admin_count int;
  v_topics_deleted int;
  v_answers_deleted int;
  v_comments_deleted int;
  v_live_result_comments_deleted int;
  v_reports_deleted int;
  v_point_history_deleted int;
begin
  -- ガード：通常会員（is_guest=false）にrole<>'admin'（一般会員）が1件も存在しないこと。
  select count(*) into v_bad_profile_count
    from public.profiles where is_guest = false and role <> 'admin';
  if v_bad_profile_count <> 0 then
    raise exception '安全ガード停止：一般会員（role<>adminの通常会員）が%件存在します。想定外のため中止します。', v_bad_profile_count;
  end if;

  select count(*) into v_admin_count from public.profiles where role = 'admin' and is_guest = false;
  if v_admin_count = 0 then
    raise exception '安全ガード停止：対象のadminプロフィールが1件も見つかりません。想定外のため中止します。';
  end if;

  -- 対象admin id・削除対象コンテンツidを一時テーブルへ確定させる
  -- （この後の削除・通報整合の両方から同じ集合を参照するため）。
  create temporary table _admin_ids on commit drop as
    select id from public.profiles where role = 'admin' and is_guest = false;

  create temporary table _target_topic_ids on commit drop as
    select id from public.sns_topics where author_id in (select id from _admin_ids);
  create temporary table _target_answer_ids on commit drop as
    select id from public.sns_answers where author_id in (select id from _admin_ids);
  create temporary table _target_comment_ids on commit drop as
    select id from public.sns_comments where author_id in (select id from _admin_ids);
  create temporary table _target_live_result_comment_ids on commit drop as
    select id from public.sns_live_result_comments where author_id in (select id from _admin_ids);

  -- 通報（reports）を先に削除する（target_idにFKが無く孤立して残るため、
  -- 削除対象コンテンツを指している行を明示的に消す。他人の投稿に対する
  -- 通報や、admin以外が対象の通報には一切触れない）。
  delete from public.reports
    where (target_type = 'sns_topic' and target_id in (select id from _target_topic_ids))
       or (target_type = 'sns_answer' and target_id in (select id from _target_answer_ids))
       or (target_type = 'sns_comment' and target_id in (select id from _target_comment_ids))
       or (target_type = 'live_result_comment' and target_id in (select id from _target_live_result_comment_ids));
  get diagnostics v_reports_deleted = row_count;

  -- 寄合帳の投稿削除。子→親の順で明示的に削除する（sns_answer_likesは
  -- sns_answersへのON DELETE CASCADEで自動的に削除される）。
  delete from public.sns_live_result_comments where id in (select id from _target_live_result_comment_ids);
  get diagnostics v_live_result_comments_deleted = row_count;

  delete from public.sns_comments where id in (select id from _target_comment_ids);
  get diagnostics v_comments_deleted = row_count;

  delete from public.sns_answers where id in (select id from _target_answer_ids);
  get diagnostics v_answers_deleted = row_count;

  delete from public.sns_topics where id in (select id from _target_topic_ids);
  get diagnostics v_topics_deleted = row_count;

  -- point_historyの削除。
  delete from public.point_history where user_id in (select id from _admin_ids);
  get diagnostics v_point_history_deleted = row_count;

  -- ポイント関連値を0にする（live_count/award_count_*/best_answer_count/
  -- tickets_count/tickets_next_recovery_atは意図的に変更しない）。
  update public.profiles
    set mastery_meter = 0,
        total_points = 0,
        points_balance = 0
    where id in (select id from _admin_ids);

  raise notice '初期化完了：admin%件 / sns_topics削除%件 / sns_answers削除%件 / sns_comments削除%件 / sns_live_result_comments削除%件 / reports削除%件 / point_history削除%件',
    v_admin_count, v_topics_deleted, v_answers_deleted, v_comments_deleted, v_live_result_comments_deleted, v_reports_deleted, v_point_history_deleted;

  -- 事後検証：対象adminのポイント関連値が0、point_historyが0件になっていること。
  if exists (
    select 1 from public.profiles
    where id in (select id from _admin_ids)
      and (mastery_meter <> 0 or total_points <> 0 or points_balance <> 0)
  ) then
    raise exception '事後検証失敗：初期化後もポイント関連値が0になっていないadminがいます。';
  end if;
  if (select count(*) from public.point_history where user_id in (select id from _admin_ids)) <> 0 then
    raise exception '事後検証失敗：初期化後もpoint_historyが残っています。';
  end if;
end $$;

commit;

-- 実行後の確認（読み取り専用）。
select id, display_name, role, mastery_meter, total_points, points_balance,
       live_count, award_count_first, award_count_second, award_count_third, best_answer_count,
       tickets_count, tickets_next_recovery_at
from public.profiles
where role = 'admin' and is_guest = false;
