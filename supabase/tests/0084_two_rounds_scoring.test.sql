-- 0084/0085 回帰テスト：複数周の得点・回答の扱いを実データで検証する
--  （0085で周回が運営者の動的な追加に変わったため、host_add_next_roundで
--   2周目を追加する手順を挟む形に更新した。検証項目自体は0084から変更しない）。
--  - 同じプレイヤーが1周目と2周目で回答し、各周に異なる得点を設定する
--  - 最終順位・付与ポイントの基礎となる合計得点は2周分の合算になる（1周目だけの最高点と順位が逆になる例で確認）
--  - 1周目の回答・得点は2周目開始時に消えない
--  - 現在の組の回答数・採点対象はそのターンのお題分だけ（前周の回答が混ざらない）
--  - 回答回数の上限（1お題あたり5回）はお題ごとにリセットされる
--  - 1周目最終組の後はawaiting_round_decisionへ入り、host_add_next_roundで2周目を
--    追加すると2周目第1組へ進み、2周目最終組の後はawaiting_round_decisionへ戻る
--  - 同じお題は2周に重複しない
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

update public.lives set current_phase = 'closed' where current_phase <> 'closed';

insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('f0880000-0000-0000-0000-00000000a001', false, '{"provider":"x"}'::jsonb), -- host
  ('f0880000-0000-0000-0000-00000000a011', false, '{"provider":"x"}'::jsonb), -- A：1周目と2周目の両方で回答（合計12点）
  ('f0880000-0000-0000-0000-00000000a012', false, '{"provider":"x"}'::jsonb), -- B：1周目だけ10点（1周目単独なら1位）
  ('f0880000-0000-0000-0000-00000000a013', false, '{"provider":"x"}'::jsonb), -- C：0点
  ('f0880000-0000-0000-0000-00000000a014', false, '{"provider":"x"}'::jsonb)  -- D：2周で合計3点
on conflict do nothing;

update public.profiles set role = 'admin' where id = 'f0880000-0000-0000-0000-00000000a001';

insert into public.topic_bank (id, body, format, is_active) values
  ('f0880000-0000-0000-0000-000000000001', '得点合算テスト用お題1', 'text', true),
  ('f0880000-0000-0000-0000-000000000002', '得点合算テスト用お題2', 'text', true)
on conflict do nothing;

-- 補助関数：ライブ・周・組の順番からターンID、ライブ内の利用者から参加者IDを引く
create or replace function pg_temp.turn_id(p_live uuid, p_round int, p_order int) returns uuid
language sql as $$
  select t.id from public.turns t join public.groups g on g.id = t.group_id
  where t.live_id = p_live and t.round = p_round and g.group_order = p_order
$$;

create or replace function pg_temp.part(p_live uuid, p_user uuid) returns uuid
language sql as $$
  select id from public.participants where live_id = p_live and user_id = p_user
$$;

do $$
declare
  v_host uuid := 'f0880000-0000-0000-0000-00000000a001';
  v_a uuid := 'f0880000-0000-0000-0000-00000000a011';
  v_b uuid := 'f0880000-0000-0000-0000-00000000a012';
  v_c uuid := 'f0880000-0000-0000-0000-00000000a013';
  v_d uuid := 'f0880000-0000-0000-0000-00000000a014';
  v_prev_counter int;
  v_r record;
  v_live uuid;
  v_begin record;
  v_n int;
  v_expected_next text;
  v_add record;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_t record;
  v_total int;
