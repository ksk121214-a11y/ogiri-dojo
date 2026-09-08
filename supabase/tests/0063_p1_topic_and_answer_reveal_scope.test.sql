-- P1-8・P1-9 権限回帰テスト（0063対応、再レビュー反映版）。
-- 実行方法はsupabase/tests/run.sh参照。
--
-- レビュー指摘対応：以前の版は「aかbのどちらかが登壇組に入る」という固定ユーザー
-- 前提だったため、ランダム組分けの結果次第でv_pa/v_pbが両方NULLになりテストが
-- ランダムに失敗し得た。この版は、組分け結果をDBから動的に問い合わせて
-- 「実際に登壇組にいるplayer」「実際に非登壇組にいるplayer」をその都度特定する。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('d1000000-0000-0000-0000-00000000000a'),
  ('d1000000-0000-0000-0000-00000000000b'),
  ('d1000000-0000-0000-0000-00000000000c'),
  ('d1000000-0000-0000-0000-00000000000d'),
  ('d1000000-0000-0000-0000-00000000000e'), -- 観客
  ('d1000000-0000-0000-0000-00000000000f'), -- admin
  ('d1000000-0000-0000-0000-0000000000ff')  -- 全く無関係な第三者（このライブに未参加）
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'd1000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('d2000000-0000-0000-0000-000000000001', 'P1-8/9テスト用お題(登壇組)', 'text', true),
  ('d2000000-0000-0000-0000-000000000002', 'P1-8/9テスト用お題(非登壇組・未発表のはず)', 'text', true)
on conflict do nothing;

-- ライブ準備〜開始（adminとして）。
do $$
declare
  v_live_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000f', true);

  select live_id into v_live_id from public.create_live_preparation(
    now(), 'P1-8/9テスト', 20, 2,
    array['d2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002']::uuid[]
  );
  update public.lives set current_phase = 'opening' where id = v_live_id;

  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000c', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000d', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000e', true);
  perform public.join_live(v_live_id, 'audience', null);

  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  perform public.begin_game(v_live_id);
end $$;

-- レビュー指摘対応：固定ユーザー前提をやめ、組分け結果をDBから動的に特定する。
-- 1. active_turnのgroup_idを取得
-- 2. そのgroup_idに実際に所属するplayerを1人特定（回答者役）
-- 3. 非登壇（pending）組に実際に所属するplayerを1人特定（審査員候補・「他人」役）
create temporary table _t0063_ctx as
select
  l.id as live_id,
  active_t.id as active_turn_id,
  pending_t.id as pending_turn_id,
  active_t.topic_id as active_topic_id,
  pending_t.topic_id as pending_topic_id,
  active_p.id as answerer_participant_id,
  active_p.user_id as answerer_user_id,
  pending_p.id as judge_participant_id,
  pending_p.user_id as judge_user_id
from public.lives l
join public.turns active_t on active_t.live_id = l.id and active_t.status = 'active'
join public.turns pending_t on pending_t.live_id = l.id and pending_t.status = 'pending'
join lateral (
  select p.id, p.user_id from public.participants p
  where p.live_id = l.id and p.group_id = active_t.group_id and p.role = 'player'
  limit 1
) active_p on true
join lateral (
  select p.id, p.user_id from public.participants p
  where p.live_id = l.id and p.group_id = pending_t.group_id and p.role = 'player'
  limit 1
) pending_p on true
where l.title = 'P1-8/9テスト';

-- このテンポラリテーブルはテストの文脈整理専用（本番相当のデータではない）。
-- 後続のdoブロックでset local role authenticated/anonのまま参照するため、
-- 明示的にSELECTを許可しておく（一時テーブルは既定で所有者以外アクセス不可）。
grant select on _t0063_ctx to authenticated, anon;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from _t0063_ctx;
  if v_count <> 1 then
    raise exception 'FAIL: テスト前提の組分け結果が特定できなかった（active/pendingの組・参加者が揃っていない）';
  end if;
end $$;

reset role;
-- begin_gameはcurrent_phaseを'topic_reveal'にするだけなので、回答を送信できる
-- ように'answering'まで進めておく（本番はhost側のadvanceIfDueが自動で行う）。
update public.lives
  set current_phase = 'answering', phase_deadline = now() + interval '10 minutes', answering_paused = false
  where id = (select live_id from _t0063_ctx);

-- 登壇組の実際のplayer(answerer)として回答を送信する。
do $$
declare
  v_answerer_user_id uuid;
  v_answerer_participant_id uuid;
  v_active_turn_id uuid;
