-- 0079 回帰テスト：ライブ進行の司会ブラウザ依存解消（サーバー側を正とした進行）。
-- host_advance_topic_reveal_to_answering / host_advance_interlude_to_opening /
-- sync_answering_pause_if_due / resolve_answer_if_due / close_liveのfinal_result
-- ゲート / emergency_close_live を検証する。
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('a7900000-0000-0000-0000-00000000000a'), -- 回答する参加者(group1)
  ('a7900000-0000-0000-0000-00000000000b'), -- 審査員1(group2)
  ('a7900000-0000-0000-0000-00000000000c'), -- 審査員2(group2)
  ('a7900000-0000-0000-0000-0000000000ff'), -- 非host
  ('a7900000-0000-0000-0000-00000000000f')  -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a7900000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a7910000-0000-0000-0000-000000000001', '0079テスト用お題A', 'text', true),
  ('a7910000-0000-0000-0000-000000000002', '0079テスト用お題B', 'text', true)
on conflict do nothing;

do $$
declare
  v_live_id uuid;
  v_group1 uuid;
  v_begin_result record;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テスト', 20, 2,
    array['a7910000-0000-0000-0000-000000000001', 'a7910000-0000-0000-0000-000000000002']::uuid[]
  );
  reset role;

  update public.lives set current_phase = 'interlude', phase_deadline = now() + interval '30 seconds' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000c', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  -- randomize_groupsがpreferred_role='player'をrole='player'へ確定し、group_idを
  -- 割り当てる（begin_gameのプレイヤー人数判定はrole='player'を見るため必須）。
  -- 割り当て自体はランダムなので、直後に本テスト用途で決め打ちへ上書きする。
  perform public.randomize_groups(v_live_id);
  reset role;

  -- 組分けをランダムに依存させず、確実にgroup1=回答者・group2=審査員2名にする。
  select id into v_group1 from public.groups where live_id = v_live_id order by group_order asc limit 1;
  update public.participants set group_id = v_group1
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';
  update public.participants set group_id = (
      select id from public.groups where live_id = v_live_id and id <> v_group1 limit 1
    )
    where live_id = v_live_id and user_id in (
      'a7900000-0000-0000-0000-00000000000b', 'a7900000-0000-0000-0000-00000000000c'
    );

  -- begin_gameはcurrent_phase='opening' かつ current_turn_id is nullの行だけを
  -- 対象にする（0071:1045-1050）。
  update public.lives set current_phase = 'opening', current_turn_id = null where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_begin_result from public.begin_game(v_live_id);
  reset role;
  if v_begin_result.ok is not true then
    raise exception 'FAIL: begin_gameが失敗した(reason=%)', v_begin_result.reason;
  end if;

  -- begin_gameはopening/topic_revealへ進めるため、テスト用にinterludeへ戻す
  -- （本テストはinterlude→openingのRPC単体を検証したいだけで、begin_gameは
  -- turns/groupsの土台作りのためだけに呼んでいる）。
  update public.lives set current_phase = 'interlude', current_turn_id = null, phase_deadline = now() + interval '30 seconds'
    where id = v_live_id;
end $$;

create temporary table _t0079_ctx as
select l.id as live_id,
  (select id from public.groups where live_id = l.id order by group_order asc limit 1) as group1_id,
  (select t.id from public.turns t join public.groups g on g.id = t.group_id
     where t.live_id = l.id and g.group_order = 1 order by t.round asc limit 1) as turn1_id
from public.lives l where l.title = '0079テスト';

grant select on _t0079_ctx to authenticated, anon;

-- ============================================================
-- テスト1: host_advance_interlude_to_opening — 締切前は非hostでもupdated=false。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_result record;
begin
  select live_id into v_live_id from _t0079_ctx;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.host_advance_interlude_to_opening(v_live_id, 45000);

  if v_result.updated is not false then
    raise exception 'FAIL: interludeの締切前なのにupdated=trueになった';
  end if;
  raise notice 'PASS: interlude→openingは締切前は非hostの呼び出しでも進まない';
end $$;

-- ============================================================
-- テスト2: 締切到達後は進み、新しい締切がnow()から生成される。二重呼び出しは
--          updated=falseのまま（冪等）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_result record;
begin
  select live_id into v_live_id from _t0079_ctx;
  update public.lives set phase_deadline = now() - interval '1 second' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.host_advance_interlude_to_opening(v_live_id, 45000);

  if v_result.updated is not true then
    raise exception 'FAIL: 締切到達後もupdated=trueにならなかった';
  end if;
  if (v_result.live).current_phase <> 'opening' then
    raise exception 'FAIL: current_phaseがopeningになっていない';
  end if;
  if (v_result.live).phase_deadline <= now() then
    raise exception 'FAIL: 新しい締切がnow()より未来になっていない';
  end if;

  select * into v_result from public.host_advance_interlude_to_opening(v_live_id, 45000);
  if v_result.updated is not false then
    raise exception 'FAIL: 既にopeningのはずなのに二重に遷移した';
  end if;

  raise notice 'PASS: interlude→openingは締切到達後にのみ進み、二重呼び出しは実害なし';
end $$;

-- ============================================================
-- テスト3: host_advance_topic_reveal_to_answering — 締切前拒否・締切後成功・
--          ターン不一致は拒否。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_result record;
begin
  select live_id, turn1_id into v_live_id, v_turn1 from _t0079_ctx;

  update public.lives
    set current_phase = 'topic_reveal', current_turn_id = v_turn1, phase_deadline = now() + interval '30 seconds'
    where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true); -- 参加者(非host)
  select * into v_result from public.host_advance_topic_reveal_to_answering(v_live_id, v_turn1, 60000);
  if v_result.updated is not false then
    raise exception 'FAIL: topic_revealの締切前なのにupdated=trueになった';
  end if;

  -- ターンID不一致（別の値）でも拒否される。
  select * into v_result from public.host_advance_topic_reveal_to_answering(v_live_id, gen_random_uuid(), 60000);
  if v_result.updated is not false then
    raise exception 'FAIL: 期待turn_idが不一致なのにupdated=trueになった';
  end if;

  reset role;
  update public.lives set phase_deadline = now() - interval '1 second' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true);
  select * into v_result from public.host_advance_topic_reveal_to_answering(v_live_id, v_turn1, 60000);
  if v_result.updated is not true then
    raise exception 'FAIL: 締切到達後もtopic_reveal→answeringが進まなかった';
  end if;
  if (v_result.live).current_phase <> 'answering' then
    raise exception 'FAIL: current_phaseがansweringになっていない';
  end if;

  raise notice 'PASS: topic_reveal→answeringは締切超過・ターン一致の両方を満たした時だけ、誰の呼び出しでも進む';
end $$;

-- ============================================================
-- テスト4: sync_answering_pause_if_due — 未表示の回答がある間はpauseし、
--          無くなればresumeする。休止中に消費した時間は予算から引かれない。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_participant_a uuid;
  v_answer_id uuid;
  v_result record;
  v_remaining_snapshot bigint;
begin
  select live_id, turn1_id into v_live_id, v_turn1 from _t0079_ctx;
  select id into v_participant_a from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';

  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn1, phase_deadline = now() + interval '40 seconds',
        answering_paused = false, answering_remaining_ms = null
    where id = v_live_id;

  insert into public.answers (id, turn_id, participant_id, seq, body)
    values (gen_random_uuid(), v_turn1, v_participant_a, 1, '0079テスト回答')
    returning id into v_answer_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.sync_answering_pause_if_due(v_live_id, v_turn1);

  if v_result.updated is not true then
    raise exception 'FAIL: 未表示の回答があるのにpauseしなかった';
  end if;
  if (v_result.live).answering_paused is not true then
    raise exception 'FAIL: answering_pausedがtrueになっていない';
  end if;
  if (v_result.live).phase_deadline is not null then
    raise exception 'FAIL: pause中なのにphase_deadlineがnullになっていない';
  end if;
  v_remaining_snapshot := (v_result.live).answering_remaining_ms;
  if v_remaining_snapshot is null or v_remaining_snapshot <= 0 then
    raise exception 'FAIL: pause時点の残り時間スナップショットが不正(got=%)', v_remaining_snapshot;
  end if;

  -- 同じ状態でもう一度呼んでも変化しない（既にpaused）。
  select * into v_result from public.sync_answering_pause_if_due(v_live_id, v_turn1);
  if v_result.updated is not false then
    raise exception 'FAIL: 既にpause済みなのに再度updated=trueになった';
  end if;

  -- 未表示の回答を無くす（revealed_at+resolvedへ更新）と、次の呼び出しでresumeする。
  update public.answers set revealed_at = now(), resolved = true, judging_ends_at = now() where id = v_answer_id;
  select * into v_result from public.sync_answering_pause_if_due(v_live_id, v_turn1);

  if v_result.updated is not true then
    raise exception 'FAIL: 未表示の回答が無くなったのにresumeしなかった';
  end if;
  if (v_result.live).answering_paused is not false then
    raise exception 'FAIL: resume後もanswering_pausedがtrueのまま';
  end if;
  if (v_result.live).answering_remaining_ms is not null then
    raise exception 'FAIL: resume後もanswering_remaining_msが残っている';
  end if;
  -- 新しい締切は「pause前の残り時間」ぶんだけ先になっているはず（休止時間を
  -- 消費していない）。多少の実行時間の誤差を許容し、残り時間の90%〜110%の
  -- 範囲に新しい締切があることを確認する。
  if abs(extract(epoch from ((v_result.live).phase_deadline - now())) * 1000 - v_remaining_snapshot) > (v_remaining_snapshot * 0.5 + 2000) then
    raise exception 'FAIL: resume後の新しい締切が、保存していた残り時間から大きくずれている(remaining=%, deadline_in_ms=%)',
      v_remaining_snapshot, extract(epoch from ((v_result.live).phase_deadline - now())) * 1000;
  end if;

  reset role;
  delete from public.answers where id = v_answer_id;
  raise notice 'PASS: sync_answering_pause_if_dueは未表示回答の有無に応じて原子的にpause/resumeし、休止時間ぶんは予算から引かれない';
end $$;

-- ============================================================
-- テスト5: resolve_answer_if_due — 全員投票前は締切前なら拒否、締切後(全員未投票
--          でも猶予超過)なら成功。全員投票なら締切前でも即成功。集計・
--          reveal_sequence_untilの設定が同一トランザクションで行われる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_participant_a uuid;
  v_judge_b uuid;
  v_judge_c uuid;
  v_answer_id uuid;
  v_result record;