begin
  select last_value into v_prev_counter from public.official_live_counter where id = true;

  -- ----------------------------------------------------------
  -- 準備：本番(official)の2組ライブを作り、4人を参加させ、組分けして開始する
  -- （1周目分のお題2件だけで作成する。2周目のお題はhost_add_next_roundで追加する）
  -- ----------------------------------------------------------
  set local role authenticated;
  perform set_config('myapp.uid', v_host::text, true);
  select * into v_r from public.create_live_preparation(
    now(), '得点合算(テスト)', 20, 2,
    array['f0880000-0000-0000-0000-000000000001', 'f0880000-0000-0000-0000-000000000002']::uuid[],
    'official', 982060, 'standard'
  );
  reset role;
  if v_r.ok is not true then raise exception 'FAIL: 得点合算テストのライブ作成に失敗(reason=%)', v_r.reason; end if;
  v_live := v_r.live_id;

  update public.lives set current_phase = 'opening' where id = v_live;
  set local role authenticated;
  perform set_config('myapp.uid', v_a::text, true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', v_b::text, true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', v_c::text, true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', v_d::text, true);
  perform public.join_live(v_live, 'player', null);
  perform set_config('myapp.uid', v_host::text, true);
  perform public.randomize_groups(v_live);
  reset role;

  -- 組分けを決定的にする：A・Bは第1組、C・Dは第2組
  update public.participants set group_id = (select id from public.groups where live_id = v_live and group_order = 1)
    where live_id = v_live and user_id in (v_a, v_b);
  update public.participants set group_id = (select id from public.groups where live_id = v_live and group_order = 2)
    where live_id = v_live and user_id in (v_c, v_d);

  set local role authenticated;
  perform set_config('myapp.uid', v_host::text, true);
  select * into v_begin from public.begin_game(v_live);
  reset role;
  if v_begin.ok is not true then raise exception 'FAIL: 得点合算テストのbegin_gameに失敗(reason=%)', v_begin.reason; end if;

  -- 1周目は2組に2つの異なるお題
  select count(*) into v_n from (select topic_id from public.turns where live_id = v_live group by topic_id having count(*) > 1) d;
  if v_n <> 0 then raise exception 'FAIL: 1周目の中で同じお題が重複している'; end if;
  select count(distinct topic_id) into v_n from public.turns where live_id = v_live;
  if v_n <> 2 then raise exception 'FAIL: 2組×1周で2つの異なるお題が使われていない(distinct=%)', v_n; end if;
  raise notice 'PASS: 1周目は2組に2つの異なるお題が割り当てられる';

  -- ----------------------------------------------------------
  -- 1周目の回答と得点（1周目だけならBが1位になる組み合わせ）
  --   1周目 第1組：A=5点（1点×5回答）、B=10点
  --   1周目 第2組：C=0点、D=2点
  -- ----------------------------------------------------------
  for v_n in 1..5 loop
    insert into public.answers (turn_id, participant_id, seq, body, score_total, resolved)
    values (pg_temp.turn_id(v_live, 1, 1), pg_temp.part(v_live, v_a), v_n, '1周目A-' || v_n, 1, true);
  end loop;
  insert into public.answers (turn_id, participant_id, seq, body, score_total, resolved)
    values (pg_temp.turn_id(v_live, 1, 1), pg_temp.part(v_live, v_b), 1, '1周目B', 10, true),
           (pg_temp.turn_id(v_live, 1, 2), pg_temp.part(v_live, v_c), 1, '1周目C', 0, true),
           (pg_temp.turn_id(v_live, 1, 2), pg_temp.part(v_live, v_d), 1, '1周目D', 2, true);

  if (select count(*) from public.answers where turn_id = pg_temp.turn_id(v_live, 1, 1)) <> 6 then
    raise exception 'FAIL: 1周目第1組の回答数がそのお題分になっていない';
  end if;
  raise notice 'PASS: 1周目の回答はそのターンのお題の分だけ記録される';

  -- ----------------------------------------------------------
  -- 進行：1周目の2組を終える→awaiting_round_decisionへ入る。
  -- ----------------------------------------------------------
  set local role authenticated;
  perform set_config('myapp.uid', v_host::text, true);
  v_n := 0;
  for v_t in
    select t.id, t.round, g.group_order from public.turns t join public.groups g on g.id = t.group_id
    where t.live_id = v_live order by t.round, g.group_order
  loop
    v_n := v_n + 1;
    update public.lives set current_phase = 'group_result', current_turn_id = v_t.id, phase_deadline = now() - interval '1 second'
      where id = v_live;
    update public.turns set status = 'done' where id = v_t.id;
    select advanced_to into v_expected_next from public.host_advance_group_result_to_next(v_live, v_t.id, 0);
    if v_n < 2 then
      if v_expected_next <> 'topic_reveal' then
        raise exception 'FAIL: % 番目（周%・組%）の後に次のお題へ進まなかった(got=%)', v_n, v_t.round, v_t.group_order, v_expected_next;
      end if;
    elsif v_expected_next <> 'awaiting_round_decision' then
      raise exception 'FAIL: 1周目最終組の後にawaiting_round_decisionへ進まなかった(got=%)', v_expected_next;
    end if;
  end loop;
  reset role;
  if (select current_phase from public.lives where id = v_live) <> 'awaiting_round_decision' then
    raise exception 'FAIL: 1周目終了後の現在フェーズがawaiting_round_decisionになっていない';
  end if;
  raise notice 'PASS: 1周目の2組が終わるとawaiting_round_decision（運営者の周回判断待ち）へ入る';

  -- 1周目の回答・回答回数は維持されている
  if (select count(*) from public.answers where turn_id = pg_temp.turn_id(v_live, 1, 1)) <> 6 then
    raise exception 'FAIL: 周回判断待ちの間に1周目の回答が消えた';
  end if;
  if public.answer_count_for_turn(pg_temp.turn_id(v_live, 1, 1), pg_temp.part(v_live, v_a)) <> 5 then
    raise exception 'FAIL: 1周目第1組のAの回答回数が5になっていない';
  end if;

  -- ----------------------------------------------------------
  -- 運営者が2周目を追加する（host_add_next_round）。
  -- ----------------------------------------------------------
  set local role authenticated;
  perform set_config('myapp.uid', v_host::text, true);
  select * into v_add from public.host_add_next_round(v_live, 2, jsonb_build_array(
    jsonb_build_object('group_id', (select id from public.groups where live_id = v_live and group_order = 1), 'topic_body', '得点合算テスト用お題(2周目・第1組)'),
    jsonb_build_object('group_id', (select id from public.groups where live_id = v_live and group_order = 2), 'topic_body', '得点合算テスト用お題(2周目・第2組)')
  ));
  reset role;
  if v_add.ok is not true then raise exception 'FAIL: host_add_next_roundで2周目の追加に失敗(reason=%)', v_add.reason; end if;
  if (select current_phase from public.lives where id = v_live) <> 'topic_reveal' then
    raise exception 'FAIL: 2周目追加後のフェーズがtopic_revealになっていない';
  end if;
  if (select current_turn_id from public.lives where id = v_live) <> pg_temp.turn_id(v_live, 2, 1) then
    raise exception 'FAIL: 2周目追加後に2周目第1組へ進んでいない';
  end if;
  raise notice 'PASS: host_add_next_roundで2周目を追加すると、2周目第1組のtopic_revealへ進む';

  -- 同じお題は重複しない（1周目2件＋2周目2件＝4ターンに4つの異なるお題。
  -- 第3段階修正：2周目以降も既存仕様どおり「1組につき1お題」に戻したため、
  -- 組ごとに別のお題が割り当てられる＝重複は0件）。
  select count(*) into v_n from (select topic_id from public.turns where live_id = v_live group by topic_id having count(*) > 1) d;
  if v_n <> 0 then raise exception 'FAIL: お題が重複している(got=%件)', v_n; end if;
  select count(distinct topic_id) into v_n from public.turns where live_id = v_live;
  if v_n <> 4 then raise exception 'FAIL: 2組×2周で4つの異なるお題が使われていない(distinct=%)', v_n; end if;
  raise notice 'PASS: 2周目も1組につき1お題で、1周目・2周目を通じて全ターンに別々のお題が割り当てられる';

  -- 2周目第1組の回答数見え方：前周の回答が混ざらない
  if (select count(*) from public.answers where turn_id = pg_temp.turn_id(v_live, 2, 1)) <> 0 then
    raise exception 'FAIL: 2周目第1組に1周目の回答が混ざっている';
  end if;
  -- 回答回数の上限は1お題ごと：Aは1周目に5回答えたが、2周目第1組ではまだ0回
  if public.answer_count_for_turn(pg_temp.turn_id(v_live, 2, 1), pg_temp.part(v_live, v_a)) <> 0 then
    raise exception 'FAIL: 2周目第1組のAの回答回数が1周目の回答（5回）を引き継いでいる';
  end if;
  raise notice 'PASS: 2周目は前周の回答・回答回数を引き継がない（お題（ターン）ごとにリセットされる）';

  -- ----------------------------------------------------------
  -- 2周目の回答と得点
  --   2周目 第1組：A=7点
  --   2周目 第2組：D=1点、C=0点
  --   合計：A=12、B=10、D=3、C=0 → 2周合算の順位はA・B・D・C
  -- ----------------------------------------------------------
  insert into public.answers (turn_id, participant_id, seq, body, score_total, resolved)
    values (pg_temp.turn_id(v_live, 2, 1), pg_temp.part(v_live, v_a), 1, '2周目A', 7, true),
           (pg_temp.turn_id(v_live, 2, 2), pg_temp.part(v_live, v_d), 1, '2周目D', 1, true),
           (pg_temp.turn_id(v_live, 2, 2), pg_temp.part(v_live, v_c), 1, '2周目C', 0, true);

  -- ----------------------------------------------------------
  -- 進行：2周目の2組を終える→再びawaiting_round_decisionへ入る→運営者が終了を選ぶ。
  -- ----------------------------------------------------------
  set local role authenticated;
  perform set_config('myapp.uid', v_host::text, true);
  v_n := 0;
  for v_t in
    select t.id, t.round, g.group_order from public.turns t join public.groups g on g.id = t.group_id
    where t.live_id = v_live and t.round = 2 order by g.group_order
  loop
    v_n := v_n + 1;
    update public.lives set current_phase = 'group_result', current_turn_id = v_t.id, phase_deadline = now() - interval '1 second'
      where id = v_live;
    update public.turns set status = 'done' where id = v_t.id;
    select advanced_to into v_expected_next from public.host_advance_group_result_to_next(v_live, v_t.id, 0);
    if v_n < 2 then
      if v_expected_next <> 'topic_reveal' then
        raise exception 'FAIL: 2周目% 番目（組%）の後に次のお題へ進まなかった(got=%)', v_n, v_t.group_order, v_expected_next;
      end if;
    elsif v_expected_next <> 'awaiting_round_decision' then
      raise exception 'FAIL: 2周目最終組の後にawaiting_round_decisionへ進まなかった(got=%)', v_expected_next;
    end if;
  end loop;
  reset role;
  raise notice 'PASS: 2周目の2組が終わると再びawaiting_round_decisionへ入る（自動でfinal_resultへは進まない）';

  -- 運営者がライブを終了する（最終結果へ）
  set local role authenticated;
  perform set_config('myapp.uid', v_host::text, true);
  select * into v_r from public.host_finish_live_from_round_decision(v_live);
  reset role;
  if v_r.ok is not true then raise exception 'FAIL: host_finish_live_from_round_decisionに失敗(reason=%)', v_r.reason; end if;
  if (select current_phase from public.lives where id = v_live) <> 'final_result' then
    raise exception 'FAIL: 終了操作の後にfinal_resultへ進んでいない';
  end if;
  raise notice 'PASS: 運営者がhost_finish_live_from_round_decisionを実行すると最終結果へ進む';

  perform set_config('myapp.uid', '', true);

  -- ----------------------------------------------------------
  -- 集計：2周分の合計得点で順位・付与ポイントが決まる
  -- ----------------------------------------------------------
  select coalesce(sum(score_total), 0) into v_total
    from public.answers a join public.participants p on p.id = a.participant_id
    where p.live_id = v_live and p.user_id = v_a and a.resolved;
  if v_total <> 12 then raise exception 'FAIL: Aの合計得点が2周分の合算(12)になっていない(got=%)', v_total; end if;
  raise notice 'PASS: Aの合計得点は1周目5点＋2周目7点の12点（2周分の合算）';

  update public.lives set current_phase = 'closed' where id = v_live;
  select jsonb_object_agg(id::text, jsonb_build_object('total', total_points, 'balance', points_balance))
    into v_before from public.profiles where id in (v_a, v_b, v_c, v_d);

  perform set_config('myapp.uid', '', true);
  perform public.apply_live_rank_rewards(v_live);

  select jsonb_object_agg(id::text, jsonb_build_object('total', total_points, 'balance', points_balance))
    into v_after from public.profiles where id in (v_a, v_b, v_c, v_d);

  if (v_after -> v_a::text ->> 'total')::int - (v_before -> v_a::text ->> 'total')::int <> 10 + 12 + 100 then
    raise exception 'FAIL: Aの付与ポイントが2周合算の1位（122）になっていない';
  end if;
  if (v_after -> v_b::text ->> 'total')::int - (v_before -> v_b::text ->> 'total')::int <> 10 + 10 + 60 then
    raise exception 'FAIL: Bの付与ポイントが2位（80）になっていない（1周目だけで順位付けしてしまっている疑い）';
  end if;
  if (v_after -> v_d::text ->> 'total')::int - (v_before -> v_d::text ->> 'total')::int <> 10 + 3 + 30 then
    raise exception 'FAIL: Dの付与ポイントが3位（43）になっていない';
  end if;
  if (v_after -> v_c::text ->> 'total')::int - (v_before -> v_c::text ->> 'total')::int <> 10 then
    raise exception 'FAIL: Cの付与ポイントが4位相当（10）になっていない';
  end if;
  if (select points_balance from public.profiles where id = v_a) - (v_before -> v_a::text ->> 'balance')::int <> 122 then
    raise exception 'FAIL: Aのポイント残高に2周合算の付与額が入っていない';
  end if;
  if not exists (
    select 1 from public.point_history where live_id = v_live and user_id = v_a and points = 122 and label like '%（1位）%'
  ) then
    raise exception 'FAIL: Aの履歴に1位（122点）の記録が無い';
  end if;
  raise notice 'PASS: 順位と付与ポイントは2周合算の得点で決まる（A=1位122、B=2位80、D=3位43、C=10）';

  update public.official_live_counter set last_value = v_prev_counter where id = true;
end $$;

-- 後始末
update public.lives set current_phase = 'closed' where current_phase <> 'closed';