begin
  select answerer_user_id, answerer_participant_id, active_turn_id
    into v_answerer_user_id, v_answerer_participant_id, v_active_turn_id
    from _t0063_ctx;

  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_user_id::text, true);
  insert into public.answers (turn_id, participant_id, seq, body)
    values (v_active_turn_id, v_answerer_participant_id, 1, '内緒の回答');
end $$;

-- ============================================================
-- テスト1: anonがtopic_bankを取得できない。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role anon;
  select count(*) into v_count from public.topic_bank;
  if v_count <> 0 then
    raise exception 'FAIL: anonがtopic_bankを取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: anonはtopic_bankを取得できない';
end $$;

-- ============================================================
-- テスト2: authenticated一般ユーザーがtopic_bankを取得できない。
-- ============================================================
do $$
declare
  v_count int;
  v_answerer_user_id uuid;
begin
  select answerer_user_id into v_answerer_user_id from _t0063_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_user_id::text, true);
  select count(*) into v_count from public.topic_bank;
  if v_count <> 0 then
    raise exception 'FAIL: 一般ユーザーがtopic_bankを取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 一般ユーザーはtopic_bankを取得できない';
end $$;

-- ============================================================
-- テスト3: 管理者だけがtopic_bankを取得できる。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000f', true);
  select count(*) into v_count from public.topic_bank;
  if v_count < 2 then
    raise exception 'FAIL: 管理者がtopic_bankを取得できない(件数=%)', v_count;
  end if;
  raise notice 'PASS: 管理者はtopic_bankを取得できる(件数=%)', v_count;
end $$;

-- ============================================================
-- テスト4: activeになっただけでcurrent_turn_idではないturnのお題は取得できない
--          （司会側の「turns.status更新→lives更新」の2段階更新の間に生じる
--          race windowを再現する。レビュー指摘aの核心）。
-- ============================================================
do $$
declare
  v_pending_turn_id uuid;
  v_pending_topic_id uuid;
  v_judge_user_id uuid;
  v_found boolean;
begin
  select pending_turn_id, pending_topic_id, judge_user_id
    into v_pending_turn_id, v_pending_topic_id, v_judge_user_id
    from _t0063_ctx;

  -- race window再現：次turnをactiveへ更新するが、lives.current_turn_idはまだ
  -- 更新しない（advanceIfDueの1段階目だけが先に終わった状態）。
  reset role;
  update public.turns set status = 'active' where id = v_pending_turn_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select exists(select 1 from public.topics where id = v_pending_topic_id) into v_found;

  -- 後始末：race window状態を元に戻す。
  reset role;
  update public.turns set status = 'pending' where id = v_pending_turn_id;

  if v_found then
    raise exception 'FAIL: turns.statusがactiveなだけでcurrent_turn_idと一致しない次のお題が読めてしまった';
  end if;
  raise notice 'PASS: activeなだけでcurrent_turn_idと一致しないturnのお題は取得できない';
end $$;

-- ============================================================
-- テスト5: 次のturnだけactiveにした中間状態でも次のお題が漏れない
--          （テスト4と同じrace windowを、非登壇組の一般参加者からも確認する）。
-- ============================================================
do $$
declare
  v_pending_turn_id uuid;
  v_pending_topic_id uuid;
  v_judge_participant_id uuid;
  v_judge_user_id uuid;
  v_found boolean;
begin
  select pending_turn_id, pending_topic_id, judge_participant_id, judge_user_id
    into v_pending_turn_id, v_pending_topic_id, v_judge_participant_id, v_judge_user_id
    from _t0063_ctx;

  reset role;
  update public.turns set status = 'active' where id = v_pending_turn_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select exists(
    select 1 from public.topics tp join public.turns t on t.topic_id = tp.id
    where t.id = v_pending_turn_id
  ) into v_found;

  reset role;
  update public.turns set status = 'pending' where id = v_pending_turn_id;

  if v_found then
    raise exception 'FAIL: 中間状態(次turnだけactive)で次のお題が漏れた';
  end if;
  raise notice 'PASS: 次turnだけactiveにした中間状態でも次のお題は漏れない';
end $$;

-- ============================================================
-- テスト6: 無関係なauthenticatedユーザー（このライブに未参加）がactive/doneの
--          お題を取得できない。
-- ============================================================
do $$
declare
  v_active_topic_id uuid;
  v_found boolean;
begin
  select active_topic_id into v_active_topic_id from _t0063_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-0000000000ff', true);
  select exists(select 1 from public.topics where id = v_active_topic_id) into v_found;
  if v_found then
    raise exception 'FAIL: このライブに無関係な認証済みユーザーがお題を取得できてしまった';
  end if;
  raise notice 'PASS: 無関係な認証済みユーザーはactiveなお題を取得できない';