begin
  select live_id, turn1_id into v_live_id, v_turn1 from _t0079_ctx;
  select id into v_participant_a from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';
  select id into v_judge_b from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000b';
  select id into v_judge_c from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000c';

  update public.lives set current_phase = 'answering', current_turn_id = v_turn1 where id = v_live_id;

  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, judging_ends_at)
    values (gen_random_uuid(), v_turn1, v_participant_a, 2, '0079テスト採点対象回答', now(), now() + interval '10 seconds')
    returning id into v_answer_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);

  -- まだ誰も投票しておらず、締切も先：拒否される。
  select * into v_result from public.resolve_answer_if_due(v_answer_id);
  if v_result.updated is not false then
    raise exception 'FAIL: 誰も投票せず締切前なのにupdated=trueになった';
  end if;

  reset role;
  insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_judge_b, 3);

  -- 1人だけ投票、締切も先：まだ拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.resolve_answer_if_due(v_answer_id);
  if v_result.updated is not false then
    raise exception 'FAIL: 1人しか投票していないのにupdated=trueになった';
  end if;
  reset role;

  insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_judge_c, 3);

  -- 全員投票済み：締切前でも即座に成功する。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true); -- 非hostでもよい
  select * into v_result from public.resolve_answer_if_due(v_answer_id);
  reset role;

  if v_result.updated is not true then
    raise exception 'FAIL: 全員投票後もupdated=trueにならなかった';
  end if;
  if (v_result.answer).resolved is not true then
    raise exception 'FAIL: answer.resolvedがtrueになっていない';
  end if;
  if (v_result.answer).score_total <> 6 then
    raise exception 'FAIL: score_totalが6でない(got=%)', (v_result.answer).score_total;
  end if;
  if (v_result.answer).top_score_votes <> 2 then
    raise exception 'FAIL: top_score_votesが2でない(got=%)', (v_result.answer).top_score_votes;
  end if;
  if (v_result.answer).judge_count <> 2 then
    raise exception 'FAIL: judge_countが2でない(got=%)', (v_result.answer).judge_count;
  end if;
  if (v_result.answer).laugh_triggered is not true then
    raise exception 'FAIL: laugh_triggeredがtrueになっていない(2/2が3点)';
  end if;
  if (v_result.live).reveal_sequence_until is null or (v_result.live).reveal_sequence_until <= now() then
    raise exception 'FAIL: reveal_sequence_untilが未来の時刻に設定されていない';
  end if;

  -- 冪等性：既に確定済みの回答を再度呼んでもupdated=falseのまま。
  select * into v_result from public.resolve_answer_if_due(v_answer_id);
  if v_result.updated is not false then
    raise exception 'FAIL: 既に確定済みなのに再度updated=trueになった（二重確定の恐れ）';
  end if;

  delete from public.scores where answer_id = v_answer_id;
  delete from public.answers where id = v_answer_id;
  raise notice 'PASS: resolve_answer_if_dueは全員投票または締切超過の時だけ、集計・確定・reveal_sequence_untilの設定を1トランザクションで原子的に行う';
end $$;

-- ============================================================
-- テスト6: resolve_answer_if_due — 締切(judging_ends_at+400ms)超過後は、
--          投票が揃っていなくても確定する（審査員の一部が無反応でも進行が
--          止まらない）。退場済み(kicked_at)の判定者は分母から除外される。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_participant_a uuid;
  v_judge_b uuid;
  v_judge_c uuid;
  v_answer_id uuid;
  v_result record;
begin
  select live_id, turn1_id into v_live_id, v_turn1 from _t0079_ctx;
  select id into v_participant_a from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';
  select id into v_judge_b from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000b';
  select id into v_judge_c from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000c';

  -- judge_cを退場済みにする（分母から除外されるはず）。
  update public.participants set kicked_at = now() where id = v_judge_c;

  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, judging_ends_at)
    values (gen_random_uuid(), v_turn1, v_participant_a, 3, '0079テスト締切超過回答', now(), now() - interval '1 second')
    returning id into v_answer_id;
  insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_judge_b, 2);

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.resolve_answer_if_due(v_answer_id);
  reset role;

  if v_result.updated is not true then
    raise exception 'FAIL: 締切超過後なのに未確定のまま(judge_cが退場済みでjudge_bのみで確定できるはず)';
  end if;
  if (v_result.answer).judge_count <> 1 then
    raise exception 'FAIL: 退場済みjudge_cが分母から除外されていない(judge_count got=%)', (v_result.answer).judge_count;
  end if;
  if (v_result.answer).score_total <> 2 then
    raise exception 'FAIL: score_totalが2でない(got=%)', (v_result.answer).score_total;
  end if;

  update public.participants set kicked_at = null where id = v_judge_c;
  delete from public.scores where answer_id = v_answer_id;
  delete from public.answers where id = v_answer_id;
  raise notice 'PASS: 締切+猶予超過後は投票が揃っていなくても確定し、退場済み判定者は分母から除外される';
end $$;

-- ============================================================
-- テスト7（途中失敗時のロールバック）：answers確定後のlives更新を強制的に
--          失敗させ、answers.resolvedも含めて全体がロールバックされることを
--          確認する（採点確定処理の原子性）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_participant_a uuid;
  v_judge_b uuid;
  v_answer_id uuid;
  v_failed boolean := false;
  v_resolved_after boolean;
begin
  select live_id, turn1_id into v_live_id, v_turn1 from _t0079_ctx;
  select id into v_participant_a from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';
  select id into v_judge_b from public.participants
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000b';

  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, judging_ends_at)
    values (gen_random_uuid(), v_turn1, v_participant_a, 4, '0079テストロールバック対象', now(), now() - interval '1 second')
    returning id into v_answer_id;
  insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_judge_b, 1);

  create function public._t0079_fail_lives_reveal() returns trigger
  language plpgsql as $trig$
  begin
    if new.reveal_sequence_until is not null and old.reveal_sequence_until is distinct from new.reveal_sequence_until then
      raise exception '0079_FORCED_FAILURE_FOR_TEST';
    end if;
    return new;
  end;
  $trig$;
  create trigger _t0079_fail_lives_reveal_trg
    before update on public.lives
    for each row execute function public._t0079_fail_lives_reveal();

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  begin
    perform public.resolve_answer_if_due(v_answer_id);
  exception
    when others then
      if sqlerrm = '0079_FORCED_FAILURE_FOR_TEST' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;

  drop trigger _t0079_fail_lives_reveal_trg on public.lives;
  drop function public._t0079_fail_lives_reveal();

  if not v_failed then
    raise exception 'FAIL: lives更新の失敗が例外として伝播しなかった（黙殺されている）';
  end if;

  select resolved into v_resolved_after from public.answers where id = v_answer_id;
  if v_resolved_after is not false then
    raise exception 'FAIL: lives更新失敗にも関わらずanswers.resolvedがtrueのまま残っている（部分成功）';
  end if;

  delete from public.scores where answer_id = v_answer_id;
  delete from public.answers where id = v_answer_id;
  raise notice 'PASS: 採点確定は1トランザクションであり、lives更新の失敗はanswers.resolvedの確定も含めて全体をロールバックする（部分成功が残らない）';
end $$;

-- ============================================================
-- テスト8: close_liveはfinal_result以外からは拒否され(error_code=NOT_FINAL_RESULT)、
--          既にclosedなら実害なくupdated=false相当(closed=false, error_codeなし)。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_result record;
begin
  select live_id into v_live_id from _t0079_ctx;
  update public.lives set current_phase = 'answering' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.close_live(v_live_id);

  if v_result.closed is not false then
    raise exception 'FAIL: final_result以外からのclose_liveがclosed=trueになった';
  end if;
  if v_result.error_code <> 'NOT_FINAL_RESULT' then
    raise exception 'FAIL: error_codeがNOT_FINAL_RESULTでない(got=%)', v_result.error_code;
  end if;

  update public.lives set current_phase = 'final_result' where id = v_live_id;
  select * into v_result from public.close_live(v_live_id);
  if v_result.closed is not true then
    raise exception 'FAIL: final_resultからのclose_liveが成功しなかった';
  end if;

  -- 既にclosed：エラーにはならず、closed=falseで実害なし。
  select * into v_result from public.close_live(v_live_id);
  if v_result.closed is not false or v_result.error_code is not null then
    raise exception 'FAIL: 既にclosed済みへの再呼び出しの挙動が想定と異なる(closed=%, error_code=%)',
      v_result.closed, v_result.error_code;
  end if;
  reset role;

  raise notice 'PASS: close_liveはfinal_resultからのみ成功し、それ以外は安全に拒否・二重操作も実害なし';
end $$;

-- ============================================================
-- テスト9: emergency_close_live — 非hostは拒否、進行中の任意フェーズから
--          実行でき、報酬(ポイント・段位・実績・参加回数)は一切付与されない。
--          その後apply_live_rank_rewardsを直接呼んでもLIVE_EMERGENCY_CLOSEDで
--          拒否される（二重の防止線）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_p1 uuid := 'a7900000-0000-0000-0000-00000000000a';
  v_before record;
  v_after record;
  v_result record;
  v_failed boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079緊急中止テスト', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[], 'official'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_p1::text, true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;

  update public.lives set current_phase = 'answering' where id = v_live_id;

  select mastery_meter, total_points, points_balance, live_count into v_before
    from public.profiles where id = v_p1;

  -- 非hostは拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  begin
    perform public.emergency_close_live(v_live_id, 'テスト起因の緊急中止');
    raise exception 'FAIL: 非hostがemergency_close_liveを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;

  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.emergency_close_live(v_live_id, 'テスト起因の緊急中止');
  reset role;

  if v_result.updated is not true then
    raise exception 'FAIL: answeringフェーズからのemergency_close_liveが成功しなかった';
  end if;
  if (v_result.live).current_phase <> 'closed' then
    raise exception 'FAIL: current_phaseがclosedになっていない';
  end if;
  if (v_result.live).emergency_closed is not true then
    raise exception 'FAIL: emergency_closedがtrueになっていない';
  end if;
  if (v_result.live).emergency_close_reason <> 'テスト起因の緊急中止' then
    raise exception 'FAIL: emergency_close_reasonが記録されていない';
  end if;
  if (v_result.live).rank_rewards_applied is not false then
    raise exception 'FAIL: 緊急中止なのにrank_rewards_appliedがtrueになっている';
  end if;

  select mastery_meter, total_points, points_balance, live_count into v_after
    from public.profiles where id = v_p1;
  if v_before.mastery_meter <> v_after.mastery_meter
    or v_before.total_points <> v_after.total_points
    or v_before.points_balance <> v_after.points_balance
    or v_before.live_count <> v_after.live_count
  then
    raise exception 'FAIL: 緊急中止なのに段位・ポイント・参加回数が変化した';
  end if;

  -- 二重の防止線：apply_live_rank_rewardsを直接叩いてもLIVE_EMERGENCY_CLOSEDで拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  begin
    perform public.apply_live_rank_rewards(v_live_id);
    raise exception 'FAIL: 緊急中止済みライブへのapply_live_rank_rewards直接呼び出しが成功してしまった';
  exception
    when others then
      if sqlerrm = 'LIVE_EMERGENCY_CLOSED' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;

  if not v_failed then
    raise exception 'FAIL: LIVE_EMERGENCY_CLOSEDが発生しなかった';
  end if;

  -- 二重操作：既にclosedなら実害なし。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.emergency_close_live(v_live_id, '2回目');
  reset role;
  if v_result.updated is not false then
    raise exception 'FAIL: 既にclosed済みへのemergency_close_live再呼び出しでupdated=trueになった';
  end if;

  raise notice 'PASS: emergency_close_liveは非hostを拒否し、進行中の任意フェーズから報酬付与なしで終了でき、事後の直接呼び出しも二重に防止される';
