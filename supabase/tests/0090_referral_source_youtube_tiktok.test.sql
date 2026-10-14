-- 0090 回帰テスト：流入アンケートの選択肢変更（X・YouTube・TikTok・友人・その他）。
-- - youtube/tiktokを新規回答として保存できる
-- - app（アプリ内）は新規回答として保存されない（参加自体は失敗させない）
-- - 過去のapp回答は削除・変換されず、回答済み扱い・引き継ぎ・集計が維持される
-- - 回答済み状態はリセットされず、初回回答は上書きされない（二重回答防止）
-- 実行方法は supabase/tests/run.sh 参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id, is_anonymous) values
  ('a9900000-0000-0000-0000-00000000000f', false), -- admin(host)
  ('a9900000-0000-0000-0000-000000000001', false), -- 過去にappと回答済みの会員
  ('a9900000-0000-0000-0000-000000000002', false), -- 未回答の既存会員（過去に「選択しない」で参加済み）→youtube
  ('a9900000-0000-0000-0000-000000000003', false), -- 新規会員→tiktok
  ('a9900000-0000-0000-0000-000000000004', false), -- 未回答会員：旧クライアントからappを送る
  ('a9900000-0000-0000-0000-000000000005', false), -- 未回答会員：other
  ('a9900000-0000-0000-0000-000000000006', false)  -- 未回答会員：「選択しない」(null)（テスト4の比較対象）
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a9900000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a9910000-0000-0000-0000-000000000001', '0090テスト用お題1', 'text', true),
  ('a9910000-0000-0000-0000-000000000002', '0090テスト用お題2（2周目）', 'text', true)
on conflict do nothing;

create or replace function _t0090_make_opening_live(p_title text) returns uuid
language plpgsql as $f$
declare
  v_live_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), p_title, 20, 1,
    array['a9910000-0000-0000-0000-000000000001', 'a9910000-0000-0000-0000-000000000002']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;
  return v_live_id;
end;
$f$;

create or replace function _t0090_join(p_user uuid, p_title text, p_referral text) returns public.participants
language plpgsql as $f$
declare
  v_live_id uuid;
  v_row public.participants;
begin
  v_live_id := _t0090_make_opening_live(p_title);
  set local role authenticated;
  perform set_config('myapp.uid', p_user::text, true);
  v_row := public.join_live(v_live_id, 'audience', p_referral);
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live_id;
  return v_row;
end;
$f$;

-- 過去の回答データ（0090適用前にappで回答済みだった状態）を再現する。
update public.profiles
  set referral_source = 'app', referral_source_answered_at = '2026-09-30 12:00:00+09'
  where id = 'a9900000-0000-0000-0000-000000000001';

-- 集計の基準値（他テストの残留データに依存しないよう差分で検証する）。
create temporary table _t0090_before (
  x_count int, youtube_count int, tiktok_count int, friend_count int,
  other_count int, app_count int, answered_total int
);
do $$
declare
  v_row record;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9900000-0000-0000-0000-00000000000f', true);
  select * into v_row from public.admin_referral_survey_summary();
  reset role;
  insert into _t0090_before values (
    v_row.x_count, v_row.youtube_count, v_row.tiktok_count, v_row.friend_count,
    v_row.other_count, v_row.app_count, v_row.answered_total
  );
end $$;

-- ============================================================
-- テスト1: 過去のapp回答者は回答済みのまま（リセットされない）。次のライブへ
--          null・youtubeのどちらで参加しても、profilesはapp・回答日時も不変で、
--          participantsにはappが引き継がれる（CHECK制約で参加が失敗しない）。
-- ============================================================
do $$
declare
  v_p1 public.participants;
  v_p2 public.participants;
  v_p3 public.participants;
  v_src text;
  v_at timestamptz;
