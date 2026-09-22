-- ============================================================
-- 【読み取り専用】admin通常会員のテストデータ初期化・事前確認。
-- ============================================================
-- 目的：「現在の通常会員は運営アカウント（role='admin'）だけ」という前提を、
-- 実際にDBで確認する。1件でもrole<>'admin'の通常会員が存在した場合、
-- 0004_admin_test_data_reset_once.sqlは安全ガードで必ず停止する。
--
-- このファイルは一切の変更を行わない（select文のみ）。

-- 1) 通常会員（is_guest=false）の内訳。admin以外が1件でもあれば0004は実行できない。
select id, display_name, role, is_guest, created_at
from public.profiles
where is_guest = false
order by role, created_at;

-- 2) 匿名ゲストのプロフィール件数（初期化の対象外、参考情報）。
select count(*) as guest_profile_count from public.profiles where is_guest = true;

-- 3) 対象になるadminプロフィールの現在のポイント関連値。
select id, display_name, mastery_meter, total_points, points_balance,
       live_count, award_count_first, award_count_second, award_count_third, best_answer_count,
       tickets_count, tickets_next_recovery_at
from public.profiles
where role = 'admin' and is_guest = false;

-- 4) 対象adminのpoint_history件数。
select count(*) as point_history_count
from public.point_history
where user_id in (select id from public.profiles where role = 'admin' and is_guest = false);

-- 5) 対象adminが寄合帳へ投稿したお題・回答・ツッコミ・ライブ結果コメントの件数
--    （これらが削除対象）。
select
  (select count(*) from public.sns_topics where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)) as sns_topics_count,
  (select count(*) from public.sns_answers where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)) as sns_answers_count,
  (select count(*) from public.sns_comments where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)) as sns_comments_count,
  (select count(*) from public.sns_live_result_comments where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)) as sns_live_result_comments_count;

-- 6) 上記削除対象に紐づくいいね（ON DELETE CASCADEで自動的に消える想定、参考情報）。
select
  (select count(*) from public.sns_answer_likes where answer_id in (
    select id from public.sns_answers where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)
  )) as sns_answer_likes_count_on_admin_answers;

-- 7) 削除対象コンテンツに対する通報（reports、target_idはFK無しのため孤立しうる。
--    0004はこれらの通報レコードも合わせて削除する）。
select target_type, count(*)
from public.reports
where (target_type = 'sns_topic' and target_id in (select id from public.sns_topics where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)))
   or (target_type = 'sns_answer' and target_id in (select id from public.sns_answers where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)))
   or (target_type = 'sns_comment' and target_id in (select id from public.sns_comments where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)))
   or (target_type = 'live_result_comment' and target_id in (select id from public.sns_live_result_comments where author_id in (select id from public.profiles where role = 'admin' and is_guest = false)))
group by target_type;

-- 8) 今回は初期化しない項目の件数報告のみ（フォロー関係・寄合券・参加回数・
--    入賞回数・運営ベスト回数）。0004はこれらを一切変更しない。
select
  (select count(*) from public.sns_follows where follower_id in (select id from public.profiles where role = 'admin' and is_guest = false)
     or following_id in (select id from public.profiles where role = 'admin' and is_guest = false)) as admin_related_follow_rows,
  (select coalesce(sum(tickets_count), 0) from public.profiles where role = 'admin' and is_guest = false) as admin_tickets_count_sum,
  (select coalesce(sum(live_count), 0) from public.profiles where role = 'admin' and is_guest = false) as admin_live_count_sum,
  (select coalesce(sum(award_count_first + award_count_second + award_count_third), 0) from public.profiles where role = 'admin' and is_guest = false) as admin_award_count_sum,
  (select coalesce(sum(best_answer_count), 0) from public.profiles where role = 'admin' and is_guest = false) as admin_best_answer_count_sum;