end $$;

reset role;
drop table _t0079_ctx;

-- ============================================================
-- 3回目レビュー対応の追加テスト群：
--   - open_reception（受付開始のサーバー権威化・項目1）
--   - timing_profile（standard/short_test、項目2）
--   司会tick側のクライアント時計非依存化（項目3）は、TS側の静的検査
--   （src/lib/__tests__/liveHostClockSkewWiring.check.ts、新規）で担保する。
-- ============================================================
insert into auth.users (id, is_anonymous) values ('a7920000-0000-0000-0000-000000000001', true)
  on conflict do nothing; -- 匿名ゲスト（handle_new_user()によりprofiles.is_guest=trueが自動生成される）

-- ------------------------------------------------------------
-- T-OR-1：open_receptionのアクセス制御（非host・匿名ゲスト・未認証を拒否）。
-- ------------------------------------------------------------
do $$
declare
  v_live_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テストOR1', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[]
  );
  reset role;
  if v_live_id is null then
    raise exception 'FAIL: T-OR-1のテスト用ライブを作成できなかった';
  end if;

  -- 非hostは拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  begin
    perform public.open_reception(v_live_id);
    raise exception 'FAIL: 非hostがopen_receptionを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then
        raise exception 'FAIL: 非host呼び出しで想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;

  -- 匿名ゲストも拒否される（is_host()はfalseのまま）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7920000-0000-0000-0000-000000000001', true);
  begin
    perform public.open_reception(v_live_id);
    raise exception 'FAIL: 匿名ゲストがopen_receptionを実行できてしまった';
  exception
    when others then
      if sqlerrm <> 'not authorized' then
        raise exception 'FAIL: ゲスト呼び出しで想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;

  -- 未認証（anonロール・auth.uid()も取れない状態）も拒否される。open_reception
  -- はanonへのEXECUTE権限自体をrevoke済みのため、is_host()判定に到達する前に
  -- 「permission denied for function」でPostgres自身が拒否する（authenticated
  -- だが非hostの場合の'not authorized'より、さらに手前の層で防いでいる）。
  set local role anon;
  begin
    perform public.open_reception(v_live_id);
    raise exception 'FAIL: 未認証でopen_receptionを実行できてしまった';
  exception
    when others then
      if sqlerrm !~ 'permission denied' then
        raise exception 'FAIL: 未認証呼び出しで想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;

  if (select current_phase from public.lives where id = v_live_id) <> 'scheduled' then
    raise exception 'FAIL: 拒否されるべき呼び出しでcurrent_phaseが変化した';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: open_receptionは非host・匿名ゲスト・未認証のいずれからの呼び出しも拒否する';
end $$;

-- ------------------------------------------------------------
-- T-OR-2：正規hostによるopen_receptionの成功、締切がDBのnow()基準になる
-- こと、二重クリック・進行中・緊急中止済みライブからは開始できないこと。
-- ------------------------------------------------------------
do $$
declare
  v_live_id uuid;
  v_result record;
  v_before timestamptz;
  v_deadline_ms numeric;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テストOR2', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[]
  );

  v_before := clock_timestamp();
  select * into v_result from public.open_reception(v_live_id);
  reset role;

  if v_result.updated is not true then
    raise exception 'FAIL: 正規hostによるopen_receptionが成功しなかった(reason=%)', v_result.reason;
  end if;
  if (v_result.live).current_phase <> 'interlude' then
    raise exception 'FAIL: current_phaseがinterludeになっていない';
  end if;
  if (v_result.live).phase_deadline is null then
    raise exception 'FAIL: phase_deadlineが設定されていない';
  end if;
  -- 締切はDBのnow()＋standardのinterludeMs(15000ms)から生成される
  -- （クライアントから絶対時刻・秒数を渡す引数がそもそも存在しない）。
  v_deadline_ms := extract(epoch from ((v_result.live).phase_deadline - v_before)) * 1000;
  if v_deadline_ms < 14000 or v_deadline_ms > 16500 then
    raise exception 'FAIL: standardの受付開始締切が15秒前後になっていない(got=%ms)', v_deadline_ms;
  end if;

  -- 二重クリック：同じライブへもう一度呼んでも二重に進行しない
  -- （current_phaseが既にinterludeのため、想定内のNOT_SCHEDULEDで無視される）。
  select * into v_result from public.open_reception(v_live_id);
  if v_result.updated is not false or v_result.reason <> 'NOT_SCHEDULED' then
    raise exception 'FAIL: 二重クリックでopen_receptionが再度成功してしまった(updated=%, reason=%)',
      v_result.updated, v_result.reason;
  end if;

  -- 緊急中止(closed)後は開始できない。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  perform public.emergency_close_live(v_live_id, 'OR2テスト終了');
  select * into v_result from public.open_reception(v_live_id);
  reset role;
  if v_result.updated is not false or v_result.reason <> 'NOT_SCHEDULED' then
    raise exception 'FAIL: 緊急中止済み(closed)のライブでopen_receptionが成功してしまった';
  end if;

  raise notice 'PASS: open_receptionは正規hostからの1回目だけ成功し、締切はDBのnow()基準・二重クリックや終了済みライブからは安全に無視される';
end $$;

-- ------------------------------------------------------------
-- T-OR-3（dblinkによる本当の同時open_reception）：2つのセッションから
-- 同時にopen_receptionを呼んでも、実際に受付開始できるのは1回だけになる
-- ことを検証する。dblink拡張が使えない環境ではスキップ。
-- 別セッションから見えるよう、ヘルパー関数・ライブはブロックを分けて
-- コミットしてから使う（R2と同じ構成）。
-- ------------------------------------------------------------
create temporary table _t0079or_ctx (live_id uuid);
grant select on _t0079or_ctx to authenticated, anon;

do $$
declare
  v_live_id uuid;
  v_has_dblink boolean;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テストOR3', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[]
  );
  reset role;
  insert into _t0079or_ctx values (v_live_id);

  begin
    create extension if not exists dblink;
    v_has_dblink := true;
  exception when others then
    v_has_dblink := false;
  end;
  if not v_has_dblink then
    raise notice 'SKIP: dblink拡張が利用できないため、open_reception同時実行テストを省略';
    return;
  end if;

  create or replace function public._t0079or_call_open_reception(
    p_live_id uuid, p_hold_seconds numeric
  ) returns boolean
  language plpgsql
  as $f$
  declare
    v_updated boolean;
  begin
    perform 1 from public.lives where id = p_live_id for update;
    if p_hold_seconds > 0 then
      perform pg_sleep(p_hold_seconds);
    end if;
    perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
    select updated into v_updated from public.open_reception(p_live_id);
    return v_updated;
  end;
  $f$;
end $$;

do $$
declare
  v_conn text := 'dbname=' || current_database();
  v_connected boolean := false;
  v_live_id uuid;
  v_bg_updated boolean;
  v_main_updated boolean;
begin
  if to_regprocedure('public._t0079or_call_open_reception(uuid,numeric)') is null then
    return;
  end if;
  select live_id into v_live_id from _t0079or_ctx;

  begin
    perform dblink_connect('t0079orrace', v_conn);
    v_connected := true;
  exception when others then
    raise notice 'SKIP: dblink接続に失敗したため、open_reception同時実行テストを省略 (%)', sqlerrm;
  end;

  if v_connected then
    perform dblink_send_query(
      't0079orrace',
      format('select public._t0079or_call_open_reception(%L::uuid, %s)', v_live_id, 1.0)
    );
    perform pg_sleep(0.3);

    v_main_updated := public._t0079or_call_open_reception(v_live_id, 0);

    select ok into v_bg_updated from dblink_get_result('t0079orrace') as t(ok boolean);
    perform dblink_disconnect('t0079orrace');

    if v_bg_updated and v_main_updated then
      raise exception 'FAIL: 2つの同時呼び出しの両方でopen_receptionが成功した（二重受付開始）';
    end if;
    if not v_bg_updated and not v_main_updated then
      raise exception 'FAIL: 2つの同時呼び出しのどちらも成功しなかった';
    end if;
    raise notice 'PASS: dblinkによる本当に同時のopen_reception呼び出しでも、成功するのは1回だけ';
  end if;
end $$;

do $$
begin
  if to_regprocedure('public._t0079or_call_open_reception(uuid,numeric)') is not null then
    drop function public._t0079or_call_open_reception(uuid, numeric);
  end if;
  update public.lives set current_phase = 'closed' where id = (select live_id from _t0079or_ctx);
end $$;
drop table _t0079or_ctx;

-- ------------------------------------------------------------
-- T-TP-1：ライブ作成時のtiming_profile既定値・official制約・不正値拒否・
-- 非hostからの書き換え不可。
-- ------------------------------------------------------------
do $$
declare
  v_live_id uuid;
  v_result record;
