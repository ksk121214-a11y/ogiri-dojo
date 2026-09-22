-- ============================================================
-- 【読み取り専用】誤って本番扱いにした#0001の状況確認。
-- ============================================================
-- 目的：本番モードで動作確認を1回行ってしまい、official_sequence_number=1が
-- 消費された状態を、実際に補正する前にまず確認する。
--
-- このファイルは一切の変更を行わない（select文のみ）。本番のSupabase
-- プロジェクトに対して実行しても安全。結果をユーザーが確認し、想定どおりで
-- あることを確認できた場合だけ、0002_official_sequence_1_fix_once.sqlを
-- 実行する（このファイル単体では何も直さない）。

-- 1) official_sequence_number = 1 のライブ本体。
select
  id,
  title,
  scheduled_at,
  current_phase,
  live_mode,
  official_sequence_number,
  results_published,
  rank_rewards_applied,
  created_at
from public.lives
where official_sequence_number = 1;

-- 2) 本番扱い（live_mode='official'）になっているライブの全件一覧。
--    #1以外にも本番ライブが存在しないか（想定外の本番ライブが無いか）を確認する。
select
  id,
  title,
  scheduled_at,
  current_phase,
  official_sequence_number,
  results_published,
  rank_rewards_applied
from public.lives
where live_mode = 'official'
order by official_sequence_number;

-- 3) official_live_counter.last_value（次の自動採番に使われる値）。
select last_value from public.official_live_counter where id = true;

-- 4) official_sequence_number=1のライブに紐づく各種データの件数。
with target as (
  select id from public.lives where official_sequence_number = 1
)
select
  (select count(*) from public.point_history ph, target t where ph.live_id = t.id) as point_history_count,
  (select count(*) from public.sns_live_results r, target t where r.live_id = t.id) as sns_live_results_count,
  (select count(*) from public.participants p, target t where p.live_id = t.id) as participants_count,
  (select count(*) from public.answers a, target t where a.live_id = t.id) as answers_count;

-- 5) 通常会員（is_guest=false）のプロフィールに、role<>'admin'（=一般会員）が
--    1件でも存在しないか。1件でも存在した場合、0002は安全ガードで必ず停止する。
select id, display_name, role, is_guest, created_at
from public.profiles
where is_guest = false and role <> 'admin';

-- 6) 匿名ゲストは通常会員と分けて別途集計する（参考情報。0002の対象外）。
select
  (select count(*) from public.profiles where is_guest = false) as normal_profile_count,
  (select count(*) from public.profiles where is_guest = false and role = 'admin') as admin_profile_count,
  (select count(*) from public.profiles where is_guest = true) as guest_profile_count;
