-- 0065 回帰テスト：フェーズ遷移RPC（host_advance_answering_to_group_result /
-- host_advance_group_result_to_next）の権限・冪等性・ロールバックの確認。
--
-- 2026-09-25改訂（0079対応）：両RPCの契約が変わったため、それに合わせて
-- 全面的に更新した。
--   - 締切(timestamptz)をクライアントから受け取る旧方式をやめ、duration_ms
--     (整数・省略可)のみを受け取り、締切は必ずサーバー側のnow()から生成する
--     方式になった（関数シグネチャが(uuid,uuid,timestamptz)→(uuid,uuid,integer)
--     へ変わった）。
--   - is_host()必須をやめ、auth.uid()が取れていれば（一般の認証済みユーザー・
--     ゲストでも）呼べるようになった。行ロック・期待するphase/turn_id・
--     「DBのnow()で締切を本当に過ぎているか」・一時停止中でないか・未表示/
--     未確定の回答が残っていないか、を全てサーバー側で確認するため、呼び出し元の
--     権限に関わらず安全（早送りができない）ことをテストの主眼にする。
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

insert into auth.users (id) values
  ('a5000000-0000-0000-0000-00000000000a'),
  ('a5000000-0000-0000-0000-00000000000b'),
  ('a5000000-0000-0000-0000-00000000000c'),
  ('a5000000-0000-0000-0000-00000000000d'),
  ('a5000000-0000-0000-0000-0000000000ff'), -- 非host（一般ユーザー）
  ('a5000000-0000-0000-0000-00000000000f')  -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'a5000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('a5100000-0000-0000-0000-000000000001', '0065テスト用お題A', 'text', true),
  ('a5100000-0000-0000-0000-000000000002', '0065テスト用お題B', 'text', true)
on conflict do nothing;

-- ライブ準備〜開始（adminとして）。
do $$
declare
  v_live_id uuid;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);

  select live_id into v_live_id from public.create_live_preparation(
    now(), '0065テスト', 20, 2,
    array['a5100000-0000-0000-0000-000000000001', 'a5100000-0000-0000-0000-000000000002']::uuid[]
  );
  update public.lives set current_phase = 'opening' where id = v_live_id;

  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000c', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000d', true);
  perform public.join_live(v_live_id, 'player', null);

  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  perform public.begin_game(v_live_id);
end $$;

-- activeな組(turnA)・pendingな組(turnB)を動的に特定する（ランダム組分けの結果に
-- 依存しない）。
create temporary table _t0065_ctx as
select
  l.id as live_id,
  active_t.id as turn_a_id,
  pending_t.id as turn_b_id
from public.lives l
join public.turns active_t on active_t.live_id = l.id and active_t.status = 'active'
join public.turns pending_t on pending_t.live_id = l.id and pending_t.status = 'pending'
where l.title = '0065テスト';

grant select on _t0065_ctx to authenticated, anon;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from _t0065_ctx;
  if v_count <> 1 then
    raise exception 'FAIL: テスト前提のライブ・ターンが特定できなかった';
  end if;
end $$;

reset role;

-- ============================================================
-- テスト0: PUBLIC/anonは両RPC(新シグネチャ)のEXECUTE権限を持たない。
-- ============================================================
do $$
begin
  if has_function_privilege('public', 'host_advance_answering_to_group_result(uuid,uuid,integer)', 'EXECUTE') then
    raise exception 'FAIL: PUBLICがhost_advance_answering_to_group_resultのEXECUTEを持っている';
  end if;
  if has_function_privilege('anon', 'host_advance_answering_to_group_result(uuid,uuid,integer)', 'EXECUTE') then
    raise exception 'FAIL: anonがhost_advance_answering_to_group_resultのEXECUTEを持っている';
  end if;
  if has_function_privilege('public', 'host_advance_group_result_to_next(uuid,uuid,integer)', 'EXECUTE') then
    raise exception 'FAIL: PUBLICがhost_advance_group_result_to_nextのEXECUTEを持っている';
  end if;
  if has_function_privilege('anon', 'host_advance_group_result_to_next(uuid,uuid,integer)', 'EXECUTE') then
    raise exception 'FAIL: anonがhost_advance_group_result_to_nextのEXECUTEを持っている';
  end if;
  raise notice 'PASS: PUBLIC/anonはどちらのRPCのEXECUTE権限も持たない';