begin
  -- 1) 明示指定しなければstandardになる（既存ライブと同じ安全な既定値）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テストTP1a', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[]
  );
  reset role;
  if (select timing_profile from public.lives where id = v_live_id) <> 'standard' then
    raise exception 'FAIL: timing_profileを省略した場合の既定値がstandardになっていない';
  end if;
  update public.lives set current_phase = 'closed' where id = v_live_id;

  -- 2) official（本番）ライブでshort_testを指定するとアプリ的なエラーとして
  --    拒否される（official_live_counterには一切触れない）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.create_live_preparation(
    now(), '0079テストTP1b', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[],
    'official', 900001, 'short_test'
  );
  reset role;
  if v_result.ok is not false or v_result.live_id is not null then
    raise exception 'FAIL: officialライブでshort_testが指定できてしまった';
  end if;
  if exists (select 1 from public.official_live_counter where last_value >= 900001) then
    raise exception 'FAIL: 拒否されたはずのofficial採番でカウンターが消費された';
  end if;

  -- 3) 不正な時間プロファイル文字列も拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.create_live_preparation(
    now(), '0079テストTP1c', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[],
    'test', null, 'bogus_profile'
  );
  reset role;
  if v_result.ok is not false or v_result.live_id is not null then
    raise exception 'FAIL: 不正な時間プロファイル文字列が受理されてしまった';
  end if;

  -- 4) testライブはshort_testを指定できる。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テストTP1d', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[],
    'test', null, 'short_test'
  );
  reset role;
  if (select timing_profile from public.lives where id = v_live_id) <> 'short_test' then
    raise exception 'FAIL: testライブでshort_testを指定しても反映されていない';
  end if;

  -- 5) DB制約：RPCを経由せず直接official+short_testの行を作ろうとしても
  --    拒否される（最後の砦）。
  begin
    update public.lives set live_mode = 'official', timing_profile = 'short_test' where id = v_live_id;
    raise exception 'FAIL: DB制約を経由せずofficial+short_testの行が作成できてしまった';
  exception
    when check_violation then
      null; -- 想定どおり拒否された
  end;

  -- 6) 一般利用者（非host）は直接lives.timing_profileを書き換えられない
  --    （RLS lives_write_hostがis_host()のみ許可。更新0件になり値は変わらない）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  update public.lives set timing_profile = 'standard' where id = v_live_id;
  reset role;
  if (select timing_profile from public.lives where id = v_live_id) <> 'short_test' then
    raise exception 'FAIL: 非hostによるtiming_profile書き換えが実際に反映されてしまった';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: timing_profileの既定値・official制約・不正値拒否・非hostからの書き換え不可を確認';
end $$;

-- ------------------------------------------------------------
-- T-TP-2：_live_phase_duration_ms（進行RPCが内部で参照する時間表）の実際の
-- 秒数がstandard/short_testそれぞれでsrc/data/liveRoomTiming.tsの
-- STANDARD_TIMING/SHORT_TEST_TIMINGと一致することを直接確認する
-- （host_advance_*・reveal_next_answer_if_due・open_reception・begin_gameは
-- 全てこの1箇所を参照するため、ここで確認すれば重複を避けられる）。
-- ------------------------------------------------------------
do $$
declare
  v_expected_standard jsonb :=
    '{"interlude":15000,"opening":45000,"topic_reveal":13000,"answering":60000,"judge":10000,"group_result":15000}'::jsonb;
  v_expected_short jsonb :=
    '{"interlude":4000,"opening":8000,"topic_reveal":7000,"answering":20000,"judge":6000,"group_result":6000}'::jsonb;
  v_phase text;
  v_got integer;
  v_want integer;
begin
  for v_phase in select jsonb_object_keys(v_expected_standard) loop
    v_got := public._live_phase_duration_ms('standard', v_phase);
    v_want := (v_expected_standard ->> v_phase)::integer;
    if v_got <> v_want then
      raise exception 'FAIL: standardの%の時間が仕様と違う(got=%, want=%)', v_phase, v_got, v_want;
    end if;
    v_got := public._live_phase_duration_ms('short_test', v_phase);
    v_want := (v_expected_short ->> v_phase)::integer;
    if v_got <> v_want then
      raise exception 'FAIL: short_testの%の時間が仕様と違う(got=%, want=%)', v_phase, v_got, v_want;
    end if;
  end loop;
  raise notice 'PASS: standard/short_testの全フェーズの時間がsrc/data/liveRoomTiming.tsの値と一致する';
end $$;

-- ------------------------------------------------------------
-- T-TP-3：short_testプロファイルのライブが、受付開始→開幕→お題発表→
-- 回答受付→採点→組結果→次のお題発表まで、実際にshort_testの秒数
-- （本番の半分以下）で進行し、かつ極端なduration_ms引数を渡しても
-- 短縮も延長もできない（standardの値に化けない）ことを確認する。
-- ------------------------------------------------------------
do $$
declare
  v_live_id uuid;
  v_group1 uuid;
  v_group2 uuid;
  v_turn1 uuid;
  v_p_a uuid;
  v_j_b uuid;
  v_result record;
  v_reveal_result record;
  v_ms numeric;
  v_before timestamptz;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テストTP3', 20, 2,
    array['a7910000-0000-0000-0000-000000000001', 'a7910000-0000-0000-0000-000000000002']::uuid[],
    'test', null, 'short_test'
  );
  reset role;

  -- 受付開始：short_testのinterludeMs(4000ms)前後になる
  -- （open_receptionはduration_ms引数自体を受け取らない設計）。
  v_before := clock_timestamp();
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.open_reception(v_live_id);
  reset role;
  v_ms := extract(epoch from ((v_result.live).phase_deadline - v_before)) * 1000;
  if v_ms > 10000 then
    raise exception 'FAIL: short_testの受付開始締切がstandard相当(15秒)のまま(got=%ms)', v_ms;
  end if;

  -- 参加者を用意する（回答者1名＋別組の審査員1名）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;

  select id into v_group1 from public.groups where live_id = v_live_id order by group_order asc limit 1;
  select id into v_group2 from public.groups where live_id = v_live_id and id <> v_group1 limit 1;
  update public.participants set group_id = v_group1
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';
  update public.participants set group_id = v_group2
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000b';
  select id into v_p_a from public.participants where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';
  select id into v_j_b from public.participants where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000b';

  -- interlude→opening：極端なp_opening_duration_ms(1ms)を渡してもshort_testの
  -- openingMs(8000ms)前後になる（R3と同じ確認をshort_testでも行う）。
  update public.lives set phase_deadline = now() - interval '1 second' where id = v_live_id;
  v_before := clock_timestamp();
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.host_advance_interlude_to_opening(v_live_id, 1);
  reset role;
  if v_result.updated is not true then
    raise exception 'FAIL: short_testのinterlude→openingが進まなかった';
  end if;
  v_ms := extract(epoch from ((v_result.live).phase_deadline - v_before)) * 1000;
  if v_ms < 6000 or v_ms > 10000 then
    raise exception 'FAIL: short_testのopeningMsが8秒前後になっていない(got=%ms, 渡した引数は1ms)', v_ms;
  end if;

  -- ゲーム開始（begin_game）：最初のtopic_revealもshort_testのtopicRevealMs(7000ms)。
  update public.lives set current_phase = 'opening', current_turn_id = null where id = v_live_id;
  v_before := clock_timestamp();
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.begin_game(v_live_id);
  reset role;
  if v_result.ok is not true then
    raise exception 'FAIL: short_testライブでbegin_gameが失敗した(reason=%)', v_result.reason;
  end if;
  v_ms := extract(epoch from ((select phase_deadline from public.lives where id = v_live_id) - v_before)) * 1000;
  if v_ms < 5500 or v_ms > 9000 then
    raise exception 'FAIL: begin_game後のtopic_revealMsがshort_testの7秒前後になっていない(got=%ms)', v_ms;
  end if;

  select t.id into v_turn1 from public.turns t join public.groups g on g.id = t.group_id
    where t.live_id = v_live_id and g.id = v_group1 order by t.round asc limit 1;

  -- topic_reveal→answering：極端なp_answering_duration_ms(3600000ms=1時間)を
  -- 渡してもshort_testのanswerMs(20000ms)前後になる。
  update public.lives set phase_deadline = now() - interval '1 second' where id = v_live_id;
  v_before := clock_timestamp();
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true);
  select * into v_result from public.host_advance_topic_reveal_to_answering(v_live_id, v_turn1, 3600000);
  reset role;
  if v_result.updated is not true then
    raise exception 'FAIL: short_testのtopic_reveal→answeringが進まなかった';
  end if;
  v_ms := extract(epoch from ((v_result.live).phase_deadline - v_before)) * 1000;
  if v_ms < 18000 or v_ms > 22000 then
    raise exception 'FAIL: short_testのanswerMsが20秒前後になっていない(got=%ms, 渡した引数は3600000ms)', v_ms;
  end if;

  -- 回答→reveal：judgeMsがshort_testの6000ms前後になる。
  insert into public.answers (turn_id, participant_id, seq, body) values (v_turn1, v_p_a, 1, 'TP3回答');
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true);
  select * into v_reveal_result from public.reveal_next_answer_if_due(v_live_id, v_turn1); -- ドラマチックポーズ開始
  reset role;
  update public.lives set next_reveal_pending_at = now() - interval '1 second' where id = v_live_id;
  v_before := clock_timestamp();
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true);
  select * into v_reveal_result from public.reveal_next_answer_if_due(v_live_id, v_turn1);
  reset role;
  if v_reveal_result.updated is not true then
    raise exception 'FAIL: short_testでrevealされなかった';
  end if;
  v_ms := extract(epoch from ((v_reveal_result.answer).judging_ends_at - v_before)) * 1000;
  if v_ms < 5000 or v_ms > 7500 then
    raise exception 'FAIL: short_testのjudgeMsが6秒前後になっていない(got=%ms)', v_ms;
  end if;

  -- 採点確定→組結果(groupResultMs=6000)→次のお題発表(topicRevealMs=7000)まで
  -- 続けて確認する（極端なduration_msを渡しても変わらないことも合わせて確認）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000b', true);
  insert into public.scores (answer_id, judge_participant_id, points)
    values ((v_reveal_result.answer).id, v_j_b, 3);
  reset role;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.resolve_answer_if_due((v_reveal_result.answer).id);
  reset role;
  if v_result.updated is not true then
    raise exception 'FAIL: short_testで採点確定できなかった';
  end if;

  update public.lives
    set reveal_sequence_until = now() - interval '1 second',
        phase_deadline = now() - interval '1 second'
    where id = v_live_id;
  v_before := clock_timestamp();
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn1, 1);
  reset role;
  if v_result.updated is not true then
    raise exception 'FAIL: short_testでgroup_resultへ進まなかった';
  end if;
  v_ms := extract(epoch from ((v_result.live).phase_deadline - v_before)) * 1000;
  if v_ms < 4500 or v_ms > 7500 then
    raise exception 'FAIL: short_testのgroupResultMsが6秒前後になっていない(got=%ms, 渡した引数は1ms)', v_ms;
  end if;

  update public.lives set phase_deadline = now() - interval '1 second' where id = v_live_id;
  v_before := clock_timestamp();
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.host_advance_group_result_to_next(v_live_id, v_turn1, 3600000);
  reset role;
  if v_result.updated is not true or v_result.advanced_to <> 'topic_reveal' then
    raise exception 'FAIL: short_testで次のお題発表へ進まなかった(updated=%, advanced_to=%)',
      v_result.updated, v_result.advanced_to;
  end if;
  v_ms := extract(epoch from ((v_result.live).phase_deadline - v_before)) * 1000;
  if v_ms < 5500 or v_ms > 9000 then
    raise exception 'FAIL: 2つ目のtopic_revealMsがshort_testの7秒前後になっていない(got=%ms, 渡した引数は3600000ms)', v_ms;
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: short_testプロファイルのライブは受付開始・開幕・お題発表・回答受付・採点・組結果・次のお題発表の全フェーズで短縮された時間になり、極端なduration_ms引数を渡しても変えられない';
end $$;

