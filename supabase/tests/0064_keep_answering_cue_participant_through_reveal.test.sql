-- 0064 回帰テスト：回答席の消灯防止
-- （answering_cues.pending_participant_idが採点確定まで同じ回答者を指し続けるか）。
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('f1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-00000000000b'),
  ('f1000000-0000-0000-0000-00000000000c'),
  ('f1000000-0000-0000-0000-00000000000d'),
  ('f1000000-0000-0000-0000-00000000000f') -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'f1000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('f2000000-0000-0000-0000-000000000001', '0064テスト用お題A', 'text', true),
  ('f2000000-0000-0000-0000-000000000002', '0064テスト用お題B', 'text', true)
on conflict do nothing;

-- ライブ準備〜開始（adminとして）。
do $$
declare
  v_live_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'f1000000-0000-0000-0000-00000000000f', true);

  select live_id into v_live_id from public.create_live_preparation(
    now(), '0064テスト', 20, 2,
    array['f2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002']::uuid[]
  );
  update public.lives set current_phase = 'opening' where id = v_live_id;

  perform set_config('myapp.uid', 'f1000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'f1000000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'f1000000-0000-0000-0000-00000000000c', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'f1000000-0000-0000-0000-00000000000d', true);
  perform public.join_live(v_live_id, 'player', null);

  perform set_config('myapp.uid', 'f1000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  perform public.begin_game(v_live_id);
end $$;

-- 現在activeな組に実際に所属するplayerを2人（回答者役・別参加者役）特定する
-- （0063テストの反省を踏まえ、固定ユーザー前提にせずランダム組分け結果から動的に特定する）。
create temporary table _t0064_ctx as
select
  l.id as live_id,
  active_t.id as active_turn_id,
  answerer_p.id as answerer_participant_id,
  answerer_p.user_id as answerer_user_id,
  other_p.id as other_participant_id
from public.lives l
join public.turns active_t on active_t.live_id = l.id and active_t.status = 'active'
join lateral (
  select p.id, p.user_id from public.participants p
  where p.live_id = l.id and p.group_id = active_t.group_id and p.role = 'player'
  order by p.joined_at asc, p.id asc
  limit 1
) answerer_p on true
join lateral (
  select p.id from public.participants p
  where p.live_id = l.id and p.group_id = active_t.group_id and p.role = 'player'
    and p.id <> answerer_p.id
  order by p.joined_at asc, p.id asc
  limit 1
) other_p on true
where l.title = '0064テスト';

grant select on _t0064_ctx to authenticated, anon;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from _t0064_ctx;
  if v_count <> 1 then
    raise exception 'FAIL: テスト前提のライブ・組分け結果が特定できなかった';
  end if;
end $$;

reset role;
-- begin_gameはcurrent_phaseを'topic_reveal'にするだけなので、回答を送信できる
-- ように'answering'まで進めておく（0063テストと同じ）。
update public.lives
  set current_phase = 'answering', phase_deadline = now() + interval '10 minutes', answering_paused = false
  where id = (select live_id from _t0064_ctx);

-- ============================================================
-- テスト1：送信時に回答席が点灯する（pending_participant_id=回答者, busy=true）。
--           revisionも増加する。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_answerer_id uuid;
  v_answerer_user_id uuid;
  v_row record;
  v_rev0 bigint;
begin
  select live_id, active_turn_id, answerer_participant_id, answerer_user_id
    into v_live_id, v_turn_id, v_answerer_id, v_answerer_user_id
    from _t0064_ctx;

  select revision into v_rev0 from public.answering_cues where live_id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_user_id::text, true);
  insert into public.answers (turn_id, participant_id, seq, body)
    values (v_turn_id, v_answerer_id, 1, '0064テスト回答1');

  reset role;
  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.pending_participant_id is distinct from v_answerer_id then
    raise exception 'FAIL: 送信直後にpending_participant_idが回答者になっていない(got=%)', v_row.pending_participant_id;
  end if;
  if v_row.busy is not true then
    raise exception 'FAIL: 送信直後にbusyがtrueになっていない';
  end if;
  if v_row.revision <= v_rev0 then
    raise exception 'FAIL: 送信直後にrevisionが増えていない(before=%, after=%)', v_rev0, v_row.revision;
  end if;

  raise notice 'PASS: 送信時に回答席が点灯する(pending_participant_id=回答者, busy=true)、revisionも増加する';
end $$;

-- ============================================================
-- テスト2（本migrationの核心）：reveal時（revealed_at設定、resolved=falseの
--           まま）も同じparticipant_idを維持し、busyもtrueのまま。revisionは
--           増えるが、pending_participant_idは一瞬もnullを経由しない。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_answerer_id uuid;
  v_answer_id uuid;
  v_row record;
  v_rev0 bigint;
