-- 0068適用前の「古い」本番データを再現するフィクスチャ。
-- supabase/tests/run_0068_migration_test.sh から、0001〜0067まで（0068は含まない）を
-- 適用した直後のスキーマに対して流し込む。この時点ではまだ
-- lives.live_mode / lives.official_sequence_number は存在しないため、
-- 「0068適用前から存在していた本番ライブ」を、当時のスキーマのまま
-- （current_phase='closed', results_published=true, rank_rewards_applied=true）
-- 素直に作成する。
--
-- 0068の実際の移行UPDATE（lives.live_mode='test', official_sequence_number=null,
-- results_published=falseへの一括更新）が、このライブに紐づく他のテーブル
-- （answers・sns_live_results・sns_live_result_answers・point_history・profiles）に
-- 一切副作用を及ぼさないことを、この後 supabase/migrations/0068を適用してから
-- supabase/tests/0068_pre_existing_migration.test.sql で検証する。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('b0680000-0000-0000-0000-00000000000f'), -- host(admin)
  ('b0680000-0000-0000-0000-000000000001'), -- player1（1位相当）
  ('b0680000-0000-0000-0000-000000000002')  -- player2（2位相当）
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'b0680000-0000-0000-0000-00000000000f';

-- player1のprofilesに「既にある程度加算済み」の状態を用意する
-- （このライブ自体の付与ぶんを含む、という想定の代表値）。
update public.profiles set
  mastery_meter = 555,
  total_points = 555,
  points_balance = 555,
  live_count = 4,
  award_count_first = 2,
  award_count_second = 1,
  award_count_third = 0,
  best_answer_count = 1
where id = 'b0680000-0000-0000-0000-000000000001';

update public.profiles set
  mastery_meter = 210,
  total_points = 210,
  points_balance = 210,
  live_count = 4,
  award_count_first = 0,
  award_count_second = 2,
  award_count_third = 1,
  best_answer_count = 0
where id = 'b0680000-0000-0000-0000-000000000002';

-- 0068適用前のスキーマそのまま：current_phase='closed'・results_published=true・
-- rank_rewards_applied=true（当時、apply_live_rank_rewardsで既に付与済みという想定）。
-- live_mode/official_sequence_number列はこの時点でまだ存在しない。
insert into public.lives (
  id, scheduled_at, current_phase, title, max_players, planned_group_count,
  created_by, results_published, rank_rewards_applied, ended_at
) values (
  'b0680000-0000-0000-0000-0000000000aa',
  now(), 'closed', '0068移行前テスト用の本番ライブ', 20, 1,
  'b0680000-0000-0000-0000-00000000000f', true, true, now()
);

insert into public.topic_bank (id, body, format, is_active) values
  ('b0680000-0000-0000-0000-0000000000b1', '0068移行前テスト用お題', 'text', true)
on conflict do nothing;

insert into public.topics (id, live_id, body, format, topic_bank_id) values
  ('b0680000-0000-0000-0000-0000000000c1', 'b0680000-0000-0000-0000-0000000000aa',
   '0068移行前テスト用お題', 'text', 'b0680000-0000-0000-0000-0000000000b1');

insert into public.groups (id, live_id, group_order) values
  ('b0680000-0000-0000-0000-0000000000d1', 'b0680000-0000-0000-0000-0000000000aa', 1);

insert into public.participants (id, live_id, user_id, group_id, role) values
  ('b0680000-0000-0000-0000-0000000000e1', 'b0680000-0000-0000-0000-0000000000aa',
   'b0680000-0000-0000-0000-000000000001', 'b0680000-0000-0000-0000-0000000000d1', 'player'),
  ('b0680000-0000-0000-0000-0000000000e2', 'b0680000-0000-0000-0000-0000000000aa',
   'b0680000-0000-0000-0000-000000000002', 'b0680000-0000-0000-0000-0000000000d1', 'player');

insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count) values
  ('b0680000-0000-0000-0000-0000000000f1', 'b0680000-0000-0000-0000-0000000000aa', 1,
   'b0680000-0000-0000-0000-0000000000d1', 'b0680000-0000-0000-0000-0000000000c1', 'done', 1);

insert into public.answers (
  id, turn_id, live_id, participant_id, seq, body, score_total, top_score_votes, judge_count, resolved
) values
  ('b0680000-0000-0000-0000-000000001001', 'b0680000-0000-0000-0000-0000000000f1',
   'b0680000-0000-0000-0000-0000000000aa', 'b0680000-0000-0000-0000-0000000000e1',
   1, '0068移行前テスト用の1位相当回答', 100, 1, 1, true),
  ('b0680000-0000-0000-0000-000000001002', 'b0680000-0000-0000-0000-0000000000f1',
   'b0680000-0000-0000-0000-0000000000aa', 'b0680000-0000-0000-0000-0000000000e2',
   1, '0068移行前テスト用の2位相当回答', 50, 0, 1, true);

insert into public.sns_live_results (id, live_id, manager_comment) values
  ('b0680000-0000-0000-0000-000000002001', 'b0680000-0000-0000-0000-0000000000aa',
   '0068移行前テスト用の運営コメント');

insert into public.sns_live_result_answers (id, live_result_id, answer_id, rank, included, source) values
  ('b0680000-0000-0000-0000-000000003001', 'b0680000-0000-0000-0000-000000002001',
   'b0680000-0000-0000-0000-000000001001', 1, true, 'auto'),
  ('b0680000-0000-0000-0000-000000003002', 'b0680000-0000-0000-0000-000000002001',
   'b0680000-0000-0000-0000-000000001002', 2, true, 'auto');

insert into public.point_history (id, user_id, live_id, points, mastery, label) values
  ('b0680000-0000-0000-0000-000000004001', 'b0680000-0000-0000-0000-000000000001',
   'b0680000-0000-0000-0000-0000000000aa', 210, 210, '第12回ライブ（1位）'),
  ('b0680000-0000-0000-0000-000000004002', 'b0680000-0000-0000-0000-000000000002',
   'b0680000-0000-0000-0000-0000000000aa', 70, 70, '第12回ライブ（2位）');