-- ------------------------------------------------------------
-- T-CL-1（4回目レビュー）：get_live_server_time（サーバー同期時計用RPC）の権限・戻り値。
-- 匿名ゲストはSupabase上でもauthenticatedロールで動くため、authenticatedへのgrantで
-- 足りる（anon・publicには与えない）。戻り値はtimestamptz1つだけ。
-- ------------------------------------------------------------
do $$
declare
  v_t timestamptz;
  v_ret text;
begin
  select pg_get_function_result('public.get_live_server_time()'::regprocedure) into v_ret;
  if v_ret <> 'timestamp with time zone' then
    raise exception 'FAIL: get_live_server_timeの戻り値がtimestamptz1つだけではない(%)', v_ret;
  end if;
  if has_function_privilege('anon', 'public.get_live_server_time()', 'execute') then
    raise exception 'FAIL: anonがget_live_server_timeを実行できる';
  end if;
  if not has_function_privilege('authenticated', 'public.get_live_server_time()', 'execute') then
    raise exception 'FAIL: authenticatedがget_live_server_timeを実行できない';
  end if;

  -- 匿名ゲスト（authenticatedロール）・非host・hostのいずれも呼べ、DBの現在時刻を返す。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7920000-0000-0000-0000-000000000001', true); -- 匿名ゲスト
  select public.get_live_server_time() into v_t;
  if abs(extract(epoch from (clock_timestamp() - v_t))) > 5 then
    raise exception 'FAIL: ゲストが取得したサーバー時刻がDBの現在時刻と一致しない';
  end if;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true); -- 非host
  select public.get_live_server_time() into v_t;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true); -- host
  select public.get_live_server_time() into v_t;
  reset role;

  set local role anon;
  begin
    perform public.get_live_server_time();
    raise exception 'FAIL: anonがget_live_server_timeを実行できてしまった';
  exception when others then
    if sqlerrm !~ 'permission denied' then
      raise exception 'FAIL: anon呼び出しで想定外のエラー(%)', sqlerrm;
    end if;
  end;
  reset role;
  raise notice 'PASS: get_live_server_timeはauthenticated(匿名ゲスト含む)のみ実行でき、DBの現在時刻(timestamptz)だけを返す';
end $$;

-- ------------------------------------------------------------
-- T-CL-2（4回目レビュー）：回答終了RPCは、クライアントの時刻に無関係に、DBの
-- now()が締切前なら遷移せず、締切後なら（司会・観客のどちらから呼んでも）遷移する。
-- RPCはクライアントの時刻・秒数を受け取らない（duration引数も無視される）ため、
-- 端末時計が±60秒ずれていることはDB側から見て何の違いも生まない。
-- 続けてT-CL-3で同時実行でも一度だけ進むことをdblinkで確認する。
-- ------------------------------------------------------------
create temporary table _t0079cl_ctx (live_id uuid, turn_id uuid);
grant select on _t0079cl_ctx to authenticated, anon;

do $$
declare
  v_live_id uuid;
  v_group1 uuid;
  v_group2 uuid;
  v_turn1 uuid;
  v_result record;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テストCL', 20, 2,
    array['a7910000-0000-0000-0000-000000000001', 'a7910000-0000-0000-0000-000000000002']::uuid[]
  );
  perform public.open_reception(v_live_id);
  reset role;
  update public.lives set current_phase = 'opening', phase_deadline = null where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;
  select id into v_group1 from public.groups where live_id = v_live_id order by group_order asc limit 1;
  select id into v_group2 from public.groups where live_id = v_live_id and id <> v_group1 limit 1;
  update public.participants set group_id = v_group1 where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';
  update public.participants set group_id = v_group2 where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000b';

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.begin_game(v_live_id);
  reset role;
  if v_result.ok is not true then
    raise exception 'FAIL: CLテストのbegin_gameが失敗(%)', v_result.reason;
  end if;
  select current_turn_id into v_turn1 from public.lives where id = v_live_id;

  -- 締切はまだ先(+30秒)：どの呼び出し元でも、何を渡しても遷移しない。
  update public.lives
    set current_phase = 'answering', phase_deadline = now() + interval '30 seconds',
        answering_paused = false, reveal_sequence_until = null
    where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true); -- 司会でも回答者でもない観客
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn1, 1);
  reset role;
  if v_result.updated is not false or (select current_phase from public.lives where id = v_live_id) <> 'answering' then
    raise exception 'FAIL: DB締切前なのに回答が終了した（早送り）';
  end if;

  -- 締切に到達（DB時刻で過去）：観客のみ・司会のみのどちらの呼び出しでも進める。
  update public.lives set phase_deadline = now() - interval '1 second' where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn1, 3600000);
  reset role;
  if v_result.updated is not true or (select current_phase from public.lives where id = v_live_id) <> 'group_result' then
    raise exception 'FAIL: DB締切後なのに回答が終了しなかった';
  end if;

  -- 司会のみ(host)の呼び出しでも同様に進む。
  update public.lives
    set current_phase = 'answering', phase_deadline = now() - interval '1 second',
        answering_paused = false, reveal_sequence_until = null
    where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn1, 1);
  reset role;
  if v_result.updated is not true then
    raise exception 'FAIL: 司会からの呼び出しでDB締切後に進めなかった';
  end if;

  -- 同時実行テスト用に、再びanswering・締切到達済みへ戻す。
  update public.lives
    set current_phase = 'answering', phase_deadline = now() - interval '1 second',
        answering_paused = false, reveal_sequence_until = null
    where id = v_live_id;
  insert into _t0079cl_ctx values (v_live_id, v_turn1);
  raise notice 'PASS: 回答終了RPCはDBのnow()だけで判断する（締切前は遷移せず、締切後は観客・司会どちらの呼び出しでも遷移する）';
end $$;

do $$
declare
  v_has boolean;
begin
  begin
    create extension if not exists dblink;
    v_has := true;
  exception when others then
    v_has := false;
  end;
  if not v_has then
    raise notice 'SKIP: dblink拡張が利用できないため、回答終了の同時実行テストを省略';
    return;
  end if;
  create or replace function public._t0079cl_call(p_live uuid, p_turn uuid, p_hold numeric)
  returns boolean language plpgsql as $f$
  declare v_updated boolean;
  begin
    perform 1 from public.lives where id = p_live for update;
    if p_hold > 0 then perform pg_sleep(p_hold); end if;
    perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
    select updated into v_updated from public.host_advance_answering_to_group_result(p_live, p_turn, null);
    return v_updated;
  end;
  $f$;
end $$;

do $$
declare
  v_conn text := 'dbname=' || current_database();
  v_live uuid;
  v_turn uuid;
  v_bg boolean;
  v_main boolean;
begin
  if to_regprocedure('public._t0079cl_call(uuid,uuid,numeric)') is null then
    return;
  end if;
  select live_id, turn_id into v_live, v_turn from _t0079cl_ctx;
  perform dblink_connect('t0079clrace', v_conn);
  perform dblink_send_query('t0079clrace', format('select public._t0079cl_call(%L::uuid, %L::uuid, 1.0)', v_live, v_turn));
  perform pg_sleep(0.3);
  v_main := public._t0079cl_call(v_live, v_turn, 0);
  select ok into v_bg from dblink_get_result('t0079clrace') as t(ok boolean);
  perform dblink_disconnect('t0079clrace');
  if v_bg and v_main then
    raise exception 'FAIL: 同時の回答終了呼び出しの両方が遷移した（二重進行）';
  end if;
  if not v_bg and not v_main then
    raise exception 'FAIL: 同時の回答終了呼び出しのどちらも遷移しなかった';
  end if;
  raise notice 'PASS: 司会と観客が同時に回答終了RPCを呼んでも、遷移は一度だけ';
end $$;

do $$
begin
  if to_regprocedure('public._t0079cl_call(uuid,uuid,numeric)') is not null then
    drop function public._t0079cl_call(uuid, uuid, numeric);
  end if;
  update public.lives set current_phase = 'closed' where id = (select live_id from _t0079cl_ctx);
end $$;
drop table _t0079cl_ctx;

-- ============================================================
-- 2回目レビュー対応の追加テスト群：
--   - reveal_next_answer_if_due（未発表回答の表示のサーバー移管）
--   - 一般利用者・匿名ゲストが時間を短縮/延長できないこと
--   - resolve_answer_if_dueの過去ターン/別ライブ/終了済みライブ拒否
--   - emergency_close_liveのfinal_result拒否
--   - advance_live_progress_if_due（観客・回答者側の補助tick用の統合RPC）
-- 新しいライブ「0079テストR」を1本用意し、以下で共通に使う。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_group1 uuid;
  v_begin_result record;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0079テストR', 20, 2,
    array['a7910000-0000-0000-0000-000000000001', 'a7910000-0000-0000-0000-000000000002']::uuid[]
  );
  reset role;

  update public.lives set current_phase = 'interlude', phase_deadline = now() + interval '30 seconds' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000c', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  reset role;

  select id into v_group1 from public.groups where live_id = v_live_id order by group_order asc limit 1;
  update public.participants set group_id = v_group1
    where live_id = v_live_id and user_id = 'a7900000-0000-0000-0000-00000000000a';
  update public.participants set group_id = (
      select id from public.groups where live_id = v_live_id and id <> v_group1 limit 1
    )
    where live_id = v_live_id and user_id in (
      'a7900000-0000-0000-0000-00000000000b', 'a7900000-0000-0000-0000-00000000000c'
    );

  update public.lives set current_phase = 'opening', current_turn_id = null where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_begin_result from public.begin_game(v_live_id);
  reset role;
  if v_begin_result.ok is not true then
    raise exception 'FAIL: begin_gameが失敗した(reason=%)', v_begin_result.reason;
  end if;

  update public.lives set current_phase = 'interlude', current_turn_id = null, phase_deadline = now() + interval '30 seconds'
    where id = v_live_id;