begin
  v_p1 := _t0090_join('a9900000-0000-0000-0000-000000000001', '0090テスト-app回答者null', null);
  v_p2 := _t0090_join('a9900000-0000-0000-0000-000000000001', '0090テスト-app回答者youtube', 'youtube');
  -- 旧クライアントからappが送られても、保存済みのapp回答（値・回答日時）に影響しない。
  v_p3 := _t0090_join('a9900000-0000-0000-0000-000000000001', '0090テスト-app回答者app再送', 'app');

  select referral_source, referral_source_answered_at into v_src, v_at
    from public.profiles where id = 'a9900000-0000-0000-0000-000000000001';
  if v_src is distinct from 'app' or v_at is distinct from '2026-09-30 12:00:00+09'::timestamptz then
    raise exception 'FAIL: 過去のapp回答が変更された(referral_source=%, answered_at=%)', v_src, v_at;
  end if;
  if v_p1.referral_source is distinct from 'app' or v_p2.referral_source is distinct from 'app'
     or v_p3.referral_source is distinct from 'app' then
    raise exception 'FAIL: 過去のapp回答がparticipantsへ引き継がれていない(1=%, 2=%, 3=%)',
      v_p1.referral_source, v_p2.referral_source, v_p3.referral_source;
  end if;
  raise notice 'PASS: 過去のapp回答者は回答済みのまま（値・回答日時とも不変）で、参加時にappが引き継がれ、別の値でも上書きされない';
end $$;

-- ============================================================
-- テスト2: 未回答の既存会員（過去に「選択しない」で参加済み）はyoutubeを保存できる。
-- ============================================================
do $$
declare
  v_p public.participants;
  v_src text;
  v_at timestamptz;
begin
  perform _t0090_join('a9900000-0000-0000-0000-000000000002', '0090テスト-既存未回答null', null);
  select referral_source into v_src from public.profiles where id = 'a9900000-0000-0000-0000-000000000002';
  if v_src is not null then
    raise exception 'FAIL: 「選択しない」で参加したのに回答済みになった(got=%)', v_src;
  end if;

  v_p := _t0090_join('a9900000-0000-0000-0000-000000000002', '0090テスト-既存未回答youtube', 'youtube');
  select referral_source, referral_source_answered_at into v_src, v_at
    from public.profiles where id = 'a9900000-0000-0000-0000-000000000002';
  if v_src is distinct from 'youtube' or v_at is null or v_p.referral_source is distinct from 'youtube' then
    raise exception 'FAIL: youtubeが保存されていない(profiles=%, answered_at=%, participants=%)', v_src, v_at, v_p.referral_source;
  end if;
  raise notice 'PASS: 未回答の既存会員がyoutubeを回答すると、profiles・participantsの両方に保存される';
end $$;

-- ============================================================
-- テスト3: 新規会員はtiktokを保存でき、以後の別回答（youtube）で上書きされない。
-- ============================================================
do $$
declare
  v_p public.participants;
  v_src text;
begin
  v_p := _t0090_join('a9900000-0000-0000-0000-000000000003', '0090テスト-新規tiktok', 'tiktok');
  select referral_source into v_src from public.profiles where id = 'a9900000-0000-0000-0000-000000000003';
  if v_src is distinct from 'tiktok' or v_p.referral_source is distinct from 'tiktok' then
    raise exception 'FAIL: tiktokが保存されていない(profiles=%, participants=%)', v_src, v_p.referral_source;
  end if;

  v_p := _t0090_join('a9900000-0000-0000-0000-000000000003', '0090テスト-新規二重回答', 'youtube');
  select referral_source into v_src from public.profiles where id = 'a9900000-0000-0000-0000-000000000003';
  if v_src is distinct from 'tiktok' or v_p.referral_source is distinct from 'tiktok' then
    raise exception 'FAIL: 二回目の回答で上書きされた(profiles=%, participants=%)', v_src, v_p.referral_source;
  end if;
  raise notice 'PASS: 新規会員がtiktokを保存でき、二回目の回答(youtube)では上書きされない（二重回答防止）';
end $$;