end $$;

-- ============================================================
-- テスト7: anonが進行中・未公開結果のお題を取得できない。
-- ============================================================
do $$
declare
  v_active_topic_id uuid;
  v_found boolean;
begin
  select active_topic_id into v_active_topic_id from _t0063_ctx;
  set local role anon;
  select exists(select 1 from public.topics where id = v_active_topic_id) into v_found;
  if v_found then
    raise exception 'FAIL: anonが進行中のお題を取得できてしまった';
  end if;
  raise notice 'PASS: anonは進行中のお題を取得できない';
end $$;

-- ============================================================
-- テスト8: 同じライブの非退場参加者は現在のお題を取得できる。
-- ============================================================
do $$
declare
  v_judge_user_id uuid;
  v_body text;
begin
  select judge_user_id into v_judge_user_id from _t0063_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select body into v_body from public.topics where id = (select active_topic_id from _t0063_ctx);
  if v_body is null then
    raise exception 'FAIL: 同じライブの非退場参加者が現在のお題を取得できない';
  end if;
  raise notice 'PASS: 同じライブの非退場参加者は現在のお題を取得できる';
end $$;

-- ============================================================
-- テスト9: 回答者本人は自分の未発表回答を取得できる。
-- ============================================================
do $$
declare
  v_answerer_user_id uuid;
  v_active_turn_id uuid;
  v_count int;
begin
  select answerer_user_id, active_turn_id into v_answerer_user_id, v_active_turn_id from _t0063_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_user_id::text, true);
  select count(*) into v_count from public.answers where turn_id = v_active_turn_id;
  if v_count <> 1 then
    raise exception 'FAIL: 回答者本人が自分の回答を取得できない(件数=%)', v_count;
  end if;
  raise notice 'PASS: 回答者本人は自分の(未発表の)回答を取得できる';
end $$;

-- ============================================================
-- テスト10: 他人は未発表回答本文を取得できない。
-- ============================================================
do $$
declare
  v_judge_user_id uuid;
  v_active_turn_id uuid;
  v_count int;
begin
  select judge_user_id, active_turn_id into v_judge_user_id, v_active_turn_id from _t0063_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select count(*) into v_count from public.answers where turn_id = v_active_turn_id;
  if v_count <> 0 then
    raise exception 'FAIL: 他人が未発表回答を取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 他人は未発表回答本文を取得できない';
end $$;

-- ============================================================
-- テスト11: 観客が未発表回答を取得できない。
-- ============================================================
do $$
declare
  v_active_turn_id uuid;
  v_count int;
begin
  select active_turn_id into v_active_turn_id from _t0063_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000e', true);
  select count(*) into v_count from public.answers where turn_id = v_active_turn_id;
  if v_count <> 0 then
    raise exception 'FAIL: 観客が未発表回答を取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 観客は未発表回答を取得できない';
end $$;

-- ============================================================
-- テスト12: 観客・審査員にもpending participant_idとbusy状態だけは届く。
--           pending情報から回答本文を取得・推測できないことも合わせて確認する。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_answerer_participant_id uuid;
  v_judge_user_id uuid;
  v_row record;
begin
  select live_id, answerer_participant_id, judge_user_id
    into v_live_id, v_answerer_participant_id, v_judge_user_id
    from _t0063_ctx;

  -- 観客役。
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000e', true);
  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row is null then
    raise exception 'FAIL: 観客がanswering_cuesを取得できない';
  end if;
  if v_row.pending_participant_id is distinct from v_answerer_participant_id then
    raise exception 'FAIL: 観客に届いたpending_participant_idが想定と異なる';
  end if;
  if v_row.busy is not true then
    raise exception 'FAIL: 観客に届いたbusyがtrueであるべきなのに違う';
  end if;

  -- 審査員候補役（非登壇組）。answering_cuesの列にbody相当の列が無いこと自体が
  -- 「回答本文を取得・推測できない」ことの構造的な裏付けだが、念のためカラム名にも
  -- 本文に関係するものが含まれていないことを確認する。
  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row is null then
    raise exception 'FAIL: 審査員候補がanswering_cuesを取得できない';
  end if;

  raise notice 'PASS: 観客・審査員候補にもpending_participant_id/busyだけが届き、回答本文に相当する情報は含まれない';
end $$;

-- ============================================================
-- テスト13: 審査開始後（revealed_atが立った後）、審査員が現在の回答を取得でき、
--           pending状態が正しく解除される。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_active_turn_id uuid;
  v_judge_user_id uuid;
  v_answer_id uuid;
  v_count int;
  v_pending uuid;