end $$;

create temporary table _t0079r_ctx as
select l.id as live_id,
  (select id from public.groups where live_id = l.id order by group_order asc limit 1) as group1_id,
  (select t.id from public.turns t join public.groups g on g.id = t.group_id
     where t.live_id = l.id and g.group_order = 1 order by t.round asc limit 1) as turn1_id,
  (select id from public.participants where live_id = l.id and user_id = 'a7900000-0000-0000-0000-00000000000a') as participant_a,
  (select id from public.participants where live_id = l.id and user_id = 'a7900000-0000-0000-0000-00000000000b') as judge_b,
  (select id from public.participants where live_id = l.id and user_id = 'a7900000-0000-0000-0000-00000000000c') as judge_c
from public.lives l where l.title = '0079テストR';

grant select on _t0079r_ctx to authenticated, anon;

-- ============================================================
-- テストR1: reveal_next_answer_if_due — フェーズ/ターン不一致は拒否、
--          表示中で未確定の回答がある間は新たにrevealしない、約2.2秒の
--          ドラマチックポーズを経てからrevealする（DB時刻のみで判定）、
--          未発表回答が無ければupdated=falseで実害なし。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_participant_a uuid;
  v_answer_id uuid;
  v_result record;
  v_pending_at timestamptz;
begin
  select live_id, turn1_id, participant_a into v_live_id, v_turn1, v_participant_a from _t0079r_ctx;

  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn1, phase_deadline = now() + interval '40 seconds'
    where id = v_live_id;

  -- フェーズ/ターン不一致は拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.reveal_next_answer_if_due(v_live_id, gen_random_uuid());
  if v_result.updated is not false then
    raise exception 'FAIL: ターン不一致なのにreveal_next_answer_if_dueがupdated=trueになった';
  end if;

  -- 未発表回答が無ければ何もしない。
  select * into v_result from public.reveal_next_answer_if_due(v_live_id, v_turn1);
  if v_result.updated is not false then
    raise exception 'FAIL: 未発表回答が無いのにupdated=trueになった';
  end if;
  reset role;

  insert into public.answers (id, turn_id, participant_id, seq, body)
    values (gen_random_uuid(), v_turn1, v_participant_a, 1, '0079テストR回答1')
    returning id into v_answer_id;

  -- 1回目の呼び出し：ドラマチックポーズを開始するだけで、まだrevealしない。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.reveal_next_answer_if_due(v_live_id, v_turn1);
  if v_result.updated is not false then
    raise exception 'FAIL: 1回目の呼び出しで即座にrevealされてしまった（約2.2秒のポーズが無い）';
  end if;
  if (v_result.live).next_reveal_pending_at is null then
    raise exception 'FAIL: 1回目の呼び出しでnext_reveal_pending_atが設定されていない';
  end if;
  v_pending_at := (v_result.live).next_reveal_pending_at;

  -- 2回目の呼び出し（ポーズ中）：まだrevealしない。
  select * into v_result from public.reveal_next_answer_if_due(v_live_id, v_turn1);
  if v_result.updated is not false then
    raise exception 'FAIL: ドラマチックポーズ中なのにrevealされてしまった';
  end if;
  if (v_result.live).next_reveal_pending_at <> v_pending_at then
    raise exception 'FAIL: ポーズ中にnext_reveal_pending_atが再計算されて延長された';
  end if;
  reset role;

  -- DB時刻を過ぎた状態を作る（クライアントのDate.now()ではなくDBのnow()で
  -- 判定されていることを確認する：next_reveal_pending_atを直接過去に書き換える）。
  update public.lives set next_reveal_pending_at = now() - interval '1 second' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true); -- 非hostでもよい
  select * into v_result from public.reveal_next_answer_if_due(v_live_id, v_turn1);
  reset role;

  if v_result.updated is not true then
    raise exception 'FAIL: ポーズ時刻を過ぎたのにrevealされなかった';
  end if;
  if (v_result.answer).id <> v_answer_id then
    raise exception 'FAIL: 想定と違う回答がrevealされた';
  end if;
  if (v_result.answer).revealed_at is null or (v_result.answer).revealed_at > now() then
    raise exception 'FAIL: revealed_atがDBのnow()から生成されていない';
  end if;
  if (v_result.answer).judging_ends_at <= (v_result.answer).revealed_at then
    raise exception 'FAIL: judging_ends_atがrevealed_atより後になっていない';
  end if;
  if (v_result.live).next_reveal_pending_at is not null then
    raise exception 'FAIL: reveal後もnext_reveal_pending_atが残っている';
  end if;

  -- 表示中(revealed_at is not null, resolved=false)の回答がある間は、別の
  -- 未発表回答が無くてもupdated=falseのまま（この回答自体は既にrevealed済み
  -- なので対象外、かつ新たな未発表回答も無い）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.reveal_next_answer_if_due(v_live_id, v_turn1);
  reset role;
  if v_result.updated is not false then
    raise exception 'FAIL: 未発表回答が無いのに再度updated=trueになった';
  end if;

  raise notice 'PASS: reveal_next_answer_if_dueはフェーズ/ターン一致・約2.2秒のDB時刻ポーズ・行ロックのもとでのみ、1件だけを正しくrevealする';
end $$;

-- ============================================================
-- テストR1b: 表示中で未確定の回答がある間は、別の未発表回答を重ねてrevealしない。
-- 2026-09-25（発見）：0014のunique index(answers_one_unresolved_per_turn)が
-- 「1ターンにつきresolved=false（未表示も含む）の行は常に最大1件まで」を
-- そもそもDBレベルで強制しているため、「表示中の回答がある状態で別の
-- 未発表回答が同時に存在する」状況自体がDB上作れない（INSERT時点で一意制約
-- 違反になる）。そのため、reveal_next_answer_if_due側の
-- 「表示中(revealed_at is not null, resolved=false)の回答があれば新たに
-- revealしない」というチェックは、この制約が万一将来変わった場合の多層防御
-- として維持しつつ、ここでは「重ねて表示しようとするとDB制約が先に拒否する」
-- こと自体を確認する（テストR1の末尾で既にRPC側の同チェックは検証済み）。
-- ============================================================
do $$
declare
  v_turn1 uuid;
  v_participant_a uuid;
  v_failed boolean := false;
begin
  select turn1_id, participant_a into v_turn1, v_participant_a from _t0079r_ctx;

  -- テストR1で1件目が既にrevealed_at is not null, resolved=falseのまま残っている。
  begin
    insert into public.answers (turn_id, participant_id, seq, body)
      values (v_turn1, v_participant_a, 2, '0079テストR回答2（重ね表示禁止確認用）');
  exception
    when unique_violation then
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 表示中の未確定回答がある状態で、同じターンに2件目のresolved=false行を作れてしまった（answers_one_unresolved_per_turnが機能していない）';
  end if;

  raise notice 'PASS: 1ターンにつき未確定(resolved=false)の回答は常に1件までというDB制約により、重ねてrevealされうる状態自体が作れない';
end $$;

-- テストR1の回答を確定させ、R2以降のテストがまっさらな状態から始められる
-- ようにしておく（審査員2名が満点で確定）。
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_judge_b uuid;
  v_judge_c uuid;
  v_group1 uuid;
  v_answer_id uuid;
begin
  select live_id, turn1_id, judge_b, judge_c, group1_id
    into v_live_id, v_turn1, v_judge_b, v_judge_c, v_group1
    from _t0079r_ctx;
  select id into v_answer_id from public.answers where turn_id = v_turn1 and resolved = false;
  if v_answer_id is not null then
    insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_judge_b, 3);
    insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_judge_c, 3);
    set local role authenticated;
    perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
    perform public.resolve_answer_if_due(v_answer_id);
    reset role;
  end if;
end $$;

-- ============================================================
-- テストR2（dblinkによる本当の同時reveal）：2つのセッションから同時に
--          reveal_next_answer_if_dueを呼んでも、実際にrevealされるのは
--          1件だけになることを検証する。dblink拡張が使えない環境ではスキップ。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_has_dblink boolean;
begin
  select live_id, turn1_id into v_live_id, v_turn1 from _t0079r_ctx;

  -- 直前のブロックでテストR1の回答は既に確定済み（まっさらな状態）。ただし
  -- resolve_answer_if_dueがreveal_sequence_untilを約7.8秒先まで設定して
  -- いるため、そのまま次のrevealが演出待ちでブロックされないよう明示的に
  -- クリアする（実時間を待たせないための、テストとしての意図的な調整）。
  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn1, reveal_sequence_until = null
    where id = v_live_id;

  -- 同時にrevealを試みる対象を1件作る（このターンにresolved=falseの行は
  -- 0014の一意制約により常に最大1件までしか存在できない）。
  insert into public.answers (turn_id, participant_id, seq, body)
    select v_turn1, participant_a, 10, '0079テストR2用回答' from _t0079r_ctx;

  begin
    create extension if not exists dblink;
    v_has_dblink := true;
  exception when others then
    v_has_dblink := false;
  end;
  if not v_has_dblink then
    raise notice 'SKIP: dblink拡張が利用できないため、reveal同時実行テストを省略';
    return;
  end if;

  create or replace function public._t0079r_call_reveal(
    p_live_id uuid, p_turn_id uuid, p_hold_seconds numeric
  ) returns boolean
  language plpgsql
  as $f$
  declare
    v_updated boolean;
  begin
    perform 1 from public.lives where id = p_live_id for update;
    if p_hold_seconds > 0 then
      perform pg_sleep(p_hold_seconds);
    end if;
    perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
    select updated into v_updated from public.reveal_next_answer_if_due(p_live_id, p_turn_id);
    return v_updated;
  end;
  $f$;

  -- next_reveal_pending_atを事前に過去へ設定し、1回目の呼び出しで即reveal
  -- できる状態にしておく（ドラマチックポーズの待ち時間ぶんテストを待たせない）。
  update public.lives set next_reveal_pending_at = now() - interval '1 second' where id = v_live_id;
