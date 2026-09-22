-- 機能2「本番ライブの開催番号を準備時に手動指定できるようにする」対応。
--
-- 背景：0068で導入したofficial_live_counter/official_sequence_numberは常に
-- 「次の番号」を自動採番するだけで、運営者が特定の番号（例：誤って消費した
-- 番号を除いた次の正しい番号）を明示的に指定する手段が無かった。
--
-- 0068と同じ流儀で、既存のcreate_live_preparation本体（0068 119〜217行目）は
-- 一切ロジックを変更せず、「手動番号が指定された場合の分岐」だけを追加する。
-- 引数の型シグネチャが変わるため、CREATE OR REPLACEでは既存の6引数版を
-- 置き換えられない（0068 108〜117行目と同じ理由）。先に6引数版を明示的に
-- dropしてから、7引数版（p_manual_official_sequence_numberにdefault nullを
-- 持たせ、6引数呼び出しにも後方互換）を作る。
--
-- begin/commitで1トランザクションにまとめる（0068と同じ方針）。
begin;

drop function if exists public.create_live_preparation(timestamptz, text, int, int, uuid[], text);

create or replace function public.create_live_preparation(
  p_scheduled_at timestamptz,
  p_title text,
  p_max_players int,
  p_planned_group_count int,
  p_topic_bank_ids uuid[],
  p_live_mode text default 'test',
  -- 2026-09-22追加：本番開催番号の手動指定。nullなら従来どおり自動採番する。
  p_manual_official_sequence_number int default null
)
returns table (ok boolean, reason text, live_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds_per_live constant int := 1; -- src/data/liveRoomTiming.tsのROUNDS_PER_LIVE_DEFAULTと必ず同じ値にすること
  v_existing_id uuid;
  v_live_id uuid;
  v_needed_topics int;
  v_distinct_count int;
  v_inserted_topics int;
  v_official_seq int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  if p_live_mode not in ('test', 'official') then
    return query select false, 'ライブ種別が不正です', null::uuid;
    return;
  end if;

  -- 2026-09-22追加：テストライブでは開催番号を消費させない（手動指定自体を拒否する）。
  if p_live_mode = 'test' and p_manual_official_sequence_number is not null then
    return query select false, 'テストライブでは開催番号を指定できません', null::uuid;
    return;
  end if;

  -- 2026-09-22追加：0・負数・小数はここで拒否する（小数はint引数の時点でPostgres側の
  -- 型変換エラーになるため、ここでは主に0・負数を拒否する）。
  if p_manual_official_sequence_number is not null and p_manual_official_sequence_number <= 0 then
    return query select false, '本番開催番号は1以上の整数で指定してください', null::uuid;
    return;
  end if;

  if p_planned_group_count < 1 then
    return query select false, '組数は1以上にしてください', null::uuid;
    return;
  end if;

  v_needed_topics := p_planned_group_count * v_rounds_per_live;
  if p_topic_bank_ids is null or array_length(p_topic_bank_ids, 1) is distinct from v_needed_topics then
    return query select false, format('お題の数が一致しません（%s件必要）', v_needed_topics), null::uuid;
    return;
  end if;
  select count(distinct x) into v_distinct_count from unnest(p_topic_bank_ids) as x;
  if v_distinct_count <> array_length(p_topic_bank_ids, 1) then
    return query select false, 'お題が重複しています', null::uuid;
    return;
  end if;

  -- (a) この関数の実行自体を直列化する（0055・0068から変更なし）。手動番号の
  -- 重複チェック～カウンター更新も、この直列化のおかげで同時作成時に安全になる。
  perform pg_advisory_xact_lock(hashtext('create_live_preparation'));

  select id into v_existing_id from public.lives where current_phase <> 'closed' limit 1;
  if v_existing_id is not null then
    return query select false, '既に進行中のライブがあります', v_existing_id;
    return;
  end if;

  if p_live_mode = 'official' then
    if p_manual_official_sequence_number is not null then
      -- 2026-09-22追加：手動指定。lives_official_sequence_number_key一意制約に
      -- 任せて生の制約違反エラーを見せるのではなく、分かりやすい日本語で
      -- 事前に拒否する。
      if exists (
        select 1 from public.lives where official_sequence_number = p_manual_official_sequence_number
      ) then
        return query select
          false,
          format('開催番号#%s は既に使用されています', lpad(p_manual_official_sequence_number::text, 4, '0')),
          null::uuid;
        return;
      end if;
      v_official_seq := p_manual_official_sequence_number;
      -- カウンターは前進のみ更新する（過去の未使用番号を手動で埋めても巻き戻さない。
      -- 例：last_value=0の状態で手動1を使うとlast_value=1になり、次回の自動採番は2）。
      update public.official_live_counter
        set last_value = greatest(last_value, v_official_seq)
        where id = true;
    else
      update public.official_live_counter
        set last_value = last_value + 1
        where id = true
        returning last_value into v_official_seq;
    end if;
  else
    v_official_seq := null;
  end if;

  insert into public.lives (
    scheduled_at, current_phase, title, description, max_players,
    planned_group_count, reception_starts_at, reception_ends_at, created_by,
    live_mode, official_sequence_number
  ) values (
    p_scheduled_at, 'scheduled', p_title, null, p_max_players,
    p_planned_group_count, null, null, auth.uid(),
    p_live_mode, v_official_seq
  )
  returning id into v_live_id;

  insert into public.topics (live_id, body, format, topic_bank_id)
  select v_live_id, tb.body, tb.format, tb.id
  from public.topic_bank tb
  where tb.id = any(p_topic_bank_ids);
  get diagnostics v_inserted_topics = row_count;

  if v_inserted_topics <> v_needed_topics then
    -- 例外を投げてこの関数呼び出し全体（lives作成・official_live_counterの
    -- 加算/更新を含む）をロールバックする。手動番号を使った場合もカウンターの
    -- 更新自体がこのトランザクション内なので、番号だけ消費されることはない。
    raise exception 'お題の登録に失敗しました（一部のお題が見つかりません）';
  end if;

  return query select true, null::text, v_live_id;
end;
$$;

grant execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int) to authenticated;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int) from public;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int) from anon;

-- ============================================================
-- 司会コンソールの入力欄に「次に自動採番される番号」を初期値表示するための
-- 読み取り専用RPC。official_live_counterはクライアントから直接select権限が
-- 無い（0068でrevoke済み）ため、is_host()のみ許可するSECURITY DEFINER経由で
-- 覗き見できるようにする（更新は一切しない）。
-- ============================================================
create or replace function public.get_next_official_sequence_number()
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;
  return (select last_value + 1 from public.official_live_counter where id = true);
end;
$$;

grant execute on function public.get_next_official_sequence_number() to authenticated;
revoke execute on function public.get_next_official_sequence_number() from public, anon;

commit;