end $$;

-- ============================================================
-- テスト0b: anonが実際に呼び出そうとしても到達できない(insufficient_privilege)。
-- ============================================================
do $$
declare
  v_turn_a uuid;
  v_live_id uuid;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;
  set local role anon;
  begin
    perform public.host_advance_answering_to_group_result(v_live_id, v_turn_a, 15000);
    raise exception 'FAIL: anonがhost_advance_answering_to_group_resultを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonはhost_advance_answering_to_group_resultに到達できない(insufficient_privilege)';
  end;
end $$;

-- ============================================================
-- テスト1（0079対応・重要）：非host（一般authenticatedユーザー）が呼んでも、
--          締切がまだ来ていなければ安全にupdated=falseになる（早送り不可）。
--          0065旧版は「非hostは拒否」だったが、0079で「認証済みなら誰でも
--          呼べるが、サーバー側の期限確認を通らない限り何も進まない」方式に
--          変わったため、この観点でテストし直す。
-- ============================================================
do $$
declare
  v_turn_a uuid;
  v_live_id uuid;
  v_result record;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;

  -- answering・締切はまだ先、という状態を用意する。
  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn_a, phase_deadline = now() + interval '30 seconds'
    where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn_a, 15000);

  if v_result.updated is not false then
    raise exception 'FAIL: 締切前なのに非hostの呼び出しでupdated=trueになった（早送りできてしまう）';
  end if;
  if (v_result.live).current_phase <> 'answering' then
    raise exception 'FAIL: 締切前なのにcurrent_phaseが変化した';
  end if;

  raise notice 'PASS: 非hostでも呼べるが、締切前は安全にupdated=falseで拒否される（早送り不可）';
end $$;

-- ============================================================
-- テスト1b（0079対応）：一時停止中(answering_paused=true)は、締切を過ぎていても
--          進めない。
-- ============================================================
do $$
declare
  v_turn_a uuid;
  v_live_id uuid;
  v_result record;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;

  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn_a,
        phase_deadline = now() - interval '1 second', answering_paused = true, answering_remaining_ms = 5000
    where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn_a, 15000);

  if v_result.updated is not false then
    raise exception 'FAIL: 一時停止中なのにupdated=trueになった';
  end if;

  update public.lives set answering_paused = false, answering_remaining_ms = null where id = v_live_id;
  raise notice 'PASS: 一時停止中は締切を過ぎていても進まない';
end $$;

-- ============================================================
-- テスト1c（0079対応）：未表示・未確定の回答が残っている間は、締切を過ぎていても
--          進めない。
-- ============================================================
do $$
declare
  v_turn_a uuid;
  v_live_id uuid;
  v_participant_a uuid;
  v_answer_id uuid;
  v_result record;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;
  select id into v_participant_a from public.participants
    where live_id = v_live_id and user_id = 'a5000000-0000-0000-0000-00000000000a';

  insert into public.answers (id, turn_id, participant_id, seq, body)
    values (gen_random_uuid(), v_turn_a, v_participant_a, 999, '0065テスト未確定回答')
    returning id into v_answer_id;

  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn_a, phase_deadline = now() - interval '1 second'
    where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn_a, 15000);

  if v_result.updated is not false then
    raise exception 'FAIL: 未表示の回答が残っているのにupdated=trueになった';
  end if;

  reset role; -- authenticatedにはanswersのdelete policyが無いため、片付けはpostgresロールで行う
  delete from public.answers where id = v_answer_id;
  raise notice 'PASS: 未表示・未確定の回答が残っている間は締切を過ぎていても進まない';
end $$;

