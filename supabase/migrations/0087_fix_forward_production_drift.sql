-- fix-forward migration：工程A-R2の本番schema監査で見つかった、0001〜0086のうち
-- 5件のMigration（0012/0014/0058/0062/0064）が本番に一部しか反映されていなかった
-- drift（ズレ）を是正する。対象はすべて「既にローカル0001〜0086では正しく定義
-- されている内容」であり、新しい仕様変更は一切含まない。再実行しても安全な
-- 冪等構成にし、途中で失敗した場合に半端な状態を残さないよう単一トランザクションに
-- まとめる。
--
-- 本migrationは本番・ステージングのいずれにも未適用（ローカルでのみ作成・検証）。
--
-- 【是正対象と根拠（A-R2調査で確認済み）】
-- 1) scores：0012が意図した「採点は一発勝負（投票後は本人でも変更不可）」が
--    本番では未反映で、審査員が提出済み採点を事後にUPDATEできる状態だった。
-- 2) sns_comments：0058が意図した「直接INSERTを廃止しsubmit_sns_comment RPC
--    （寄合券消費と同一トランザクション）経由のみに限定」が本番では未反映で、
--    寄合券を消費せず直接コメント投稿できる状態だった。
-- 3) answers：0014が意図した「冗長な旧indexの削除」が本番では未反映で、新旧
--    両方のindexが残っていた（実害は無いが、意図した最終状態との不一致）。
-- 4) recompute_answering_cue_for_turn：0064が意図した最終ロジック
--    （resolved=false基準）が本番では未反映で、0063時点の旧ロジック
--    （revealed_at is null基準）のままだった。
-- 5) function ACL：0062が意図した「今後作成する関数のEXECUTEをPUBLICへ既定で
--    付与しない」が、本番では一部しか反映されていなかった（0063のコード内
--    コメントの通り、0062の「in schema public」付きの構文は新規関数に効かず、
--    0063のglobal構文で是正されているが、本番でこのglobal構文がどの時点まで
--    正しく定着していたかは監査から確認できなかった）。個別に見つかった
--    log_share_click・set_live_schedule_role・current_legal_document_versions・
--    handle_profile_pre_deletionの4関数だけでなく、public schema内の全関数を
--    動的に走査し、意図しないPUBLIC／anon実行権限をすべて洗い出して塞ぐ。

begin;

-- ============================================================
-- 0) default privilegesの再収束（0062/0063参照）。
--    ALTER DEFAULT PRIVILEGESは何度実行しても安全・冪等。
-- ============================================================
alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges
  revoke execute on functions from public;

-- ============================================================
-- 1) scores：一発勝負の採点(0012)の是正。
--    INSERT・SELECTの既存権限・ポリシーは変更しない。
-- ============================================================
drop policy if exists "scores_update_own_as_player" on public.scores;
revoke update on public.scores from authenticated;

-- ============================================================
-- 2) sns_comments：チケット消費を経由しない直接投稿(0058)の是正。
--    submit_sns_comment RPC経由の投稿、SELECT等の既存権限は変更しない。
-- ============================================================
drop policy if exists "sns_comments_insert_own" on public.sns_comments;

-- ============================================================
-- 3) answers：冗長な旧index(0014)の是正。
--    answers_one_unresolved_per_turn（新・正しい制約）は維持する。
-- ============================================================
drop index if exists public.answers_one_active_per_turn;

-- ============================================================
-- 4) recompute_answering_cue_for_turn：0064が意図した最終定義へ復元。
--    シグネチャ・SECURITY DEFINER・search_path・戻り値・トリガー経路
--    （_answers_sync_answering_cue/_lives_sync_answering_cue）との互換性は
--    0064と完全に同一（本体のみ0064の内容をそのまま再適用）。
-- ============================================================
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

  -- 0064での変更点：「revealed_atがまだnullの回答」（＝未発表）ではなく、
  -- 「resolved=falseの回答」（＝未発表・審査中を問わず、まだ採点確定していない回答）を
  -- pending_participant_idの対象にする。
  select participant_id into v_pending
    from public.answers
    where turn_id = p_turn_id and resolved = false
    order by created_at asc
    limit 1;

  v_busy := v_pending is not null;

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