-- ============================================================
-- テスト4: 旧クライアントからのapp送信は「選択しない」(null)と同じ扱いになる。
--   - ライブ参加は成功する
--   - appは新規回答として保存されない
--   - 回答済み日時（referral_source_answered_at）の扱いが「選択しない」と同じ（null）
--   - 次回アンケートを再表示するかどうか（両方nullなら表示）が「選択しない」と同じ
--   会員4（app送信）と会員6（null送信）の結果を直接比較する。
-- ============================================================
do $$
declare
  v_app_p public.participants;
  v_null_p public.participants;
  v_app_src text;
  v_app_at timestamptz;
  v_null_src text;
  v_null_at timestamptz;
  v_app_show boolean;
  v_null_show boolean;
  v_src text;
begin
  v_app_p := _t0090_join('a9900000-0000-0000-0000-000000000004', '0090テスト-旧クライアントapp', 'app');
  v_null_p := _t0090_join('a9900000-0000-0000-0000-000000000006', '0090テスト-選択しない', null);

  if v_app_p.id is null then
    raise exception 'FAIL: appを送った参加が成功していない';
  end if;

  select referral_source, referral_source_answered_at into v_app_src, v_app_at
    from public.profiles where id = 'a9900000-0000-0000-0000-000000000004';
  select referral_source, referral_source_answered_at into v_null_src, v_null_at
    from public.profiles where id = 'a9900000-0000-0000-0000-000000000006';

  if v_app_src is not null or v_app_p.referral_source is not null then
    raise exception 'FAIL: appが新規回答として保存された(profiles=%, participants=%)', v_app_src, v_app_p.referral_source;
  end if;
  if (v_app_at is null) is distinct from (v_null_at is null) or v_app_at is not null then
    raise exception 'FAIL: 回答日時の扱いが「選択しない」と異なる(app送信=%, 選択しない=%)', v_app_at, v_null_at;
  end if;
  if v_app_p.referral_source is distinct from v_null_p.referral_source then
    raise exception 'FAIL: participants.referral_sourceが「選択しない」と異なる(app送信=%, 選択しない=%)',
      v_app_p.referral_source, v_null_p.referral_source;
  end if;

  -- 画面の表示条件（shouldShowReferralSurvey：両方nullなら表示）と同じ判定。
  v_app_show := v_app_src is null and v_app_at is null;
  v_null_show := v_null_src is null and v_null_at is null;
  if v_app_show is distinct from v_null_show or not v_app_show then
    raise exception 'FAIL: 次回のアンケート再表示判定が「選択しない」と異なる(app送信=%, 選択しない=%)', v_app_show, v_null_show;
  end if;

  -- 次回は新しい選択肢で回答できる。
  perform _t0090_join('a9900000-0000-0000-0000-000000000004', '0090テスト-旧クライアントapp後youtube', 'youtube');
  select referral_source into v_src from public.profiles where id = 'a9900000-0000-0000-0000-000000000004';
  if v_src is distinct from 'youtube' then
    raise exception 'FAIL: appを送った後の次回回答(youtube)が保存されていない(got=%)', v_src;
  end if;
  raise notice 'PASS: 旧クライアントのapp送信は参加成功・保存なし・回答日時null・次回再表示ありで「選択しない」と同じ扱いになり、次回は新しい選択肢で回答できる';
end $$;

-- ============================================================
-- テスト5: otherは従来どおり保存できる。不正値は従来どおり拒否される。
-- ============================================================
do $$
declare
  v_p public.participants;
  v_live_id uuid;
  v_rejected boolean := false;
begin
  v_p := _t0090_join('a9900000-0000-0000-0000-000000000005', '0090テスト-other', 'other');
  if v_p.referral_source is distinct from 'other' then
    raise exception 'FAIL: otherが保存されていない(got=%)', v_p.referral_source;
  end if;

  v_live_id := _t0090_make_opening_live('0090テスト-不正値');
  set local role authenticated;
  perform set_config('myapp.uid', 'a9900000-0000-0000-0000-000000000005', true);
  begin
    perform public.join_live(v_live_id, 'audience', 'instagram');
  exception when others then
    if sqlerrm like '%INVALID_REFERRAL_SOURCE%' then
      v_rejected := true;
    else
      raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
    end if;
  end;
  reset role;
  update public.lives set current_phase = 'closed' where id = v_live_id;
  if not v_rejected then
    raise exception 'FAIL: 不正値(instagram)が拒否されなかった';
  end if;
  raise notice 'PASS: otherは従来どおり保存でき、選択肢外の値はINVALID_REFERRAL_SOURCEで拒否される';