-- ============================================================
-- テスト2: 事前状態をanswering/turnAへ整え、締切を過ぎた状態にする →
--          非hostでも成功し、livesとturnsが同一トランザクションで更新される
--          （早送りはできないが、締切到達後は誰が呼んでも進む、を確認する）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_result record;
  v_turn_status text;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;

  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn_a, phase_deadline = now() - interval '1 second'
    where id = v_live_id;
  update public.turns set status = 'active' where id = v_turn_a;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-0000000000ff', true); -- 非host
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn_a, 15000);

  if v_result.updated is not true then
    raise exception 'FAIL: 締切到達後の呼び出しがupdated=trueにならなかった';
  end if;
  if (v_result.live).current_phase <> 'group_result' then
    raise exception 'FAIL: 戻り値のliveのcurrent_phaseがgroup_resultになっていない';
  end if;
  if (v_result.live).phase_deadline is null or (v_result.live).phase_deadline <= now() then
    raise exception 'FAIL: group_resultの新しい締切がnow()より未来になっていない';
  end if;

  reset role;
  select status into v_turn_status from public.turns where id = v_turn_a;
  if v_turn_status <> 'done' then
    raise exception 'FAIL: turnAのstatusがdoneになっていない(got=%)', v_turn_status;
  end if;

  raise notice 'PASS: 締切到達後は非hostの呼び出しでも進み、livesとturnsが同一トランザクションで正しく更新される';
end $$;

-- ============================================================
-- テスト3（冪等性・複数タブ同時実行の代理検証）：同じexpected値でもう一度呼んでも
--          何も変わらず、updated=falseが返る（エラーにはならない）。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_result record;
  v_turn_status_before text;
  v_turn_status_after text;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;
  select status into v_turn_status_before from public.turns where id = v_turn_a;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.host_advance_answering_to_group_result(v_live_id, v_turn_a, 15000);

  if v_result.updated is not false then
    raise exception 'FAIL: 既に遷移済みのはずなのにupdated=trueが返った（二重遷移の恐れ）';
  end if;
  if (v_result.live).current_phase <> 'group_result' then
    raise exception 'FAIL: 0行更新時の戻り値のliveが最新状態(group_result)になっていない';
  end if;

  reset role;
  select status into v_turn_status_after from public.turns where id = v_turn_a;
  if v_turn_status_after <> v_turn_status_before then
    raise exception 'FAIL: 0行更新のはずなのにturnAのstatusが変化した(before=%, after=%)', v_turn_status_before, v_turn_status_after;
  end if;

  raise notice 'PASS: 同じ遷移をもう一度呼んでも実際の遷移は1回だけ（2回目はupdated=falseで実害なし）';
end $$;

-- ============================================================
-- テスト4（途中失敗時のロールバック）：turnsのUPDATEを強制的に失敗させるトリガーを
--          一時的に仕込み、host_advance_answering_to_group_resultが例外を返すこと、
--          かつ直前に行われたはずのlives更新も含めて全体がロールバックされている
--          ことを確認する。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_phase_before text;
  v_turn_status_before text;
  v_phase_after text;
  v_turn_status_after text;
  v_failed boolean := false;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;

  -- 状態をanswering/turnAへ戻す（テスト2・3で既にgroup_resultへ進んでいるため）。
  update public.lives
    set current_phase = 'answering', current_turn_id = v_turn_a, phase_deadline = now() - interval '1 second'
    where id = v_live_id;
  update public.turns set status = 'active' where id = v_turn_a;

  select current_phase into v_phase_before from public.lives where id = v_live_id;
  select status into v_turn_status_before from public.turns where id = v_turn_a;

  create function public._t0065_fail_turn_done() returns trigger
  language plpgsql as $trig$
  begin
    if new.status = 'done' then
      raise exception '0065_FORCED_FAILURE_FOR_TEST';
    end if;
    return new;
  end;
  $trig$;
  create trigger _t0065_fail_turn_done_trg
    before update on public.turns
    for each row execute function public._t0065_fail_turn_done();

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.host_advance_answering_to_group_result(v_live_id, v_turn_a, 15000);
  exception
    when others then
      if sqlerrm = '0065_FORCED_FAILURE_FOR_TEST' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;

  reset role;
  drop trigger _t0065_fail_turn_done_trg on public.turns;
  drop function public._t0065_fail_turn_done();

  if not v_failed then
    raise exception 'FAIL: turnsのUPDATE失敗が例外として伝播しなかった（黙殺されている）';
  end if;

  select current_phase into v_phase_after from public.lives where id = v_live_id;
  select status into v_turn_status_after from public.turns where id = v_turn_a;

  if v_phase_after <> v_phase_before then
    raise exception 'FAIL: turnsのUPDATE失敗にも関わらず、livesの更新がロールバックされていない(before=%, after=%)', v_phase_before, v_phase_after;
  end if;
  if v_turn_status_after <> v_turn_status_before then
    raise exception 'FAIL: turnAのstatusが意図せず変化した(before=%, after=%)', v_turn_status_before, v_turn_status_after;
  end if;

  raise notice 'PASS: turnsのUPDATE失敗はエラーとして伝播し、直前のlives更新も含めて全体がロールバックされる';
