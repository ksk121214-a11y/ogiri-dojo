-- バグ修正：フェーズ遷移とturns.status更新が別々のSupabase呼び出しになっており、
-- 後半のturns更新のエラーを確認していなかった問題の修正。
--
-- 【問題】
-- 以前のsrc/store/useLiveHostStore.ts（advanceIfDue）は、次の2つの遷移を
-- それぞれ「livesのUPDATE」→「turnsのUPDATE」という2回の別々の呼び出しに
-- 分けており、後半のturns更新の成否を一切確認していなかった。
--
--   answering→group_result: 1) lives.current_phaseをgroup_resultへ更新
--                            2) 現在ターンのstatusをdoneへ更新
--   group_result→次のtopic_reveal: 1) lives.current_turn_id/current_phaseを
--                                     次ターンへ更新
--                                  2) 次ターンのstatusをactiveへ更新
--
-- 特に2つ目で、1)のlives更新だけ成功し2)のturns更新が何らかの理由で失敗すると、
-- 次ターンがpendingのままになる。回答・採点のRLS（0063 topics_select_revealed_or_host
-- 等）は「turn.status='active' かつ turn.id=lives.current_turn_id」を条件にしている
-- ため、この不整合が起きるとそのターンの参加者全員が回答・お題を読めず、事実上
-- 進行不能になる。
--
-- 【修正】
-- 上記2つの遷移それぞれを、狭い用途の1つのSECURITY DEFINER RPCにまとめ、
-- turns/livesの更新を同一トランザクション（＝1回の関数呼び出し）で行う。
--   - is_host()を関数内部で必ず確認する（authenticatedへEXECUTEを許可しても、
--     ホスト以外は実行できない）。
--   - 対象live行を`for update`でロックしてから、期待しているcurrent_phase・
--     current_turn_idと一致するかを確認する。一致しなければ「既に別のタブ
--     （または別の管理画面セッション）が遷移済み」とみなし、エラーにせず
--     updated=falseを返す（複数タブから同時に呼ばれても、実際にlives行の
--     ロックを取れた1回だけが遷移を行う）。
--   - 内部のUPDATEが失敗した場合、関数呼び出し全体（1トランザクション）が
--     自動的にロールバックされる。例外はそのままsupabase.rpc()の呼び出し元へ
--     errorとして伝播する（黙殺しない）。
--   - PUBLIC・anonからのEXECUTEは明示的に剥奪し、authenticatedにのみ許可する
--     （実行できてもis_host()チェックで弾かれる多層防御）。
--   - search_pathを明示的にpublicへ固定する。
--   - 戻り値に更新後のlives行（またはfor update時点の行）を含め、
--     フロント側はこれをそのままstate.liveへ反映することで、追加の再取得
--     無しに最新のフェーズ・current_turn_idを得られるようにする。

begin;

-- ============================================================
-- 1) answering → group_result：現在ターンのdone化 + lives更新を1トランザクションで。
-- ============================================================
create function public.host_advance_answering_to_group_result(
  p_live_id uuid,
  p_expected_turn_id uuid,
  p_group_result_deadline timestamptz
)
returns table (updated boolean, live public.lives)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::public.lives;
    return;
  end if;

  if v_live.current_phase <> 'answering' or v_live.current_turn_id is distinct from p_expected_turn_id then
    -- 既に別のタブ（または別の管理画面セッション）が遷移済み。エラーにはしない。
    return query select false, v_live;
    return;
  end if;

  update public.lives
    set current_phase = 'group_result',
        phase_deadline = p_group_result_deadline,
        answering_paused = false,
        answering_remaining_ms = null
    where id = p_live_id
    returning * into v_live;

  -- turnsの更新が失敗した場合、この関数呼び出し全体（1トランザクション）が
  -- ロールバックされ、直前のlives更新も無かったことになる（部分成功が残らない）。
  update public.turns set status = 'done' where id = p_expected_turn_id;

  return query select true, v_live;
end;
$$;

grant execute on function public.host_advance_answering_to_group_result(uuid, uuid, timestamptz) to authenticated;
revoke execute on function public.host_advance_answering_to_group_result(uuid, uuid, timestamptz) from public;
revoke execute on function public.host_advance_answering_to_group_result(uuid, uuid, timestamptz) from anon;

-- ============================================================
-- 2) group_result → 次のtopic_reveal（次ターンの特定・active化 + lives更新を
--    1トランザクションで）。次ターンが無ければfinal_resultへ進める。
-- ============================================================
create function public.host_advance_group_result_to_next(
  p_live_id uuid,
  p_expected_turn_id uuid,
  p_topic_reveal_deadline timestamptz
)
returns table (updated boolean, advanced_to text, live public.lives)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_next_turn_id uuid;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::text, null::public.lives;
    return;
  end if;

  if v_live.current_phase <> 'group_result' or v_live.current_turn_id is distinct from p_expected_turn_id then
    -- 既に別のタブが遷移済み。エラーにはしない。
    return query select false, null::text, v_live;
    return;
  end if;

  -- round → group.group_order の順に並べた次のturnを、DB側の最新のturns/groups
  -- から直接求める（JS側でクライアントのキャッシュしたturns/groupsを使わない）。
  select next_id into v_next_turn_id
  from (
    select t.id, lead(t.id) over (order by t.round asc, g.group_order asc) as next_id
    from public.turns t
    join public.groups g on g.id = t.group_id
    where t.live_id = p_live_id
  ) ordered
  where ordered.id = p_expected_turn_id;

  if v_next_turn_id is not null then
    update public.lives
      set current_turn_id = v_next_turn_id,
          current_phase = 'topic_reveal',
          phase_deadline = p_topic_reveal_deadline,
          answering_paused = false,
          answering_remaining_ms = null
      where id = p_live_id
      returning * into v_live;

    -- turnsの更新が失敗した場合、直前のlives更新も含めて全体がロールバックされる。
    update public.turns set status = 'active' where id = v_next_turn_id;

    return query select true, 'topic_reveal'::text, v_live;
  else
    update public.lives
      set current_phase = 'final_result',
          phase_deadline = null
      where id = p_live_id
      returning * into v_live;

    return query select true, 'final_result'::text, v_live;
  end if;
end;
$$;

grant execute on function public.host_advance_group_result_to_next(uuid, uuid, timestamptz) to authenticated;
revoke execute on function public.host_advance_group_result_to_next(uuid, uuid, timestamptz) from public;
revoke execute on function public.host_advance_group_result_to_next(uuid, uuid, timestamptz) from anon;

commit;
