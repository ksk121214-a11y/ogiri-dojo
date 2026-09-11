-- 再レビュー対応（撤回・修正）：
-- 当初この番号では「ホスト専用RPC host_send_bot_tsukkomi に、司会クライアントが
-- 代理送信者のparticipant_idを渡す」設計を入れていたが、DBには「ボット参加者」を
-- 区別する情報が無いため、この設計だと司会クライアントから対象ライブの任意の
-- 一般参加者（人間）のparticipant_idを指定でき、その人物名義のイベントを
-- INSERTできてしまう（なりすまし）。この0066は未適用のため、既存のマイグレーションを
-- 書き換えず、この番号自体を「host_send_bot_tsukkomi を作らない・既存の
-- send_tsukkomiを強化する」内容に差し替える（0066がもし本番へ適用済みだったと
-- 判明した場合は、この差し替えではなく0067で撤回・修正すること）。
--
-- ボットのツッコミ/爆笑/拍手は、司会クライアントからの代理送信ではなく、
-- 「各ボット本人としてログイン済みのクライアント（useLiveBotStoreのBotSession.client）」
-- から、一般参加者と全く同じ既存の public.send_tsukkomi を呼ぶ方式にする
-- （src/store/useLiveHostStore.ts）。participant_idはDB側がauth.uid()から一意に
-- 特定するため、呼び出し側が参加者IDを指定する余地が無く、他人（一般参加者）への
-- なりすましは構造的に不可能になる。この方式ではhost専用RPCは不要。
--
-- 併せて、0044のsend_tsukkomiは「参加者として存在すること」と「レート制限」しか
-- 見ておらず、退場済み参加者や、回答受付中でないフェーズからの送信を防いでいなかった
-- ため、以下を追加でDB側必須にする（人間の観客・回答者どちらも送信できる既存仕様は
-- 維持し、role='player'限定にはしない）。
--   - 対象ライブが存在すること
--   - lives.current_phase = 'answering' であること
--   - 呼び出し元の参加者行が kicked_at is null であること（退場済みは拒否）
--   - kind/textはNULLを含め既存の許可リストに完全一致すること（NULLも明示的に拒否）
--   - 参加者行をFOR UPDATEしたままレート制限判定〜更新までをアトミックに行う
-- SECURITY DEFINER・固定search_path・PUBLIC/anonへのEXECUTE明示的REVOKE・
-- authenticatedのみEXECUTE可・live_tsukkomi_eventsへの直接INSERT禁止は維持する。
--
-- 2026-09-16（再レビュー対応・問題2）：上のcurrent_phase確認は当初、対象live行を
-- ロックしない普通のSELECTで行っていたため、確認直後（participantsのFOR UPDATE〜
-- INSERTまでの間）に別トランザクション（host_advance_answering_to_group_result等、
-- 0065参照）がlives行をFOR UPDATEしてanswering→group_resultへ進めてコミットすると、
-- こちらはその変化に一切気付けないまま「まだanswering」の前提でINSERTを完了させて
-- しまう（フェーズ確認とINSERTがアトミックでない）。対象live行もFOR UPDATEで
-- ロックし、コミットまで保持することで、同時に走る他のトランザクションのフェーズ
-- 変更（それらも同じlives行をFOR UPDATEしてから更新する、0018/0065等と同じ規約）は
-- こちらのロック解放を待つようになり、確認からINSERT完了まで割り込めなくする。
-- ロック順序：本関数はlives→participantsの順で1回ずつ取得するだけで、他のロックを
-- 取り直すことはない。既存RPC群を確認した限り、lives・participantsの両方を
-- FOR UPDATEする関数は本関数以外に無く（host系RPCはlivesのみ、kick_participant等は
-- participantsのみ）、かつ本関数はlivesを先に取るため、双方向の取り合いによる
-- デッドロックは起きない。

create or replace function public.send_tsukkomi(p_live_id uuid, p_kind text, p_text text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_participant_id uuid;
  v_kicked_at timestamptz;
  v_last timestamptz;
begin
  -- kind/textの組み合わせは、実際に画面のボタンから送られる定型文と完全一致させる。
  -- NULLはどの組み合わせとも一致しない（`(NULL, NULL) not in (...)`はNULLになり
  -- if文はfalse扱いされて通ってしまう）ため、明示的に先に弾く。
  if p_kind is null or p_text is null then
    raise exception 'INVALID_TSUKKOMI';
  end if;

  if (p_kind, p_text) not in (
    ('stamp', 'なんでやねん'),
    ('stamp', 'そうはならんやろ'),
    ('stamp', 'ちょっと待って'),
    ('stamp', 'それは無理あるて'),
    ('stamp', '爆笑'),
    ('clap', '👏')
  ) then
    raise exception 'INVALID_TSUKKOMI';
  end if;

  -- 対象ライブが存在し、回答受付中であること。for updateでロックし、この
  -- トランザクションがコミットするまで他のフェーズ変更（host_advance_*系、
  -- 0065参照）を待たせることで、フェーズ確認からINSERT完了までをアトミックにする
  -- （フェーズ確認直後に別トランザクションがanswering以外へ進めてしまい、
  -- 既にanswering中でなくなったライブへイベントがINSERTされる、という競合を防ぐ）。
  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;
  if v_live.current_phase <> 'answering' then
    raise exception 'LIVE_NOT_SENDABLE';
  end if;

  select p.id, p.kicked_at, p.last_tsukkomi_at
    into v_participant_id, v_kicked_at, v_last
    from public.participants p
    where p.live_id = p_live_id and p.user_id = auth.uid()
    for update;

  if v_participant_id is null then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  if v_kicked_at is not null then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  if v_last is not null and now() - v_last < interval '1 second' then
    raise exception 'RATE_LIMITED';
  end if;

  update public.participants set last_tsukkomi_at = now() where id = v_participant_id;

  insert into public.live_tsukkomi_events (live_id, participant_id, kind, text)
    values (p_live_id, v_participant_id, p_kind, p_text);
end;
$$;

-- 0044と同じくauthenticatedのみ実行可。PUBLIC/anonは明示的にREVOKEしたままにする
-- （create or replaceは権限設定を引き継ぐが、意図を明文化するため再度宣言する）。
revoke execute on function public.send_tsukkomi(uuid, text, text) from public;
revoke execute on function public.send_tsukkomi(uuid, text, text) from anon;
grant execute on function public.send_tsukkomi(uuid, text, text) to authenticated;