end $$;

-- ============================================================
-- ここからhost_advance_group_result_to_nextのテスト。
-- 事前状態をgroup_result/turnAへ戻す。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;
  update public.lives
    set current_phase = 'group_result', current_turn_id = v_turn_a, phase_deadline = now() + interval '30 seconds'
    where id = v_live_id;
  update public.turns set status = 'done' where id = v_turn_a;
end $$;

-- ============================================================
-- テスト5（0079対応）：締切がまだ来ていなければ、非hostは呼べても安全に
--          updated=falseになる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_result record;
begin
  select live_id, turn_a_id into v_live_id, v_turn_a from _t0065_ctx;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-0000000000ff', true);
  select * into v_result from public.host_advance_group_result_to_next(v_live_id, v_turn_a, 13000);

  if v_result.updated is not false then
    raise exception 'FAIL: 組結果の締切前なのにupdated=trueになった（早送りできてしまう）';
  end if;
  raise notice 'PASS: 組結果の締切前は非hostの呼び出しでも進まない';
end $$;

-- ============================================================
-- テスト6: 締切を過ぎた状態で呼ぶと、次ターン(turnB)を特定してactive化し、
--          livesを同一トランザクションでtopic_revealへ進める。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_turn_b uuid;
  v_result record;
  v_turn_b_status text;
begin
  select live_id, turn_a_id, turn_b_id into v_live_id, v_turn_a, v_turn_b from _t0065_ctx;

  update public.lives set phase_deadline = now() - interval '1 second' where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.host_advance_group_result_to_next(v_live_id, v_turn_a, 13000);

  if v_result.updated is not true then
    raise exception 'FAIL: 締切到達後の呼び出しがupdated=trueにならなかった';
  end if;
  if v_result.advanced_to <> 'topic_reveal' then
    raise exception 'FAIL: advanced_toがtopic_revealになっていない(got=%)', v_result.advanced_to;
  end if;
  if (v_result.live).current_turn_id <> v_turn_b then
    raise exception 'FAIL: 次ターンとしてturnBが特定されていない';
  end if;
  if (v_result.live).current_phase <> 'topic_reveal' then
    raise exception 'FAIL: livesのcurrent_phaseがtopic_revealになっていない';
  end if;

  reset role;
  select status into v_turn_b_status from public.turns where id = v_turn_b;
  if v_turn_b_status <> 'active' then
    raise exception 'FAIL: turnBのstatusがactiveになっていない(got=%)', v_turn_b_status;
  end if;

  raise notice 'PASS: group_result→次ターンの遷移で、次ターンの特定・active化・lives更新が同一トランザクションで正しく行われる';
end $$;

-- ============================================================
-- テスト7（冪等性）：同じexpected値でもう一度呼んでも実際の遷移は1回だけ。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_turn_b uuid;
  v_result record;
  v_turn_b_status_before text;
  v_turn_b_status_after text;
begin
  select live_id, turn_a_id, turn_b_id into v_live_id, v_turn_a, v_turn_b from _t0065_ctx;
  select status into v_turn_b_status_before from public.turns where id = v_turn_b;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.host_advance_group_result_to_next(v_live_id, v_turn_a, 13000);

  if v_result.updated is not false then
    raise exception 'FAIL: 既に遷移済みのはずなのにupdated=trueが返った（二重遷移の恐れ）';
  end if;

  reset role;
  select status into v_turn_b_status_after from public.turns where id = v_turn_b;
  if v_turn_b_status_after <> v_turn_b_status_before then
    raise exception 'FAIL: 0行更新のはずなのにturnBのstatusが変化した';
  end if;

  raise notice 'PASS: group_result→次ターンの遷移も、同じ呼び出しを繰り返して実際の遷移は1回だけ';
end $$;

-- ============================================================
-- テスト8: 次ターンが無い場合（最後のターン）はfinal_resultへ進める。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_b uuid;
  v_result record;