end $$;

-- ============================================================
-- テスト6: CHECK制約：youtube/tiktok/app（履歴）は保存可能、選択肢外は拒否。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_failed boolean := false;
begin
  insert into public.lives (scheduled_at, current_phase) values (now(), 'closed') returning id into v_live_id;
  -- 過去データ相当のapp行を直接作れる（制約が履歴値を拒否しない）。
  insert into public.participants (live_id, user_id, referral_source, is_guest)
    values (v_live_id, 'a9900000-0000-0000-0000-000000000005', 'app', false);
  begin
    update public.profiles set referral_source = 'instagram', referral_source_answered_at = now()
      where id = 'a9900000-0000-0000-0000-00000000000f';
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: profiles.referral_sourceの選択肢外の値がCHECK制約で拒否されなかった';
  end if;
  raise notice 'PASS: CHECK制約はapp（履歴）を許容し、選択肢外の値を拒否する';
end $$;

-- ============================================================
-- テスト7: 全体集計：youtube/tiktok/appがそれぞれ正しく数えられる。
--   増分の内訳（このファイルで作った会員）：
--   youtube +2（会員2・会員4）、tiktok +1（会員3）、other +1（会員5）、合計 +4
--   （会員1の過去のapp回答は基準値の取得前に投入済みのため増分0。代わりに
--   app_countが1以上であること＝履歴が集計から消えていないことを確認する）
-- ============================================================
do $$
declare
  v_before record;
  v_after record;
begin
  select * into v_before from _t0090_before;
  set local role authenticated;
  perform set_config('myapp.uid', 'a9900000-0000-0000-0000-00000000000f', true);
  select * into v_after from public.admin_referral_survey_summary();
  reset role;

  if v_after.youtube_count - v_before.youtube_count <> 2
     or v_after.tiktok_count - v_before.tiktok_count <> 1
     or v_after.other_count - v_before.other_count <> 1
     or v_after.app_count - v_before.app_count <> 0  -- 会員1のappはbefore取得前に投入済み
     or v_after.x_count - v_before.x_count <> 0
     or v_after.friend_count - v_before.friend_count <> 0
     or v_after.answered_total - v_before.answered_total <> 4 then
    raise exception 'FAIL: 集計の増分が想定と異なる(before=%, after=%)', v_before, v_after;
  end if;
  if v_after.app_count < 1 then
    raise exception 'FAIL: 過去のapp回答が集計から消えた(app_count=%)', v_after.app_count;
  end if;
  raise notice 'PASS: 全体集計でyoutube/tiktokが正しく数えられ、過去のapp回答も引き続き集計される';
end $$;

-- ============================================================
-- テスト8: ライブ単位：過去のapp回答者の参加行がparticipantsに残り、運営者が読める。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a9900000-0000-0000-0000-00000000000f', true);
  select count(*) into v_count
    from public.participants p
    join public.lives l on l.id = p.live_id
    where p.user_id = 'a9900000-0000-0000-0000-000000000001'
      and l.title like '0090テスト-app回答者%'
      and p.referral_source = 'app';
  reset role;
  if v_count <> 3 then
    raise exception 'FAIL: 運営者がapp回答者の参加行(app)を確認できない(件数=%)', v_count;
  end if;
  raise notice 'PASS: 運営者はライブ単位の参加者一覧で過去のapp回答を引き続き読める';
end $$;

drop table _t0090_before;
drop function _t0090_join(uuid, text, text);
drop function _t0090_make_opening_live(text);

select 'ALL 0090 TESTS PASSED' as result;
