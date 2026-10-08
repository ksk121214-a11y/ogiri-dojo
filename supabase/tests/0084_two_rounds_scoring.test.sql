-- 0084 回帰テスト：2周制の得点・回答の扱いを実データで検証する。
--  - 同じプレイヤーが1周目と2周目で回答し、各周に異なる得点を設定する
--  - 最終順位・付与ポイントの基礎となる合計得点は2周分の合算になる（1周目だけの最高点と順位が逆になる例で確認）
--  - 1周目の回答・得点は2周目開始時に消えない
--  - 現在の組の回答数・採点対象はそのターンのお題分だけ（前周の回答が混ざらない）
--  - 回答回数の上限（1お題あたり5回）はお題ごとにリセットされる
--  - 1周目最終組の後は2周目の第1組へ進み、2周目最終組の後だけfinal_resultへ進む
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
  ('f0880000-0000-0000-0000-000000000002', '得点合算テスト用お題2', 'text', true),
  ('f0880000-0000-0000-0000-000000000003', '得点合算テスト用お題3', 'text', true),
  ('f0880000-0000-0000-0000-000000000004', '得点合算テスト用お題4', 'text', true)
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
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_t record;
  v_total int;
begin
  select last_value into v_prev_counter from public.official_live_counter where id = true;

  -- ----------------------------------------------------------
  -- 準備：本番(official)の2組ライブを作り、4人を参加させ、組分けして開始する
  -- （テスト専用の大きな開催番号を使い、後でカウンターを元に戻す。ランキング加算はtest modeでは行われないため本番ライブが必要）
  -- ----------------------------------------------------------
  set local role authenticated;
  perform set_config('myapp.uid', v_host::text, true);
  select * into v_r from public.create_live_preparation(
    now(), '得点合算(テスト)', 20, 2,
    array['f0880000-0000-0000-0000-000000000001', 'f0880000-0000-0000-0000-000000000002', 'f0880000-0000-0000-0000-000000000003', 'f0880000-0000-0000-0000-000000000004']::uuid[],
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

  -- 同じお題は2周に重複しない（4ターンに4つのお題が1回ずつ）
  select count(*) into v_n from (select topic_id from public.turns where live_id = v_live group by topic_id having count(*) > 1) d;
  if v_n <> 0 then raise exception 'FAIL: 2周の中で同じお題が重複している'; end if;
  select count(distinct topic_id) into v_n from public.turns where live_id = v_live;
  if v_n <> 4 then raise exception 'FAIL: 2組×2周で4つの異なるお題が使われていない(distinct=%)', v_n; end if;
  raise notice 'PASS: 2周で同じお題は重複せず、4ターンそれぞれに別のお題が割り当てられる';

  -- ----------------------------------------------------------
  -- 回答と得点（1周目・2周目で異なる点数。1周目だけならBが1位になる組み合わせ）
  --   1周目 第1組：A=5点（1点×5回答）、B=10点
  --   1周目 第2組：C=0点、D=2点
  --   2周目 第1組：A=7点
  --   2周目 第2組：D=1点、C=0点
  --   合計：A=12、B=10、D=3、C=0 → 2周合算の順位はA・B・D・C
  -- ----------------------------------------------------------
  for v_n in 1..5 loop
    insert into public.answers (turn_id, participant_id, seq, body, score_total, resolved)
    values (pg_temp.turn_id(v_live, 1, 1), pg_temp.part(v_live, v_a), v_n, '1周目A-' || v_n, 1, true);
  end loop;
  insert into public.answers (turn_id, participant_id, seq, body, score_total, resolved)
    values (pg_temp.turn_id(v_live, 1, 1), pg_temp.part(v_live, v_b), 1, '1周目B', 10, true),
           (pg_temp.turn_id(v_live, 1, 2), pg_temp.part(v_live, v_c), 1, '1周目C', 0, true),
           (pg_temp.turn_id(v_live, 1, 2), pg_temp.part(v_live, v_d), 1, '1周目D', 2, true),
           (pg_temp.turn_id(v_live, 2, 1), pg_temp.part(v_live, v_a), 1, '2周目A', 7, true),
           (pg_temp.turn_id(v_live, 2, 2), pg_temp.part(v_live, v_d), 1, '2周目D', 1, true),
           (pg_temp.turn_id(v_live, 2, 2), pg_temp.part(v_live, v_c), 1, '2周目C', 0, true);

  -- 回答数の見え方：各ターンにはそのターンのお題の回答だけがある（前周が混ざらない）
  if (select count(*) from public.answers where turn_id = pg_temp.turn_id(v_live, 2, 1)) <> 1 then
    raise exception 'FAIL: 2周目第1組に1周目の回答が混ざっている';
  end if;
  if (select count(*) from public.answers where turn_id = pg_temp.turn_id(v_live, 1, 1)) <> 6 then
    raise exception 'FAIL: 1周目第1組の回答数がそのお題分になっていない';
  end if;
  raise notice 'PASS: 各ターンの回答はそのターンのお題の分だけで、前周の回答は混ざらない';

  -- ----------------------------------------------------------
  -- 進行：1周目→2周目→最終結果。各組の結果後に、次のターン・回答数・得点を確認する。
  -- ----------------------------------------------------------
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
    -- 運営の進行RPCは認証ロールで呼ぶ（is_host()の実際の判定経路を通す）
    set local role authenticated;
    perform set_config('myapp.uid', v_host::text, true);
    select advanced_to into v_expected_next from public.host_advance_group_result_to_next(v_live, v_t.id, 0);
    reset role;
    if v_n < 4 then
      if v_expected_next <> 'topic_reveal' then
        raise exception 'FAIL: % 番目（周%・組%）の後に次のお題へ進まなかった(got=%)', v_n, v_t.round, v_t.group_order, v_expected_next;
      end if;
    elsif v_expected_next <> 'final_result' then
      raise exception 'FAIL: 2周目最終組の後にfinal_resultへ進まなかった(got=%)', v_expected_next;
    end if;
    -- 次のターンへ移った直後の確認（1周目の回答は消えず、現在のターンの回答数は現在のお題分だけ）
    -- 1周目最終組（4ターン中の2番目）の結果後：2周目第1組へ移っている
    if v_n = 2 then
      if (select count(*) from public.answers where turn_id = pg_temp.turn_id(v_live, 1, 1)) <> 6 then
        raise exception 'FAIL: 2周目開始時に1周目の回答が消えた';
      end if;
      if (select current_turn_id from public.lives where id = v_live) <> pg_temp.turn_id(v_live, 2, 1) then
        raise exception 'FAIL: 1周目最終組の後に2周目第1組へ進んでいない';
      end if;
      -- 回答回数の上限は1お題ごと：Aは1周目に5回答えたが、2周目第1組では1回のみ（引き継がない）
      if public.answer_count_for_turn(pg_temp.turn_id(v_live, 2, 1), pg_temp.part(v_live, v_a)) <> 1 then
        raise exception 'FAIL: 2周目第1組のAの回答回数が1周目の回答（5回）を引き継いでいる';
      end if;
      if public.answer_count_for_turn(pg_temp.turn_id(v_live, 1, 1), pg_temp.part(v_live, v_a)) <> 5 then
        raise exception 'FAIL: 1周目第1組のAの回答回数が5になっていない';
      end if;
    end if;
  end loop;
  perform set_config('myapp.uid', '', true);
  raise notice 'PASS: 1周目最終組の後は2周目第1組へ進み、2周目最終組の後だけfinal_resultへ進む';
  raise notice 'PASS: 1周目の回答は2周目開始時に消えず、回答回数の上限はお題（ターン）ごとにリセットされる';

  -- ----------------------------------------------------------
  -- 集計：2周分の合計得点で順位・付与ポイントが決まる
  -- ----------------------------------------------------------
  select coalesce(sum(score_total), 0) into v_total
    from public.answers a join public.participants p on p.id = a.participant_id
    where p.live_id = v_live and p.user_id = v_a and a.resolved;
  if v_total <> 12 then raise exception 'FAIL: Aの合計得点が2周分の合算(12)になっていない(got=%)', v_total; end if;
  raise notice 'PASS: Aの合計得点は1周目5点＋2周目7点の12点（2周分の合算）';

  update public.lives set current_phase = 'closed' where id = v_live;
  -- 付与前の残高を控える（付与ポイントの差分で検証する）
  select jsonb_object_agg(id::text, jsonb_build_object('total', total_points, 'balance', points_balance))
    into v_before from public.profiles where id in (v_a, v_b, v_c, v_d);

  -- 運営としての適用（auth.uidを空にして、運営の内部処理として実行する）
  perform set_config('myapp.uid', '', true);
  perform public.apply_live_rank_rewards(v_live);

  select jsonb_object_agg(id::text, jsonb_build_object('total', total_points, 'balance', points_balance))
    into v_after from public.profiles where id in (v_a, v_b, v_c, v_d);

  -- 付与額：10 + 合計得点 + 順位ボーナス（1位100・2位60・3位30）
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