revoke execute on function public.recompute_answering_cue_for_turn(uuid) from public, anon, authenticated;

-- ============================================================
-- 5) function ACLの一括収束（動的スイープ）。
--    個別に見つかった4件だけでなく、public schema内の全関数を対象に、
--    意図しないPUBLIC実行権限、およびv_anon_allow（許可リスト）に無い
--    anon実行権限をすべて洗い出して塞ぐ。authenticatedは一切対象にしない
--    ため、既存の正しいauthenticated権限は無条件に保たれる。一方anonは
--    許可リスト以外を一括REVOKEする設計であり、「REVOKEしか行わないから
--    安全」なのではなく、v_anon_allowが実際にクライアントの必須要件
--    （is_host・sns_author_names・sns_result_participant_user_ids、
--    0062/0071で意図的にanon許可された関数）を正しく網羅していることに
--    よって、正規のanonアクセスが保護されている。v_anon_allowに漏れが
--    あれば、その関数のanonアクセスはここで実際に失われる。
-- ============================================================
do $$
declare
  r record;
  -- PUBLIC実行可を明示的に許容する関数（RLSポリシー内部から呼ばれる
  -- 副作用の無い読み取り専用関数。0062で意図的に除外された例外）。
  -- oid::regprocedure::textの表記（引数名を含まず、型だけの正規形式）に
  -- 揃える。pg_get_function_identity_argumentsは引数名を含む表記
  -- （例："p_ids uuid[]"）を返すため、ここでの比較には使わない。
  v_public_allow text[] := array['is_host()'];
  -- anon実行可を明示的に許容する関数（クライアントが未ログインでも
  -- 呼ぶ必要があるもの）。
  v_anon_allow text[] := array[
    'is_host()',
    'sns_author_names(uuid[])',
    'sns_result_participant_user_ids(uuid[])'
  ];
  v_sig text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    v_sig := r.oid::regprocedure::text;

    if has_function_privilege('public', r.oid, 'EXECUTE')
       and not (v_sig = any(v_public_allow)) then
      execute format('revoke execute on function %s from public', r.oid::regprocedure);
    end if;

    if has_function_privilege('anon', r.oid, 'EXECUTE')
       and not (v_sig = any(v_anon_allow)) then
      execute format('revoke execute on function %s from anon', r.oid::regprocedure);
    end if;
  end loop;
end;
$$;

-- ============================================================
-- 6) トリガー専用・内部専用関数：public／anon／authenticatedいずれからも
--    直接実行できない状態を明示する（0062の方針を踏襲した多層防御。上の
--    動的スイープはauthenticatedを対象にしないため、ここで個別に明示する。
--    トリガー発火自体はDML実行者のEXECUTE権限を必要としないため、ここでの
--    revokeはトリガー動作に影響しない）。
-- ============================================================
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_answer_live_id() from public, anon, authenticated;
revoke execute on function public.sns_answer_likes_sync() from public, anon, authenticated;
revoke execute on function public.sns_live_result_likes_sync() from public, anon, authenticated;
revoke execute on function public.current_legal_document_versions() from public, anon, authenticated;
revoke execute on function public.handle_profile_pre_deletion() from public, anon, authenticated;
revoke execute on function public._answers_sync_answering_cue() from public, anon, authenticated;
revoke execute on function public._lives_sync_answering_cue() from public, anon, authenticated;
revoke execute on function public._ping_participants_change() from public, anon, authenticated;
revoke execute on function public._apply_first_live_reward(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._compute_rank_reward_mismatches() from public, anon, authenticated;
revoke execute on function public._guard_notifications_no_guest_target() from public, anon, authenticated;
revoke execute on function public._guard_participants_guest_audience_only() from public, anon, authenticated;
revoke execute on function public._is_guest_identity(uuid, boolean) from public, anon, authenticated;
revoke execute on function public._is_x_login_identity(uuid) from public, anon, authenticated;
revoke execute on function public._live_phase_duration_ms(text, text) from public, anon, authenticated;

commit;
