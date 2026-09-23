-- 0006_all_normal_profiles_prelaunch_reset_once.sql のローカル検証専用シード。
-- 本番の想定構成を再現する：
--   - 通常プロフィール17件（admin1件・非admin16件、うち1件は「運営者の
--     もう1つのアカウント」を模してポイント・実績を持たせている）
--   - 匿名ゲスト5件
--   - 本番ライブ#0001（誤って本番のまま動作確認してしまった状態を再現：
--     rank_rewards_applied=true・results_published=true・point_historyあり）
--   - 対象17件のうち数名が寄合帳へ投稿（お題・回答・ツッコミ・ライブ結果
--     コメント・いいね・通報）
--   - 対象外データとして、対象17件どうしのsns_follows・件数を持つ実績列
--     （live_count/award_count_*/best_answer_count/tickets_count）を用意し、
--     これらが変化しないことを検証できるようにする。
\set ON_ERROR_STOP on

do $$
declare
  i int;
  v_id uuid;
begin
  insert into auth.users (id, is_anonymous) values ('d0000000-0000-0000-0000-00000000000f', false);
  update public.profiles set role = 'admin' where id = 'd0000000-0000-0000-0000-00000000000f';

  for i in 1..16 loop
    v_id := ('d0000000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users (id, is_anonymous) values (v_id, false);
  end loop;

  for i in 1..5 loop
    v_id := ('d0000000-0000-0000-0002-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users (id, is_anonymous) values (v_id, true);
  end loop;
end $$;

insert into public.topic_bank (id, body, format, is_active) values
  ('d0100000-0000-0000-0000-000000000001', '本番前テストお題', 'text', true);

create temporary table _seed_ctx (key text primary key, value uuid);

do $$
declare
  v_live_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '本番動作確認#1', 20, 1,
    array['d0100000-0000-0000-0000-000000000001']::uuid[], 'official'
  );
  reset role;
  insert into _seed_ctx (key, value) values ('live_id', v_live_id);
end $$;

do $$
declare
  v_live_id uuid;
begin
  select value into v_live_id from _seed_ctx where key = 'live_id';
  update public.lives
    set current_phase = 'closed', rank_rewards_applied = true, results_published = true
    where id = v_live_id;

  insert into public.point_history (user_id, live_id, points, mastery, label)
    values ('d0000000-0000-0000-0000-00000000000f', v_live_id, 145, 145, '第1回ライブ（動作確認）');
  update public.profiles
    set mastery_meter = 145, total_points = 145, points_balance = 145
    where id = 'd0000000-0000-0000-0000-00000000000f';

  insert into public.point_history (user_id, live_id, points, mastery, label)
    values ('d0000000-0000-0000-0001-000000000001', v_live_id, 80, 80, '第1回ライブ（動作確認）');
  update public.profiles
    set mastery_meter = 80, total_points = 80, points_balance = 80
    where id = 'd0000000-0000-0000-0001-000000000001';
end $$;

insert into public.sns_topics (id, author_id, body) values
  ('d0200000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000f', '運営お題'),
  ('d0200000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0001-000000000001', 'ボット1お題');
insert into public.sns_answers (id, topic_id, author_id, body) values
  ('d0300000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0001-000000000002', 'ボット2の回答'),
  ('d0300000-0000-0000-0000-000000000002', 'd0200000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000f', '運営の回答');
insert into public.sns_comments (id, answer_id, author_id, body) values
  ('d0400000-0000-0000-0000-000000000001', 'd0300000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0001-000000000003', 'ボット3のツッコミ');
insert into public.sns_answer_likes (answer_id, user_id) values
  ('d0300000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000f'),
  ('d0300000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0001-000000000004');
insert into public.reports (reporter_id, target_type, target_id, target_author_id, reason, snapshot_body) values
  ('d0000000-0000-0000-0001-000000000005', 'sns_answer', 'd0300000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0001-000000000002', 'テスト通報', 'スナップショット');

do $$
declare
  v_live_id uuid;
  v_group_id uuid := 'd0500000-0000-0000-0000-000000000001';
  v_turn_id uuid := 'd0600000-0000-0000-0000-000000000001';
  v_participant_id uuid := 'd0700000-0000-0000-0000-000000000001';
  v_answer_id uuid := 'd0800000-0000-0000-0000-000000000001';
  v_result_id uuid := 'd0900000-0000-0000-0000-000000000001';
  v_result_answer_id uuid := 'd0a00000-0000-0000-0000-000000000001';
begin
  select value into v_live_id from _seed_ctx where key = 'live_id';

  insert into public.groups (id, live_id, group_order) values (v_group_id, v_live_id, 1);
  insert into public.participants (id, live_id, user_id, preferred_role, role, group_id) values
    (v_participant_id, v_live_id, 'd0000000-0000-0000-0000-00000000000f', 'player', 'player', v_group_id);
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count) values
    (v_turn_id, v_live_id, 1, v_group_id,
     (select id from public.topics where live_id = v_live_id limit 1), 'done', 1);
  insert into public.answers (id, turn_id, live_id, participant_id, seq, body, score_total, resolved) values
    (v_answer_id, v_turn_id, v_live_id, v_participant_id, 1, 'テスト回答', 100, true);

  insert into public.sns_live_results (id, live_id) values (v_result_id, v_live_id);
  insert into public.sns_live_result_answers (id, live_result_id, answer_id, rank, included, source) values
    (v_result_answer_id, v_result_id, v_answer_id, 1, true, 'manual');
  insert into public.sns_live_result_comments (id, result_answer_id, author_id, body) values
    ('d0b00000-0000-0000-0000-000000000001', v_result_answer_id, 'd0000000-0000-0000-0001-000000000006', 'ライブ結果への感想');
end $$;

insert into public.sns_follows (follower_id, following_id) values
  ('d0000000-0000-0000-0001-000000000001', 'd0000000-0000-0000-0001-000000000002');

update public.profiles set live_count = 3, award_count_first = 1, best_answer_count = 2
  where id = 'd0000000-0000-0000-0001-000000000001';

drop table _seed_ctx;
select 'SEED_DONE' as status;