begin
  select live_id, active_turn_id, answerer_participant_id into v_live_id, v_turn_id, v_answerer_id from _t0064_ctx;
  select id into v_answer_id from public.answers where turn_id = v_turn_id and resolved = false;

  select revision into v_rev0 from public.answering_cues where live_id = v_live_id;

  update public.answers set revealed_at = now(), judging_ends_at = now() + interval '5 minutes'
    where id = v_answer_id;

  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.pending_participant_id is distinct from v_answerer_id then
    raise exception 'FAIL: reveal直後にpending_participant_idが変わってしまった(got=%)', v_row.pending_participant_id;
  end if;
  if v_row.busy is not true then
    raise exception 'FAIL: reveal直後にbusyがfalseになってしまった（回答席が消灯してしまう）';
  end if;
  if v_row.revision <= v_rev0 then
    raise exception 'FAIL: revealのUPDATEでrevisionが増えていない(before=%, after=%)', v_rev0, v_row.revision;
  end if;

  raise notice 'PASS: reveal時も同じ回答者を指し続け、busy=trueのまま、revisionは増加する（回答席が消灯しない）';
end $$;

-- ============================================================
-- テスト3：resolve時（resolved=true）に初めてpending_participant_idが
--           nullになり、busyもfalseになる。revisionも増加する。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_answer_id uuid;
  v_row record;
  v_rev0 bigint;
begin
  select live_id, active_turn_id into v_live_id, v_turn_id from _t0064_ctx;
  select id into v_answer_id from public.answers where turn_id = v_turn_id and resolved = false;

  select revision into v_rev0 from public.answering_cues where live_id = v_live_id;

  update public.answers set resolved = true where id = v_answer_id;

  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.pending_participant_id is not null then
    raise exception 'FAIL: resolve後もpending_participant_idがnullになっていない(got=%)', v_row.pending_participant_id;
  end if;
  if v_row.busy is not false then
    raise exception 'FAIL: resolve後もbusyがfalseになっていない';
  end if;
  if v_row.revision <= v_rev0 then
    raise exception 'FAIL: resolveのUPDATEでrevisionが増えていない(before=%, after=%)', v_rev0, v_row.revision;
  end if;

  raise notice 'PASS: resolve時に初めてpending_participant_id=null・busy=falseになり、revisionも増加する';
end $$;

-- ============================================================
-- テスト4：一連の流れ（送信→reveal→resolve）を通して、別の参加者の
--           participant_idへ切り替わることが無い。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_other_id uuid;
  v_row record;
begin
  select live_id, other_participant_id into v_live_id, v_other_id from _t0064_ctx;
  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.pending_participant_id = v_other_id then
    raise exception 'FAIL: pending_participant_idが別の参加者に切り替わっている';
  end if;
  raise notice 'PASS: 一連の流れを通して、別の参加者のparticipant_idへは切り替わらない';
end $$;

-- ============================================================
-- テスト5（Realtime到着順の頑健性）：insertトリガー・updateトリガー相当の
--           再計算が重複・前後して呼ばれても、pending_participant_idが
--           一瞬でもnullを経由しない（2順目の回答で確認する。1順目は
--           テスト1〜3で既に確定済み＝現在null・busy=falseの状態）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_id uuid;
  v_other_id uuid;
  v_other_user_id uuid;
  v_answer_id uuid;
  v_row record;
begin
  select live_id, active_turn_id, other_participant_id into v_live_id, v_turn_id, v_other_id from _t0064_ctx;
  select user_id into v_other_user_id from public.participants where id = v_other_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_other_user_id::text, true);
  insert into public.answers (turn_id, participant_id, seq, body)
    values (v_turn_id, v_other_id, 2, '0064テスト回答2')
    returning id into v_answer_id;

  reset role;
  -- insertトリガー発火後、さらに重複してrecomputeを呼んでも変化しない（冪等）。
  perform public.recompute_answering_cue_for_turn(v_turn_id);
  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.pending_participant_id is distinct from v_other_id then
    raise exception 'FAIL: 2順目の送信後、pending_participant_idが正しくない(got=%)', v_row.pending_participant_id;
  end if;

  -- reveal（updateトリガー）の前に、insertトリガー相当をもう一度呼んでも
  -- （＝到着順が前後しても）状態は変わらずnullを経由しない。
  perform public.recompute_answering_cue_for_turn(v_turn_id);
  update public.answers set revealed_at = now(), judging_ends_at = now() + interval '5 minutes' where id = v_answer_id;
  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.pending_participant_id is distinct from v_other_id then
    raise exception 'FAIL: 2順目のreveal後、pending_participant_idが変わってしまった(got=%)', v_row.pending_participant_id;
  end if;

  -- updateトリガー相当をもう一度重複して呼んでも状態は変わらない。
  perform public.recompute_answering_cue_for_turn(v_turn_id);
  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.pending_participant_id is distinct from v_other_id then
    raise exception 'FAIL: reveal後の重複呼び出しでpending_participant_idが変わってしまった(got=%)', v_row.pending_participant_id;
  end if;

  update public.answers set resolved = true where id = v_answer_id;
  select * into v_row from public.answering_cues where live_id = v_live_id;
  if v_row.pending_participant_id is not null then
    raise exception 'FAIL: 2順目のresolve後もpending_participant_idがnullになっていない';
  end if;

  raise notice 'PASS: insert/updateトリガー相当の再計算が重複・前後して呼ばれても、pending_participant_idは一瞬もnullを誤って経由しない';
end $$;

drop table _t0064_ctx;

select 'ALL 0064 TESTS PASSED' as result;