begin
  select live_id, active_turn_id, judge_user_id into v_live_id, v_active_turn_id, v_judge_user_id from _t0063_ctx;
  select id into v_answer_id from public.answers where turn_id = v_active_turn_id;

  reset role;
  update public.answers set revealed_at = now(), judging_ends_at = now() + interval '5 minutes'
    where id = v_answer_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select count(*) into v_count from public.answers where id = v_answer_id;
  if v_count <> 1 then
    raise exception 'FAIL: 発表後に審査員が回答を取得できない';
  end if;

  select pending_participant_id into v_pending from public.answering_cues where live_id = v_live_id;
  if v_pending is not null then
    raise exception 'FAIL: 発表後もpending_participant_idが解除されていない';
  end if;

  raise notice 'PASS: 発表後は審査員も回答を取得でき、pending状態も正しく解除される';
end $$;

-- ============================================================
-- テスト14: 退場者はお題・回答・pending情報を取得できない。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_judge_user_id uuid;
  v_active_turn_id uuid;
  v_active_topic_id uuid;
  v_found_topic boolean;
  v_answers_count int;
  v_cues_count int;
begin
  select live_id, judge_user_id, active_turn_id, active_topic_id
    into v_live_id, v_judge_user_id, v_active_turn_id, v_active_topic_id
    from _t0063_ctx;

  reset role;
  update public.participants set kicked_at = now()
    where live_id = v_live_id and user_id = v_judge_user_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);

  select exists(select 1 from public.topics where id = v_active_topic_id) into v_found_topic;
  select count(*) into v_answers_count from public.answers where turn_id = v_active_turn_id;
  select count(*) into v_cues_count from public.answering_cues where live_id = v_live_id;

  if v_found_topic then
    raise exception 'FAIL: 退場者がお題を取得できてしまった';
  end if;
  if v_answers_count <> 0 then
    raise exception 'FAIL: 退場者が発表済み回答を取得できてしまった(件数=%)', v_answers_count;
  end if;
  if v_cues_count <> 0 then
    raise exception 'FAIL: 退場者がpending情報(answering_cues)を取得できてしまった';
  end if;

  reset role;
  update public.participants set kicked_at = null
    where live_id = v_live_id and user_id = v_judge_user_id;

  raise notice 'PASS: 退場者はお題・回答・pending情報のいずれも取得できない';
end $$;

-- ============================================================
-- テスト15: 結果発表後の回答取得が壊れていない。公開済みライブ結果は退場者や
--           無関係な第三者でも通常どおり閲覧できる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_answer_id uuid;
  v_judge_user_id uuid;
  v_result_id uuid;
  v_count int;
begin
  select live_id, judge_user_id into v_live_id, v_judge_user_id from _t0063_ctx;
  select id into v_answer_id from public.answers where turn_id = (select active_turn_id from _t0063_ctx);

  reset role;
  update public.answers set resolved = true where id = v_answer_id;
  update public.lives set current_phase = 'closed', results_published = true where id = v_live_id;
  insert into public.sns_live_results (id, live_id) values (gen_random_uuid(), v_live_id) returning id into v_result_id;
  insert into public.sns_live_result_answers (id, live_result_id, answer_id, included)
    values (gen_random_uuid(), v_result_id, v_answer_id, true);

  -- 無関係な第三者。
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-0000000000ff', true);
  select count(*) into v_count from public.answers where id = v_answer_id;
  if v_count <> 1 then
    raise exception 'FAIL: 結果公開後、無関係な第三者が公開済み回答を取得できない';
  end if;

  -- 退場者（このテストの直前で解除済みなので、改めて退場させてから確認する）。
  reset role;
  update public.participants set kicked_at = now() where live_id = v_live_id and user_id = v_judge_user_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select count(*) into v_count from public.answers where id = v_answer_id;
  if v_count <> 1 then
    raise exception 'FAIL: 結果公開後、退場者が公開済み回答を取得できない';
  end if;

  reset role;
  update public.participants set kicked_at = null where live_id = v_live_id and user_id = v_judge_user_id;

  raise notice 'PASS: 結果発表後、公開済み回答は退場者・無関係な第三者でも通常どおり取得できる';
end $$;

-- ============================================================
-- テスト16: リロード・再接続相当の再取得でも同じ結果になる（未発表情報が漏れない）。
-- ============================================================
do $$
declare
  v_judge_user_id uuid;
  v_pending_topic_id uuid;
  v_count1 int;
  v_count2 int;