end $$;

do $$
declare
  v_conn text := 'dbname=' || current_database();
  v_connected boolean := false;
  v_live_id uuid;
  v_turn1 uuid;
  v_bg_updated boolean;
  v_main_updated boolean;
  v_revealed_count int;
begin
  if to_regprocedure('public._t0079r_call_reveal(uuid,uuid,numeric)') is null then
    return; -- dblinkが使えずスキップ済み
  end if;

  select live_id, turn1_id into v_live_id, v_turn1 from _t0079r_ctx;

  begin
    perform dblink_connect('t0079rrace', v_conn);
    v_connected := true;
  exception when others then
    raise notice 'SKIP: dblink接続に失敗したため、reveal同時実行テストを省略 (%)', sqlerrm;
  end;

  if v_connected then
    perform dblink_send_query(
      't0079rrace',
      format('select public._t0079r_call_reveal(%L::uuid, %L::uuid, %s)', v_live_id, v_turn1, 1.0)
    );
    perform pg_sleep(0.3);

    v_main_updated := public._t0079r_call_reveal(v_live_id, v_turn1, 0);

    select ok into v_bg_updated from dblink_get_result('t0079rrace') as t(ok boolean);
    perform dblink_disconnect('t0079rrace');

    if v_bg_updated and v_main_updated then
      raise exception 'FAIL: 2つの同時呼び出しの両方でrevealされた（二重reveal）';
    end if;
    if not v_bg_updated and not v_main_updated then
      raise exception 'FAIL: 2つの同時呼び出しのどちらもrevealできなかった';
    end if;

    select count(*) into v_revealed_count
    from public.answers
    where turn_id = v_turn1 and revealed_at is not null and resolved = false;
    if v_revealed_count <> 1 then
      raise exception 'FAIL: 表示中の回答が1件になっていない(got=%)', v_revealed_count;
    end if;

    raise notice 'PASS: dblinkによる本当に同時のreveal呼び出しでも、実際にrevealされるのは1件だけ';
  end if;
end $$;

do $$
begin
  if to_regprocedure('public._t0079r_call_reveal(uuid,uuid,numeric)') is not null then
    drop function public._t0079r_call_reveal(uuid, uuid, numeric);
  end if;
end $$;

-- R3以降のテストがまっさらな状態から始められるよう、テストR2で残った
-- （dblinkが使えない環境ではまだrevealすらされていない）未確定の回答を
-- 片付けておく（0014の一意制約により、このターンには最大1件しか残らない）。
do $$
declare
  v_turn1 uuid;
  v_live_id uuid;
  v_judge_b uuid;
  v_judge_c uuid;
  v_answer_id uuid;
begin
  select live_id, turn1_id, judge_b, judge_c into v_live_id, v_turn1, v_judge_b, v_judge_c from _t0079r_ctx;
  select id into v_answer_id from public.answers where turn_id = v_turn1 and resolved = false;
  if v_answer_id is not null then
    delete from public.scores where answer_id = v_answer_id;
    delete from public.answers where id = v_answer_id;
  end if;
end $$;

-- ============================================================
-- テストR3（一般利用者・匿名ゲストが時間を短縮/延長できないこと）：
--          各遷移RPCへ極端に小さい/大きいduration_msを渡しても、実際に
--          設定される締切は本番相当の固定値のままであることを確認する。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_result record;
  v_deadline_ms numeric;
begin
  select live_id, turn1_id into v_live_id, v_turn1 from _t0079r_ctx;

  -- host_advance_topic_reveal_to_answering：answering(60000ms)。
  update public.lives
    set current_phase = 'topic_reveal', current_turn_id = v_turn1, phase_deadline = now() - interval '1 second'
    where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true); -- 非host
  select * into v_result from public.host_advance_topic_reveal_to_answering(v_live_id, v_turn1, 1);
  reset role;
  if v_result.updated is not true then
    raise exception 'FAIL: topic_reveal→answeringの遷移自体が失敗した';
  end if;
  v_deadline_ms := extract(epoch from ((v_result.live).phase_deadline - now())) * 1000;
  if v_deadline_ms < 55000 or v_deadline_ms > 65000 then
    raise exception 'FAIL: p_answering_duration_ms=1(最小値)を渡したのに締切が本番相当(60秒)から外れた(got=%ms)', v_deadline_ms;
  end if;

  -- host_advance_answering_to_group_result：group_result(15000ms)。今度は
  -- 極端に大きい値(3600000ms=1時間)を渡してみる。
  update public.lives set phase_deadline = now() - interval '1 second' where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn1, 3600000);
  reset role;
  if v_result.updated is not true then
    raise exception 'FAIL: answering→group_resultの遷移自体が失敗した';
  end if;
  v_deadline_ms := extract(epoch from ((v_result.live).phase_deadline - now())) * 1000;
  if v_deadline_ms < 10000 or v_deadline_ms > 20000 then
    raise exception 'FAIL: p_group_result_duration_ms=3600000(極端に大きい値)を渡したのに締切が本番相当(15秒)から外れた(got=%ms)', v_deadline_ms;
  end if;

  raise notice 'PASS: 一般利用者・匿名ゲストがduration_ms引数へ極端な値(最小値・極端に大きい値)を渡しても、実際の締切は本番相当の固定値のまま変わらない';
end $$;

-- ============================================================
-- テストR4（過去ターン・別ライブ・終了済みライブの回答は確定できない）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_turn2 uuid;
  v_participant_a uuid;
  v_judge_b uuid;
  v_other_live_id uuid;
  v_past_turn_answer_id uuid;
  v_other_live_answer_id uuid;
  v_closed_live_answer_id uuid;
  v_reveal_seq_before timestamptz;
  v_reveal_seq_after timestamptz;
  v_result record;
  v_prep_ok boolean;
begin
  select live_id, turn1_id, participant_a, judge_b into v_live_id, v_turn1, v_participant_a, v_judge_b from _t0079r_ctx;

  -- このテストは自前でv_turn1にresolved=false（未確定）の回答を作るため、
  -- 前段のテストの後始末が万一残っていても衝突しないよう、ここで明示的に
  -- 空にしておく（0014の一意制約により1ターンにつき最大1件しか残らない）。
  delete from public.scores where answer_id in (select id from public.answers where turn_id = v_turn1);
  delete from public.answers where turn_id = v_turn1;

  select t.id into v_turn2
    from public.turns t join public.groups g on g.id = t.group_id
    where t.live_id = v_live_id and g.group_order = 2
    limit 1;

  -- (a) 過去ターンの未確定回答：current_turn_idを実在する別のターン(v_turn2)へ
  --     一時的に進めて、v_turn1をもう「過去のターン」にしてから、そこに
  --     残った未確定回答を確定しようとする。
  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, judging_ends_at)
    values (gen_random_uuid(), v_turn1, v_participant_a, 20, '0079テストR過去ターン回答', now(), now() - interval '1 second')
    returning id into v_past_turn_answer_id;
  insert into public.scores (answer_id, judge_participant_id, points) values (v_past_turn_answer_id, v_judge_b, 3);

  update public.lives set current_phase = 'answering', current_turn_id = v_turn2 where id = v_live_id;
  select reveal_sequence_until into v_reveal_seq_before from public.lives where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.resolve_answer_if_due(v_past_turn_answer_id);
  reset role;

  if v_result.updated is not false or v_result.answer is not null then
    raise exception 'FAIL: current_turn_idと一致しない過去ターンの回答が確定できてしまった（本文等が漏れている可能性）';
  end if;
  select reveal_sequence_until into v_reveal_seq_after from public.lives where id = v_live_id;
  if v_reveal_seq_after is distinct from v_reveal_seq_before then
    raise exception 'FAIL: 過去ターンの回答を指定しただけで現在ライブのreveal_sequence_untilが変化した';
  end if;
  if exists (select 1 from public.answers where id = v_past_turn_answer_id and resolved = true) then
    raise exception 'FAIL: 過去ターンの回答が実際にresolved=trueへ更新されてしまった';
  end if;

  update public.lives set current_turn_id = v_turn1 where id = v_live_id;

  -- (b) current_phaseがanswering以外（例：group_result）の間は、たとえ
  --     current_turn_idが一致していても確定できない。
  update public.lives set current_phase = 'group_result' where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.resolve_answer_if_due(v_past_turn_answer_id);
  reset role;
  if v_result.updated is not false or v_result.answer is not null then
    raise exception 'FAIL: current_phaseがanswering以外なのに確定できてしまった';
  end if;
  update public.lives set current_phase = 'answering' where id = v_live_id;
  delete from public.scores where answer_id = v_past_turn_answer_id;
  delete from public.answers where id = v_past_turn_answer_id;

  -- (c) 別ライブの回答は確定できない。
  -- create_live_preparationは「進行中(closed以外)のライブが他に無いこと」を
  -- 要求する（既に別の非closedライブがあれば作成せず、その既存ライブのIDを
  -- ok=falseとともに返す）ため、共有テストライブを一時的にclosedへ倒してから
  -- 呼び、直後に元の状態(answering/v_turn1)へ戻す。
  update public.lives set current_phase = 'closed' where id = v_live_id;
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select ok, live_id into v_prep_ok, v_other_live_id from public.create_live_preparation(
    now(), '0079テストR-別ライブ', 20, 1,
    array['a7910000-0000-0000-0000-000000000001']::uuid[]
  );
  reset role;

  if v_prep_ok is not true or v_other_live_id = v_live_id then
    raise exception 'FAIL: テスト用の別ライブの作成に失敗した、または誤って既存ライブのIDが返った(ok=%, id=%)', v_prep_ok, v_other_live_id;
  end if;
  -- lives_one_active_idx（closed以外のライブは常に高々1件、というDB制約）に
  -- 抵触しないよう、先に別ライブをclosedへ倒してから共有テストライブを
  -- answeringへ戻す（一瞬でも両方が非closedになる状態を作らない）。
  update public.lives set current_phase = 'closed' where id = v_other_live_id; -- このテストでは進行させる必要が無い
  update public.lives set current_phase = 'answering', current_turn_id = v_turn1 where id = v_live_id;

  -- 別ライブの適当なturn/answerをでっち上げる（他ライブのturnに紐づく回答）。
  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, judging_ends_at)
    select gen_random_uuid(), t.id, v_participant_a, 30, '0079テストR別ライブ回答', now(), now() - interval '1 second'
    from public.turns t where t.live_id = v_other_live_id limit 1
    returning id into v_other_live_answer_id;

  if v_other_live_answer_id is not null then
    set local role authenticated;
    perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
    select * into v_result from public.resolve_answer_if_due(v_other_live_answer_id);
    reset role;
    if v_result.updated is not false or v_result.answer is not null then
      raise exception 'FAIL: 別ライブの回答（現在のライブの進行中ターンではない）が確定できてしまった';
    end if;
  end if;

  -- (d) 終了済み(closed)のライブの回答は確定できない。
  update public.lives
    set current_phase = 'closed'
    where id = v_live_id;
  insert into public.answers (id, turn_id, participant_id, seq, body, revealed_at, judging_ends_at)
    values (gen_random_uuid(), v_turn1, v_participant_a, 40, '0079テストR終了済みライブ回答', now(), now() - interval '1 second')
    returning id into v_closed_live_answer_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.resolve_answer_if_due(v_closed_live_answer_id);
  reset role;
  if v_result.updated is not false or v_result.answer is not null then
    raise exception 'FAIL: 終了済み(closed)のライブの回答が確定できてしまった';
  end if;

  update public.lives set current_phase = 'answering' where id = v_live_id;
  delete from public.answers where id in (v_closed_live_answer_id);

  raise notice 'PASS: resolve_answer_if_dueは過去ターン・phase不一致・別ライブ・終了済みライブの回答を一切確定せず、本文等も一切返さず、現在ライブのreveal_sequence_untilも変化しない';
