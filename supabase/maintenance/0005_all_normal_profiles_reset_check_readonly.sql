-- ============================================================
-- 【読み取り専用】本番前テストデータ初期化・事前確認（全通常プロフィール版）。
-- ============================================================
-- 目的：本番Supabaseの現在のプロフィール構成（2026-09-22ユーザー確認時点）は
--   - is_guest=falseの通常プロフィール：17件（admin1件・ボット14件・友達1件）
--   - is_guest=trueの匿名ゲスト：5件
-- であり、通常プロフィール17件すべてを初期化対象とする前提で
-- 0006_all_normal_profiles_prelaunch_reset_once.sql を実行してよいかを、
-- 実行前にこのSQLの結果で必ず確認する。
--
-- このファイルは一切の変更を行わない（select文のみ）。本番のSupabase
-- プロジェクトに対して実行しても安全。

-- ============================================================
-- 1) アカウント件数（想定：normal=17, admin=1, non_admin=16, guest=5）。
-- ============================================================
select
  (select count(*) from public.profiles where is_guest = false) as normal_profile_count,
  (select count(*) from public.profiles where is_guest = false and role = 'admin') as admin_profile_count,
  (select count(*) from public.profiles where is_guest = false and role <> 'admin') as non_admin_profile_count,
  (select count(*) from public.profiles where is_guest = true) as guest_profile_count;

-- ============================================================
-- 2) 通常プロフィール17件の一覧（初期化対象になる本人確認用）。
-- ============================================================
select
  id, display_name, x_username, role, is_guest,
  mastery_meter, total_points, points_balance,
  live_count, award_count_first, award_count_second, award_count_third, best_answer_count,
  tickets_count, created_at
from public.profiles
where is_guest = false
order by role, created_at;

-- ============================================================
-- 3) 本番ライブの状況。
-- ============================================================
select count(*) as official_live_count from public.lives where live_mode = 'official';

select count(*) as sequence_1_count from public.lives where official_sequence_number = 1;

select
  id, title, scheduled_at, current_phase, live_mode, official_sequence_number,
  results_published, rank_rewards_applied, created_at
from public.lives
where official_sequence_number = 1;

select last_value from public.official_live_counter where id = true;

select count(*) as sequence_1_participants_count
from public.participants where live_id = (select id from public.lives where official_sequence_number = 1);

select count(*) as sequence_1_answers_count
from public.answers where live_id = (select id from public.lives where official_sequence_number = 1);

select count(*) as sequence_1_point_history_count
from public.point_history where live_id = (select id from public.lives where official_sequence_number = 1);

select count(*) as sequence_1_sns_live_results_count
from public.sns_live_results where live_id = (select id from public.lives where official_sequence_number = 1);

-- ============================================================
-- 4) 初期化対象件数（通常プロフィール17件について集計）。
-- ============================================================
with targets as (
  select id from public.profiles where is_guest = false
)
select
  (select count(*) from public.point_history where user_id in (select id from targets)) as point_history_count,
  (select count(*) from public.sns_topics where author_id in (select id from targets)) as sns_topics_count,
  (select count(*) from public.sns_answers where author_id in (select id from targets)) as sns_answers_count,
  (select count(*) from public.sns_comments where author_id in (select id from targets)) as sns_comments_count,
  (select count(*) from public.sns_live_result_comments where author_id in (select id from targets)) as sns_live_result_comments_count,
  (select count(*) from public.reports
     where (target_type = 'sns_topic' and target_id in (select id from public.sns_topics where author_id in (select id from targets)))
        or (target_type = 'sns_answer' and target_id in (select id from public.sns_answers where author_id in (select id from targets)))
        or (target_type = 'sns_comment' and target_id in (select id from public.sns_comments where author_id in (select id from targets)))
        or (target_type = 'live_result_comment' and target_id in (select id from public.sns_live_result_comments where author_id in (select id from targets)))
  ) as related_reports_count,
  (select count(*) from public.sns_answer_likes
     where answer_id in (select id from public.sns_answers where author_id in (select id from targets))
  ) as sns_answer_likes_count;

-- ============================================================
-- 5) 初期化しない項目の現在値（確認用。0006はこれらを一切変更しない）。
-- ============================================================
with targets as (
  select id from public.profiles where is_guest = false
)
select
  (select coalesce(sum(tickets_count), 0) from public.profiles where id in (select id from targets)) as tickets_count_sum,
  (select coalesce(sum(live_count), 0) from public.profiles where id in (select id from targets)) as live_count_sum,
  (select coalesce(sum(award_count_first + award_count_second + award_count_third), 0)
     from public.profiles where id in (select id from targets)) as award_count_sum,
  (select coalesce(sum(best_answer_count), 0) from public.profiles where id in (select id from targets)) as best_answer_count_sum,
  (select count(*) from public.sns_follows
     where follower_id in (select id from targets) or following_id in (select id from targets)
  ) as related_sns_follows_count;