begin
  select live_id, turn_b_id into v_live_id, v_turn_b from _t0065_ctx;

  update public.lives
    set current_phase = 'group_result', current_turn_id = v_turn_b, phase_deadline = now() - interval '1 second'
    where id = v_live_id;
  update public.turns set status = 'done' where id = v_turn_b;

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  select * into v_result from public.host_advance_group_result_to_next(v_live_id, v_turn_b, 13000);

  if v_result.updated is not true then
    raise exception 'FAIL: 最後のターンからの遷移がupdated=trueにならなかった';
  end if;
  if v_result.advanced_to <> 'final_result' then
    raise exception 'FAIL: 次ターンが無いのにadvanced_toがfinal_resultになっていない(got=%)', v_result.advanced_to;
  end if;
  if (v_result.live).current_phase <> 'final_result' then
    raise exception 'FAIL: livesのcurrent_phaseがfinal_resultになっていない';
  end if;
  if (v_result.live).phase_deadline is not null then
    raise exception 'FAIL: final_result遷移後もphase_deadlineがnullになっていない';
  end if;

  raise notice 'PASS: 次ターンが無い場合はfinal_resultへ正しく進む';
end $$;

-- ============================================================
-- テスト9（途中失敗時のロールバック）：group_result→次ターンでも、turnsのUPDATE
--          失敗が全体をロールバックすることを確認する。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_turn_b uuid;
  v_phase_before text;
  v_current_turn_before uuid;
  v_turn_b_status_before text;
  v_phase_after text;
  v_current_turn_after uuid;
  v_turn_b_status_after text;
  v_failed boolean := false;
begin
  select live_id, turn_a_id, turn_b_id into v_live_id, v_turn_a, v_turn_b from _t0065_ctx;

  -- 状態をgroup_result/turnAへ戻す（次ターン=turnBが存在する状態）。
  update public.lives
    set current_phase = 'group_result', current_turn_id = v_turn_a, phase_deadline = now() - interval '1 second'
    where id = v_live_id;
  update public.turns set status = 'done' where id = v_turn_a;
  update public.turns set status = 'pending' where id = v_turn_b;

  select current_phase, current_turn_id into v_phase_before, v_current_turn_before from public.lives where id = v_live_id;
  select status into v_turn_b_status_before from public.turns where id = v_turn_b;

  create function public._t0065_fail_turn_active() returns trigger
  language plpgsql as $trig$
  begin
    if new.status = 'active' then
      raise exception '0065_FORCED_FAILURE_FOR_TEST_2';
    end if;
    return new;
  end;
  $trig$;
  create trigger _t0065_fail_turn_active_trg
    before update on public.turns
    for each row execute function public._t0065_fail_turn_active();

  set local role authenticated;
  perform set_config('myapp.uid', 'a5000000-0000-0000-0000-00000000000f', true);
  begin
    perform public.host_advance_group_result_to_next(v_live_id, v_turn_a, 13000);
  exception
    when others then
      if sqlerrm = '0065_FORCED_FAILURE_FOR_TEST_2' then
        v_failed := true;
      else
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;

  reset role;
  drop trigger _t0065_fail_turn_active_trg on public.turns;
  drop function public._t0065_fail_turn_active();

  if not v_failed then
    raise exception 'FAIL: turnsのUPDATE失敗が例外として伝播しなかった（黙殺されている）';
  end if;

  select current_phase, current_turn_id into v_phase_after, v_current_turn_after from public.lives where id = v_live_id;
  select status into v_turn_b_status_after from public.turns where id = v_turn_b;

  if v_phase_after <> v_phase_before or v_current_turn_after <> v_current_turn_before then
    raise exception 'FAIL: turnsのUPDATE失敗にも関わらず、livesの更新(current_phase/current_turn_id)がロールバックされていない';
  end if;
  if v_turn_b_status_after <> v_turn_b_status_before then
    raise exception 'FAIL: turnBのstatusが意図せず変化した(before=%, after=%)', v_turn_b_status_before, v_turn_b_status_after;
  end if;

  raise notice 'PASS: group_result→次ターンでも、turnsのUPDATE失敗で直前のlives更新も含めて全体がロールバックされる';
end $$;

reset role;
drop table _t0065_ctx;

select 'ALL 0065 TESTS PASSED' as result;