begin
  select judge_user_id, pending_topic_id into v_judge_user_id, v_pending_topic_id from _t0063_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select count(*) into v_count1 from public.topics where id = v_pending_topic_id;
  -- 「再接続」を模して同じ問い合わせをもう一度実行する。
  select count(*) into v_count2 from public.topics where id = v_pending_topic_id;
  if v_count1 <> 0 or v_count2 <> 0 then
    raise exception 'FAIL: 再取得のいずれかで未発表お題が漏れた(1回目=%, 2回目=%)', v_count1, v_count2;
  end if;
  raise notice 'PASS: リロード相当の再取得でも未発表お題は漏れない';
end $$;

-- ============================================================
-- ここから追加テスト（再レビュー2回目対応：項目3・4・5・6）。
-- 1本目のライブは既にtest15でclosed・結果公開済みにしてしまっているため、
-- 独立した2本目のライブを新規に用意して検証する。
-- ============================================================
insert into public.topic_bank (id, body, format, is_active) values
  ('d2000000-0000-0000-0000-000000000011', 'P1-8/9追加テスト用お題A', 'text', true),
  ('d2000000-0000-0000-0000-000000000012', 'P1-8/9追加テスト用お題B', 'text', true)
on conflict do nothing;

do $$
declare
  v_live_id uuid;
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';

  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000f', true);

  select live_id into v_live_id from public.create_live_preparation(
    now(), 'P1-8/9追加テスト', 20, 2,
    array['d2000000-0000-0000-0000-000000000011', 'd2000000-0000-0000-0000-000000000012']::uuid[]
  );
  update public.lives set current_phase = 'opening' where id = v_live_id;

  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000c', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000d', true);
  perform public.join_live(v_live_id, 'player', null);

  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  perform public.begin_game(v_live_id);
end $$;

create temporary table _t0063_ctx2 as
select
  l.id as live_id,
  active_t.id as active_turn_id,
  pending_t.id as pending_turn_id,
  active_t.topic_id as active_topic_id,
  pending_t.topic_id as pending_topic_id,
  active_p.id as answerer_participant_id,
  active_p.user_id as answerer_user_id
from public.lives l
join public.turns active_t on active_t.live_id = l.id and active_t.status = 'active'
join public.turns pending_t on pending_t.live_id = l.id and pending_t.status = 'pending'
join lateral (
  select p.id, p.user_id from public.participants p
  where p.live_id = l.id and p.group_id = active_t.group_id and p.role = 'player'
  limit 1
) active_p on true
where l.title = 'P1-8/9追加テスト';

grant select on _t0063_ctx2 to authenticated, anon;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from _t0063_ctx2;
  if v_count <> 1 then
    raise exception 'FAIL: 追加テスト用ライブの組分け結果が特定できなかった';
  end if;
end $$;

reset role;
update public.lives
  set current_phase = 'answering', phase_deadline = now() + interval '10 minutes', answering_paused = false
  where id = (select live_id from _t0063_ctx2);

-- ============================================================
-- テスト17（項目4：バックフィル）：回答が無いターンにrecompute_answering_cue_for_turn
--           を呼んだ場合、busy=false・pending_participant_id=nullのcueが作られる
--           （0063適用時にlives.current_turn_idが既にあるライブへ行う
--           バックフィル文と全く同じ呼び出し方で検証する）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_row record;
begin
  select live_id, active_turn_id into v_live_id, v_turn_id from _t0063_ctx2;

  -- 「バックフィル前（0063適用直後、トリガーがまだ一度も発火していない）」の
  -- 状態を模して、既存のcue行を一旦消す。
  delete from public.answering_cues where live_id = v_live_id;

  perform public.recompute_answering_cue_for_turn(v_turn_id);

  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row is null then
    raise exception 'FAIL: バックフィル相当の呼び出し後もcueが作られない';
  end if;
  if v_row.busy is not false then
    raise exception 'FAIL: 回答が無いターンのbusyがfalseになっていない';
  end if;
  if v_row.pending_participant_id is not null then
    raise exception 'FAIL: 回答が無いターンでpending_participant_idがnullになっていない';
  end if;
  raise notice 'PASS: 回答が無いターンのバックフィルはbusy=false・pending_participant_id=nullになる';
end $$;

-- ============================================================
-- テスト18（項目4：バックフィル）：未解決（未公開）回答が1件あるターンで
--           呼んだ場合、busy=true・その回答者だけがpending_participant_idになる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_answerer_id uuid;
  v_row record;
