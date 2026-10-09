-- 第3段階リモート適用後の実機テストで見つかった不具合修正（2件目）：
-- host_add_next_round（0085で新設、次の周を組ごとに1件のお題で追加するRPC）が、
-- 作成するtopics行のtopic_bank_idを常にnull固定にしていた。運営コンソールで
-- 次の周のお題を「登録済みのお題（topic_bank）」から選べるようにするため、
-- p_topicsの各要素へ任意でtopic_bank_idを持たせ、検証したうえでtopics.topic_bank_idへ
-- 保存できるようにする。
--
-- p_topics要素の形式（後方互換）：
--   { "group_id": "<uuid>", "topic_body": "<お題>" }                         …手入力（旧形式のまま、topic_bank_id省略）
--   { "group_id": "<uuid>", "topic_body": "<お題>", "topic_bank_id": "<uuid>" } …登録済みのお題から選択
--   topic_bank_idキーが無い・JSON nullのいずれも「手入力」として扱う（topics.topic_bank_id=null）。
--
-- topic_bank_idを指定した場合のDB側検証（不正なID・本文の不一致を拒否）：
--   - 有効なUUID形式であること
--   - public.topic_bankに実在し、is_active=trueであること
--   - 対応するtopic_bodyが、そのtopic_bank行のbody（trim後）と完全一致すること
--   - 同じp_topics内で同じtopic_bank_idを複数の組へ重複指定していないこと
--     （「現在のライブで既に使ったお題を候補から除外する」「同じ次回ラウンド内で
--     1つのお題を複数の組へ重複選択できないようにする」はクライアント側（候補一覧の
--     絞り込み）が主な役割だが、DB側でも同一リクエスト内の重複は多層防御として拒否する。
--     過去のラウンドで既に使ったお題の再利用自体は、運営が意図して選べば技術的には
--     禁止しない＝クライアント側の候補除外に委ねる）。
--   - 登録済みのお題を選んだ場合は、topic_bank.formatもそのままtopics.formatへ引き継ぐ
--     （手入力は従来どおり'text'固定。updateCapacity等の既存のtopic_bank取り込み処理と
--     同じ考え方）。
--
-- シグネチャ（uuid, int, jsonb）は0085から変更しない。create or replaceのみで、
-- 既存のrevoke/grant（authenticatedのみ・is_host()チェック）は再定義後も維持される
-- （0085がcreate_live_preparation等を再定義した際と同じ、このリポジトリで確立済みの
-- パターン）。0001〜0085は編集しない。
begin;