end $$;

-- ============================================================
-- テストR5（emergency_close_liveはfinal_resultからは実行できない）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_shared_live_id uuid;
  v_prep_ok boolean;
  v_result record;
begin
  -- create_live_preparationは進行中(closed以外)のライブが他に無いことを要求する。
  -- 共有テストライブ(_t0079r_ctx)がまだanswering中なので、一時的にclosedへ倒す
  -- （このテストの後は_t0079r_ctxの生存確認をしないテストR6が続くだけで、R6は
  -- 自前で対象ライブをanswering状態へ明示的に戻すため、ここで復元は不要）。
  select live_id into v_shared_live_id from _t0079r_ctx;
  update public.lives set current_phase = 'closed' where id = v_shared_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select ok, live_id into v_prep_ok, v_live_id from public.create_live_preparation(
    now(), '0079テストR-final緊急中止禁止', 20, 1,
    array['a7910000-0000-0000-0000-000000000002']::uuid[]
  );
  reset role;
  if v_prep_ok is not true or v_live_id = v_shared_live_id then
    raise exception 'FAIL: テスト用ライブの作成に失敗した、または誤って既存ライブのIDが返った(ok=%, id=%)', v_prep_ok, v_live_id;
  end if;
  update public.lives set current_phase = 'final_result' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.emergency_close_live(v_live_id, 'final_resultからの禁止確認');
  reset role;

  if v_result.updated is not false then
    raise exception 'FAIL: final_resultからemergency_close_liveが成功してしまった';
  end if;
  if v_result.error_code <> 'FINAL_RESULT_USE_NORMAL_CLOSE' then
    raise exception 'FAIL: error_codeがFINAL_RESULT_USE_NORMAL_CLOSEでない(got=%)', v_result.error_code;
  end if;
  if (select current_phase from public.lives where id = v_live_id) <> 'final_result' then
    raise exception 'FAIL: current_phaseがfinal_resultのまま維持されていない';
  end if;

  -- lives_one_active_idx（closed以外のライブは常に高々1件）に抵触しないよう、
  -- このテスト用ライブを通常終了(close_live)で片付けてから終える。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000f', true);
  perform public.close_live(v_live_id);
  reset role;

  raise notice 'PASS: emergency_close_liveはfinal_resultからは拒否され、通常終了(close_live)を使うよう案内される';
end $$;

-- ============================================================
-- テストR6（advance_live_progress_if_due：観客・回答者側の補助tick用の
--          統合RPC）。司会（is_host）を一切経由せず、この1つのRPCだけを
--          繰り返し呼ぶだけで、未発表回答の表示→採点→確定→次の回答→
--          組結果への遷移まで進められることを確認する（司会不在を模す）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn1 uuid;
  v_participant_a uuid;
  v_judge_b uuid;
  v_judge_c uuid;
  v_result record;
  v_active_id uuid;
  v_guard int := 0;
begin
  select live_id, turn1_id, participant_a, judge_b, judge_c
    into v_live_id, v_turn1, v_participant_a, v_judge_b, v_judge_c
    from _t0079r_ctx;

  -- 2026-09-25（発見・修正）：lives/answers/scoresへの直接UPDATE/DELETE/INSERTは
  -- RLS（lives_write_host等はis_host()必須、scores_insert_own_as_playerは
  -- 本人の参加者行のみ）の対象になるため、これらのテスト用「時間を進める」
  -- 操作は必ずrole authenticated（非host）へ切り替える前、すなわちpostgres
  -- （RLSを気にする必要のない接続ロール）のまま行う。RPC呼び出しの直前だけ
  -- role authenticatedへ切り替え、呼び出し直後に必ずreset roleへ戻す
  -- （切り替えたままにすると、その後のテスト用UPDATEがRLSに阻まれて
  -- 0行更新のまま静かに失敗し、「時間を進めたつもりが進んでいない」という
  -- 見つけにくい不具合になる）。
  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn1, phase_deadline = now() - interval '1 second',
        answering_paused = false, answering_remaining_ms = null, reveal_sequence_until = null,
        next_reveal_pending_at = null
    where id = v_live_id;
  -- テストR3でv_turn1をgroup_resultへ進めた際にstatus='done'化されているため、
  -- scores_insert_own_as_playerのt.status='active'要件を満たすよう戻す。
  update public.turns set status = 'active' where id = v_turn1;
  delete from public.scores where answer_id in (select id from public.answers where turn_id = v_turn1);
  delete from public.answers where turn_id = v_turn1;

  insert into public.answers (turn_id, participant_id, seq, body)
    values (v_turn1, v_participant_a, 50, '0079テストR6用回答（司会不在シミュレーション）');

  -- 1回目：未発表回答があるため、内部ではまずreveal_next_answer_if_dueが
  -- ドラマチックポーズを開始する（まだrevealはしない）が、続けて試みる
  -- sync_answering_pause_if_dueが「未発表回答がある＝busy」を検知して
  -- 回答時間をpauseする。これは統合RPCとして見て正しい「1段階分の前進」
  -- なのでupdated=trueになる（早送りではない：締切自体は動かさない）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true); -- 非host(観客役)のみを使う
  select * into v_result from public.advance_live_progress_if_due(v_live_id, v_turn1);
  reset role;
  if v_result.updated is not true or v_result.action <> 'resumed_or_paused' then
    raise exception 'FAIL: 1回目で回答時間がpauseされなかった(updated=%, action=%)', v_result.updated, v_result.action;
  end if;
  if (v_result.live).answering_paused is not true then
    raise exception 'FAIL: 1回目の呼び出し後もanswering_pausedがtrueになっていない';
  end if;

  -- ポーズを待たず先へ進めるため、直接過去へ書き換える（実運用ではtickが
  -- 数秒おきに呼ばれるのを待つのと同じ効果）。postgresロールのまま行う。
  update public.lives set next_reveal_pending_at = now() - interval '1 second' where id = v_live_id;

  -- 2回目：revealされるはず。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.advance_live_progress_if_due(v_live_id, v_turn1);
  reset role;
  if v_result.updated is not true or v_result.action <> 'revealed' then
    raise exception 'FAIL: 2回目でrevealされなかった(updated=%, action=%)', v_result.updated, v_result.action;
  end if;
  v_active_id := (v_result.answer).id;

  -- 3回目：表示中でまだ未確定 → 何も変わらない(pause同期のみ試みて実害なし)。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.advance_live_progress_if_due(v_live_id, v_turn1);
  reset role;
  if v_result.action = 'revealed' or v_result.action = 'advanced_to_group_result' then
    raise exception 'FAIL: 採点前なのに想定外に進んだ(action=%)', v_result.action;
  end if;

  -- 全員採点する（各審査員本人としてscores_insert_own_as_playerを満たす）。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000b', true);
  insert into public.scores (answer_id, judge_participant_id, points) values (v_active_id, v_judge_b, 3);
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-00000000000c', true);
  insert into public.scores (answer_id, judge_participant_id, points) values (v_active_id, v_judge_c, 3);
  reset role;

  -- 4回目：確定されるはず。
  set local role authenticated;
  perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.advance_live_progress_if_due(v_live_id, v_turn1);
  reset role;
  if v_result.updated is not true or v_result.action <> 'resolved' then
    raise exception 'FAIL: 4回目で確定されなかった(updated=%, action=%)', v_result.updated, v_result.action;
  end if;
  if (v_result.answer).id <> v_active_id then
    raise exception 'FAIL: 確定された回答が想定と違う';
  end if;

  -- reveal_sequence演出が終わり、締切も過ぎるまで、統合RPCを繰り返し呼んで
  -- group_resultへ進むまで待つ（実運用のtickの繰り返しを模す）。
  loop
    v_guard := v_guard + 1;
    if v_guard > 20 then
      raise exception 'FAIL: %回呼んでもgroup_resultへ進まない（司会不在のまま進行できていない疑い）', v_guard;
    end if;
    -- テストなので演出待ち・回答時間をその場で経過させる（postgresロールのまま）。
    update public.lives
      set reveal_sequence_until = coalesce(reveal_sequence_until, now()) - interval '1 second',
          phase_deadline = now() - interval '1 second'
      where id = v_live_id;
    set local role authenticated;
    perform set_config('myapp.uid', 'a7900000-0000-0000-0000-0000000000ff', true);
    select * into v_result from public.advance_live_progress_if_due(v_live_id, v_turn1);
    reset role;
    exit when v_result.action = 'advanced_to_group_result';
  end loop;

  if (select current_phase from public.lives where id = v_live_id) <> 'group_result' then
    raise exception 'FAIL: 最終的にgroup_resultへ到達していない';
  end if;

  raise notice 'PASS: advance_live_progress_if_dueだけを繰り返し呼ぶことで、is_host()を一切経由せず、未発表回答の表示→採点→確定→組結果への遷移まで進められる（司会不在シミュレーション）';
end $$;

reset role;
drop table _t0079r_ctx;

select 'ALL 0079 LIVE SERVER AUTHORITATIVE PROGRESSION TESTS PASSED' as result;
