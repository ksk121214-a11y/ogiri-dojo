-- バグ修正：回答フリップ表示の瞬間、回答席が一瞬消灯する不具合の修正。
--
-- 【症状】
-- 回答送信 → 回答席点灯 → 回答フリップ表示、という流れの中で、フリップが
-- 表示される瞬間に一度だけ回答席の光が消え、直後にまた点く（ちらつく）。
--
-- 【原因】
-- 0063のrecompute_answering_cue_for_turn()は、answering_cues.pending_participant_idを
-- 「revealed_atがまだnullの回答（＝一番古い未発表回答）」から求めていた。
-- 司会が回答をrevealする（revealed_atを設定する）と、この条件を満たす回答が
-- 無くなるため、pending_participant_idは採点確定より先に一旦nullへ変わる。
-- 一方、フロント側でその回答席の点灯を引き継ぐactiveAnswer（answersテーブルの
-- 再取得、answering_cuesとは別のRealtime経路）の反映はこれより遅れることが
-- あり、両方が揃うまでの短い間だけ
--   activeParticipantId = null（activeAnswerの反映がまだ届いていない）
--   revealPendingParticipantId = null（cueのpending_participant_idが
--     既にnullになっている）
-- の両方がnullになり、回答席の光が一瞬消える。
--
-- 【修正方針】
-- このアプリには「1ターンにつき未確定(resolved=false)の回答は常に高々1件」
-- という制約(answers_one_unresolved_per_turn)がある。pending_participant_idの
-- 判定基準を「revealed_atがnullかどうか（＝未発表かどうか）」ではなく
-- 「resolved=falseかどうか（＝まだ採点確定していないかどうか）」に変えることで、
--   回答送信直後（revealed_at null, resolved false）→ pending_participant_id=回答者, busy=true
--   revealed_at設定後、resolved=falseのまま（審査中）    → pending_participant_id=同じ回答者のまま, busy=true
--   resolved=trueになった時（採点確定）                  → pending_participant_id=null, busy=false
-- という状態遷移になる。reveal（revealed_atの設定）自体はresolved列を変更しない
-- ため、この間pending_participant_idは変化せず、cue側からactiveAnswer側へ
-- 表示の主導権が移る瞬間も同じparticipant_idが途切れない。
--
-- 0063は本番適用済みのため書き換えず、create or replaceで関数本体だけを
-- 差し替える（テーブル定義・RLS・トリガー・列名・戻り値は変更しない。呼び出し側の
-- トリガー関数(_answers_sync_answering_cue/_lives_sync_answering_cue)や、
-- フロントのsrc/lib/answeringCue.ts・useLiveFollowerStore.tsとの互換性もそのまま）。
-- revisionのインクリメント・「現在表示中のターンでなければ何もしない」という
-- 0063のガードも維持する。

begin;

create or replace function public.recompute_answering_cue_for_turn(p_turn_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_live_id uuid;
  v_current_turn_id uuid;
  v_pending uuid;
  v_busy boolean;
begin
  select t.live_id, l.current_turn_id into v_live_id, v_current_turn_id
    from public.turns t
    join public.lives l on l.id = t.live_id
    where t.id = p_turn_id;
  if v_live_id is null then
    return;
  end if;
  if v_current_turn_id is distinct from p_turn_id then
    -- 過去（または未来）のターン：現在表示中のターンではないため何もしない（0063と同じガード）。
    return;
  end if;

  -- 【0064での変更点】「revealed_atがまだnullの回答」（＝未発表）ではなく、
  -- 「resolved=falseの回答」（＝未発表・審査中を問わず、まだ採点確定していない回答）を
  -- pending_participant_idの対象にする。answers_one_unresolved_per_turnにより、
  -- この条件に一致する行は1ターンにつき常に高々1件のため、order by/limitは
  -- 複数該当時の決定性のための保険に過ぎない。
  select participant_id into v_pending
    from public.answers
    where turn_id = p_turn_id and resolved = false
    order by created_at asc
    limit 1;

  -- busyも同じ基準（未確定の回答が存在するか）に揃える。以前の
  -- 「revealed_at is null or (revealed_at is not null and resolved = false)」は、
  -- 通常の運用ではresolved=falseと等価だった（reveal前にresolved=trueになることは
  -- 無いため）が、意味をpending_participant_idの判定と完全に一致させておく。
  v_busy := v_pending is not null;

  -- 新規行はrevision=1（列のdefault）から始まり、既存行を更新するたびに
  -- revisionを+1する（同一ライブ内でターンが変わっても、行はPK=live_idで
  -- 使い回されるため、リセットされず単調に増え続ける。0063参照）。
  insert into public.answering_cues (live_id, turn_id, pending_participant_id, busy, updated_at)
  values (v_live_id, p_turn_id, v_pending, v_busy, now())
  on conflict (live_id) do update
    set turn_id = excluded.turn_id,
        pending_participant_id = excluded.pending_participant_id,
        busy = excluded.busy,
        revision = public.answering_cues.revision + 1,
        updated_at = now();
end;
$$;

-- create or replace functionは既存のACL（GRANT/REVOKE）を保持するが、念のため
-- 明示的に再宣言しておく（0063と同じ多層防御、意図せず緩んでいないことの保証）。
revoke execute on function public.recompute_answering_cue_for_turn(uuid) from public, anon, authenticated;

commit;