begin
  select live_id, active_turn_id, answerer_participant_id
    into v_live_id, v_turn_id, v_answerer_id
    from _t0063_ctx2;

  insert into public.answers (turn_id, participant_id, seq, body)
    values (v_turn_id, v_answerer_id, 1, 'バックフィルテスト用の未公開回答');

  delete from public.answering_cues where live_id = v_live_id;
  perform public.recompute_answering_cue_for_turn(v_turn_id);

  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.busy is not true then
    raise exception 'FAIL: 未解決(未公開)回答があるのにbusyがtrueになっていない';
  end if;
  if v_row.pending_participant_id is distinct from v_answerer_id then
    raise exception 'FAIL: 未公開回答の投稿者だけがpending_participant_idになっていない';
  end if;
  raise notice 'PASS: 未解決(未公開)回答が1件あるターンはbusy=true・その投稿者だけがpending_participant_idになる';
end $$;

-- ============================================================
-- テスト19（項目3）：ターン進行後、過去ターンの回答を後から更新しても、
--           現在ターンのcueが過去ターンの情報で上書き（巻き戻し）されない。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_old_turn_id uuid;
  v_new_turn_id uuid;
  v_row record;
begin
  select live_id, active_turn_id, pending_turn_id
    into v_live_id, v_old_turn_id, v_new_turn_id
    from _t0063_ctx2;

  -- advanceIfDueの進行（旧ターンdone・新ターンactive・lives.current_turn_id更新）を模す。
  update public.turns set status = 'done' where id = v_old_turn_id;
  update public.turns set status = 'active' where id = v_new_turn_id;
  update public.lives set current_turn_id = v_new_turn_id where id = v_live_id;

  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.turn_id is distinct from v_new_turn_id then
    raise exception 'FAIL: ターン進行後、cueが新しいターンへ切り替わっていない';
  end if;
  if v_row.busy is not false then
    raise exception 'FAIL: 回答がまだ無い新ターンのcueがbusy=falseになっていない';
  end if;

  -- 旧ターンの回答を後から更新する（採点確定処理の再送・リトライ等を模す）。
  update public.answers set revealed_at = coalesce(revealed_at, now()) where turn_id = v_old_turn_id;

  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.turn_id is distinct from v_new_turn_id then
    raise exception 'FAIL: 過去ターンの回答更新で、現在ターンのcueが過去ターンの情報に巻き戻された';
  end if;
  if v_row.busy is not false then
    raise exception 'FAIL: 過去ターンの回答更新で、現在ターンのbusyが変わってしまった';
  end if;

  raise notice 'PASS: 過去ターンの回答を後から更新しても、現在ターンのcueは巻き戻されない';
end $$;

-- ============================================================
-- テスト25（再レビュー3回目・項目1）：answering_cues.revisionは、
--           recompute_answering_cue_for_turnを呼ぶたびに単調増加する
--           （テスト19の時点でlives.current_turn_idはpending_turn_id側へ
--           既に進んでいるため、そちら＝現在のターンに対して確認する）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_current_turn_id uuid;
  v_rev1 bigint;
  v_rev2 bigint;
begin
  select live_id, pending_turn_id into v_live_id, v_current_turn_id from _t0063_ctx2;

  select revision into v_rev1 from public.answering_cues where live_id = v_live_id;
  if v_rev1 is null or v_rev1 <= 0 then
    raise exception 'FAIL: revisionが正の値になっていない(revision=%)', v_rev1;
  end if;

  perform public.recompute_answering_cue_for_turn(v_current_turn_id);
  select revision into v_rev2 from public.answering_cues where live_id = v_live_id;
  if v_rev2 <= v_rev1 then
    raise exception 'FAIL: 再計算のたびにrevisionが増えていない(before=%, after=%)', v_rev1, v_rev2;
  end if;

  raise notice 'PASS: revisionは正の値で、再計算のたびに単調増加する(% → %)', v_rev1, v_rev2;
end $$;

-- ============================================================
-- テスト26（再レビュー3回目・項目1）：revision列に正数チェック制約が
--           入っている（0を含む0以下への更新が拒否される）。
-- ============================================================
do $$
declare
  v_live_id uuid;
begin
  select live_id into v_live_id from _t0063_ctx2;
  reset role;
  begin
    update public.answering_cues set revision = 0 where live_id = v_live_id;
    raise exception 'FAIL: revision=0への更新がチェック制約で拒否されなかった';
  exception
    when check_violation then
      raise notice 'PASS: revisionの正数チェック制約(revision > 0)が効いている';
  end;
end $$;

-- ============================================================
-- テスト20（項目5）：公開済み結果に含まれるお題は第三者から取得できる
--           （1本目のライブ、test15で既に結果公開済み）。
-- ============================================================
do $$
declare
  v_topic_id uuid;
  v_body text;
begin
  select active_topic_id into v_topic_id from _t0063_ctx;
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-0000000000ff', true);
  select body into v_body from public.topics where id = v_topic_id;
  if v_body is null then
    raise exception 'FAIL: 公開済み結果に含まれるお題を第三者が取得できない';
  end if;
  raise notice 'PASS: 公開済み結果に含まれるお題は第三者から取得できる';