create or replace function public.host_add_next_round(
  p_live_id uuid,
  p_expected_round int,
  p_topics jsonb
)
returns table (ok boolean, reason text, live public.lives, first_turn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_rounds constant int := 10; -- src/data/liveRoomTiming.tsのMAX_ROUNDS_PER_LIVEと必ず同じ値にすること
  v_max_topic_len constant int := 200; -- host_add_next_round旧版・create_live_preparationと同じ上限
  v_live public.lives%rowtype;
  v_planned_group_count int;
  v_topic_id uuid;
  v_topic_reveal_ms int;
  v_new_round int;
  v_first_turn_id uuid;
  v_expected_group_ids uuid[];
  v_seen_group_ids uuid[] := array[]::uuid[];
  v_seen_topic_bank_ids uuid[] := array[]::uuid[];
  v_bodies_by_group jsonb := '{}'::jsonb;
  v_topic_bank_ids_by_group jsonb := '{}'::jsonb;
  v_formats_by_group jsonb := '{}'::jsonb;
  v_elem jsonb;
  v_group_id uuid;
  v_group_id_text text;
  v_topic_body text;
  v_topic_bank_id uuid;
  v_topic_bank_body text;
  v_topic_bank_format text;
  rec record;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, 'LIVE_NOT_FOUND', null::public.lives, null::uuid;
    return;
  end if;

  if v_live.current_phase <> 'awaiting_round_decision' then
    return query select false, '現在は周回の判断待ちの状態ではありません。最新状態を確認してください。', v_live, null::uuid;
    return;
  end if;

  v_new_round := v_live.rounds_per_live + 1;
  if p_expected_round is distinct from v_new_round then
    return query select false, '既に処理されています。最新状態を確認してください。', v_live, null::uuid;
    return;
  end if;

  if v_new_round > v_max_rounds then
    return query select false, format('周回数の上限（%s周）に達しています', v_max_rounds), v_live, null::uuid;
    return;
  end if;

  if p_topics is null or jsonb_typeof(p_topics) is distinct from 'array' then
    return query select false, 'お題の指定形式が不正です', v_live, null::uuid;
    return;
  end if;

  v_planned_group_count := v_live.planned_group_count;
  select array_agg(id) into v_expected_group_ids
    from public.groups
    where live_id = p_live_id and group_order <= coalesce(v_planned_group_count, 2147483647);
  if v_expected_group_ids is null or array_length(v_expected_group_ids, 1) is null then
    return query select false, '組が見つかりません', v_live, null::uuid;
    return;
  end if;

  -- 件数の不一致（不足・過剰）は、内容を見る前にまず拒否する（「同じ組の重複」は
  -- 件数が一致している場合だけを指す別の検証として、この後の要素ループで扱う）。
  if jsonb_array_length(p_topics) is distinct from array_length(v_expected_group_ids, 1) then
    return query select false, format('お題の数が一致しません（%s件必要）', array_length(v_expected_group_ids, 1)), v_live, null::uuid;
    return;
  end if;

  -- 各要素を検証しながら、group_id（現在のライブの組として実在するもの）→
  -- trim済みお題／出典topic_bank_id／format、のマップを組み立てる。配列の位置は一切信用しない。
  for v_elem in select * from jsonb_array_elements(p_topics)
  loop
    if jsonb_typeof(v_elem -> 'group_id') is distinct from 'string' then
      return query select false, '組の指定が不正です', v_live, null::uuid;
      return;
    end if;
    v_group_id_text := v_elem ->> 'group_id';
    begin
      v_group_id := v_group_id_text::uuid;
    exception when others then
      return query select false, '組の指定が不正です', v_live, null::uuid;
      return;
    end;

    if jsonb_typeof(v_elem -> 'topic_body') is distinct from 'string' then
      return query select false, 'お題は文字列で指定してください', v_live, null::uuid;
      return;
    end if;
    v_topic_body := trim(v_elem ->> 'topic_body');

    if v_group_id = any(v_seen_group_ids) then
      return query select false, '同じ組が重複して指定されています', v_live, null::uuid;
      return;
    end if;
    if not (v_group_id = any(v_expected_group_ids)) then
      return query select false, '現在のライブに存在しない組が指定されています', v_live, null::uuid;
      return;
    end if;
    if v_topic_body = '' then
      return query select false, 'お題を入力してください', v_live, null::uuid;
      return;
    end if;
    if length(v_topic_body) > v_max_topic_len then
      return query select false, format('お題は%s文字以内で入力してください', v_max_topic_len), v_live, null::uuid;
      return;
    end if;

    -- topic_bank_id：キーが無い・JSON nullはいずれも「手入力」としてnull扱いにする
    -- （既存の呼び出し方＝topic_bank_idを渡さないケースとの後方互換性を保つ）。
    v_topic_bank_id := null;
    v_topic_bank_format := 'text';
    if (v_elem ? 'topic_bank_id') and jsonb_typeof(v_elem -> 'topic_bank_id') is distinct from 'null' then
      if jsonb_typeof(v_elem -> 'topic_bank_id') is distinct from 'string' then
        return query select false, 'お題の指定（topic_bank_id）が不正です', v_live, null::uuid;
        return;
      end if;
      begin
        v_topic_bank_id := (v_elem ->> 'topic_bank_id')::uuid;
      exception when others then
        return query select false, 'お題の指定（topic_bank_id）が不正です', v_live, null::uuid;
        return;
      end;

      select body, format into v_topic_bank_body, v_topic_bank_format
        from public.topic_bank
        where id = v_topic_bank_id and is_active = true;
      if not found then
        return query select false, '指定されたお題は見つからないか、使用停止されています', v_live, null::uuid;
        return;
      end if;
      if trim(v_topic_bank_body) <> v_topic_body then
        return query select false, '指定されたお題の本文が一致しません', v_live, null::uuid;
        return;
      end if;

      if v_topic_bank_id = any(v_seen_topic_bank_ids) then
        return query select false, '同じお題を複数の組に設定することはできません', v_live, null::uuid;
        return;
      end if;
      v_seen_topic_bank_ids := array_append(v_seen_topic_bank_ids, v_topic_bank_id);
    end if;

    v_seen_group_ids := array_append(v_seen_group_ids, v_group_id);
    v_bodies_by_group := v_bodies_by_group || jsonb_build_object(v_group_id::text, v_topic_body);
    v_topic_bank_ids_by_group := v_topic_bank_ids_by_group || jsonb_build_object(v_group_id::text, v_topic_bank_id::text);
    v_formats_by_group := v_formats_by_group || jsonb_build_object(v_group_id::text, v_topic_bank_format);
  end loop;

  -- 多層防御：件数一致・重複なしは確認済みだが、念のため「現在の組の誰にも
  -- 入力が無い」状態が無いかもここで明示的に確認する（通常はここに到達する時点で
  -- 既に集合として完全一致しているはずだが、ロジック変更時の保険として残す）。
  if exists (
    select 1 from unnest(v_expected_group_ids) as g
    where not (g = any(v_seen_group_ids))
  ) then
    return query select false, 'すべての組のお題を入力してください', v_live, null::uuid;
    return;
  end if;

  v_topic_reveal_ms := public._live_phase_duration_ms(v_live.timing_profile, 'topic_reveal');

  -- 組ごとに1件のtopics行を作り、同じ組のturnへ割り当てる（group_orderの昇順で
  -- 作成することで、1組目のturnが一貫して最初のアクティブターンになる）。
  for rec in
    select g.id as group_id
    from public.groups g
    where g.live_id = p_live_id and g.group_order <= coalesce(v_planned_group_count, 2147483647)
    order by g.group_order asc
  loop
    v_topic_body := v_bodies_by_group ->> rec.group_id::text;

    insert into public.topics (live_id, body, format, topic_bank_id, locked)
      values (
        p_live_id,
        v_topic_body,
        coalesce(v_formats_by_group ->> rec.group_id::text, 'text'),
        (v_topic_bank_ids_by_group ->> rec.group_id::text)::uuid,
        true
      )
      returning id into v_topic_id;

    insert into public.turns (live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (
      p_live_id, v_new_round, rec.group_id, v_topic_id, 'pending',
      (
        select count(*) from public.participants p
        where p.live_id = p_live_id and p.role = 'player' and p.group_id <> rec.group_id
          and p.kicked_at is null
          and not public._is_guest_identity(p.user_id, p.is_guest)
      )
    );
  end loop;

  select t.id into v_first_turn_id
  from public.turns t
  join public.groups g on g.id = t.group_id
  where t.live_id = p_live_id and t.round = v_new_round
  order by g.group_order asc
  limit 1;

  update public.turns set status = 'active' where id = v_first_turn_id;

  update public.lives
    set current_turn_id = v_first_turn_id,
        current_phase = 'topic_reveal',
        phase_deadline = now() + make_interval(secs => v_topic_reveal_ms / 1000.0),
        rounds_per_live = v_new_round,
        answering_paused = false,
        answering_remaining_ms = null
    where id = p_live_id
    returning * into v_live;

  return query select true, null::text, v_live, v_first_turn_id;
end;
$$;

commit;