end $$;

-- ============================================================
-- テスト20b（再レビュー3回目・項目2）：公開済み結果に含まれる回答は、お題だけ
--           でなく回答本文自体も、同じライブのincluded回答であれば第三者から
--           引き続き取得できる（既存の公開結果表示を壊していないことの確認）。
-- ============================================================
do $$
declare
  v_answer_id uuid;
  v_body text;
begin
  select id into v_answer_id from public.answers where turn_id = (select active_turn_id from _t0063_ctx);
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-0000000000ff', true);
  select body into v_body from public.answers where id = v_answer_id;
  if v_body is null then
    raise exception 'FAIL: 公開済み結果に含まれる回答本文を第三者が取得できない';
  end if;
  raise notice 'PASS: 公開済み結果に含まれる回答本文は第三者から取得できる（既存の公開結果表示は壊れていない）';
end $$;

-- ============================================================
-- テスト21（項目5）：未公開結果のお題は第三者から取得できない
--           （2本目のライブは進行中でresults未公開）。
-- ============================================================
do $$
declare
  v_topic_id uuid;
  v_found boolean;
begin
  select active_topic_id into v_topic_id from _t0063_ctx2;
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-0000000000ff', true);
  select exists(select 1 from public.topics where id = v_topic_id) into v_found;
  if v_found then
    raise exception 'FAIL: 未公開ライブのお題を第三者が取得できてしまった';
  end if;
  raise notice 'PASS: 未公開結果のお題は第三者から取得できない';
end $$;

-- ============================================================
-- テスト21b（再レビュー3回目・項目2）：未公開ライブの回答本文は第三者から
--           取得できない（2本目のライブは進行中でresults未公開、結果にも
--           一切紐付いていない状態）。
-- ============================================================
do $$
declare
  v_answer_id uuid;
  v_found boolean;
begin
  select id into v_answer_id from public.answers
    where turn_id = (select active_turn_id from _t0063_ctx2)
    order by created_at asc limit 1;
  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-0000000000ff', true);
  select exists(select 1 from public.answers where id = v_answer_id) into v_found;
  if v_found then
    raise exception 'FAIL: 未公開ライブの回答を第三者が取得できてしまった';
  end if;
  raise notice 'PASS: 未公開ライブの回答は第三者から取得できない';
end $$;

-- ============================================================
-- テスト22（項目5・再レビュー3回目で項目2も統合）：別ライブの公開結果に
--           不整合に紐付けても、無関係な（未公開の）別ライブの「お題」と
--           「回答本文」のどちらも取得できない。t2.live_id=r.live_id /
--           topics.live_id=r.live_id（お題側）、r.live_id=answers.live_id /
--           t.live_id=r.live_id（回答側）の明示的な一致条件が無いと、理屈の
--           上では「1本目(公開済み)のsns_live_resultsに2本目(未公開)の回答を
--           誤って(あるいは悪意を持って)紐付けた」場合に漏れうる経路を、
--           意図的にその不整合な行を作って検証する。
-- ============================================================
do $$
declare
  v_live1_result_id uuid;
  v_live2_topic_id uuid;
  v_live2_answer_id uuid;
  v_found_topic boolean;
  v_found_answer boolean;
begin
  reset role;
  select id into v_live1_result_id from public.sns_live_results
    where live_id = (select live_id from _t0063_ctx) limit 1;
  select active_topic_id into v_live2_topic_id from _t0063_ctx2;
  select id into v_live2_answer_id from public.answers
    where turn_id = (select active_turn_id from _t0063_ctx2)
    order by created_at asc limit 1;

  insert into public.sns_live_result_answers (id, live_result_id, answer_id, included)
    values (gen_random_uuid(), v_live1_result_id, v_live2_answer_id, true);

  set local role authenticated;
  perform set_config('myapp.uid', 'd1000000-0000-0000-0000-0000000000ff', true);
  select exists(select 1 from public.topics where id = v_live2_topic_id) into v_found_topic;
  select exists(select 1 from public.answers where id = v_live2_answer_id) into v_found_answer;

  reset role;
  delete from public.sns_live_result_answers
    where live_result_id = v_live1_result_id and answer_id = v_live2_answer_id;

  if v_found_topic then
    raise exception 'FAIL: 別ライブの公開結果に不整合に紐付けることで、無関係なライブの未公開お題が取得できてしまった';
  end if;
  if v_found_answer then
    raise exception 'FAIL: 別ライブの公開結果に不整合に紐付けることで、無関係なライブの未公開回答本文が取得できてしまった';
  end if;
  raise notice 'PASS: 一致条件（お題・回答本文とも）により、別ライブの公開結果を経由した漏洩は防がれる';
end $$;

-- ============================================================
-- テスト22b（再レビュー3回目・項目2）：不整合な紐付けの有無に関わらず、
--           回答者本人は自分の未公開回答を引き続き取得できる（回帰確認。
--           既存のテスト9と同じ確認をlive2でも行う）。
-- ============================================================
do $$
declare
  v_answerer_user_id uuid;
  v_answer_id uuid;
  v_count int;
begin
  select answerer_user_id into v_answerer_user_id from _t0063_ctx2;
  select id into v_answer_id from public.answers
    where turn_id = (select active_turn_id from _t0063_ctx2)
    order by created_at asc limit 1;

  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_user_id::text, true);
  select count(*) into v_count from public.answers where id = v_answer_id;
  if v_count <> 1 then
    raise exception 'FAIL: 回答者本人が自分の未公開回答を取得できない';
  end if;
  raise notice 'PASS: 回答者本人は引き続き自分の未公開回答を取得できる';
end $$;

-- ============================================================
-- テスト22c（再レビュー3回目・項目2）：発表済み(revealed_at設定済み)回答は、
--           同じライブの非退場参加者が引き続き取得できる（回帰確認。既存の
--           テスト13と同じ確認をlive2でも行う）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_answer_id uuid;
  v_answerer_participant_id uuid;
  v_judge_user_id uuid;
  v_count int;
begin
  select live_id, answerer_participant_id into v_live_id, v_answerer_participant_id from _t0063_ctx2;
  select id into v_answer_id from public.answers
    where turn_id = (select active_turn_id from _t0063_ctx2)
    order by created_at asc limit 1;

  reset role;
  update public.answers set revealed_at = coalesce(revealed_at, now()) where id = v_answer_id;

  -- 回答者本人ではない、同じライブの別のplayerを1人特定する。
  select p.user_id into v_judge_user_id from public.participants p
    where p.live_id = v_live_id and p.role = 'player' and p.id <> v_answerer_participant_id
    limit 1;

  set local role authenticated;
  perform set_config('myapp.uid', v_judge_user_id::text, true);
  select count(*) into v_count from public.answers where id = v_answer_id;
  if v_count <> 1 then
    raise exception 'FAIL: 発表済み回答を同じライブの他参加者が取得できない';
  end if;
  raise notice 'PASS: 発表済み回答は引き続き同じライブの非退場参加者が取得できる';
end $$;

-- ============================================================
-- テスト23（項目6）：answering_cuesのテーブル権限自体がRLSとは別に最小化されている。
-- ============================================================
do $$
begin
  if has_table_privilege('anon', 'public.answering_cues', 'SELECT') then
    raise exception 'FAIL: anonがanswering_cuesのSELECT権限を持っている';
  end if;
  if not has_table_privilege('authenticated', 'public.answering_cues', 'SELECT') then
    raise exception 'FAIL: authenticatedがanswering_cuesのSELECT権限を持っていない';
  end if;
  if has_table_privilege('authenticated', 'public.answering_cues', 'INSERT') then
    raise exception 'FAIL: authenticatedがanswering_cuesのINSERT権限を持っている';
  end if;
  if has_table_privilege('authenticated', 'public.answering_cues', 'UPDATE') then
    raise exception 'FAIL: authenticatedがanswering_cuesのUPDATE権限を持っている';
  end if;
  if has_table_privilege('authenticated', 'public.answering_cues', 'DELETE') then
    raise exception 'FAIL: authenticatedがanswering_cuesのDELETE権限を持っている';
  end if;
  raise notice 'PASS: answering_cuesのテーブル権限はSELECT(authenticatedのみ)に最小化されている';
end $$;

-- ============================================================
-- テスト24（項目6）：authenticatedが実際にanswering_cuesを直接UPDATEしようと
--           しても、テーブル権限(GRANT)自体で拒否される（RLSまで到達しない）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_answerer_user_id uuid;
begin
  select live_id, answerer_user_id into v_live_id, v_answerer_user_id from _t0063_ctx2;
  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_user_id::text, true);
  begin
    update public.answering_cues set busy = true where live_id = v_live_id;
    raise exception 'FAIL: authenticatedがanswering_cuesを直接UPDATEできてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: authenticatedはanswering_cuesを直接UPDATEできない(insufficient_privilege)';
  end;
end $$;

reset role;
drop table _t0063_ctx;
drop table _t0063_ctx2;

select 'ALL P1-8/9 TESTS PASSED' as result;
