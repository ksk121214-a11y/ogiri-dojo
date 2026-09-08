// answering_cues（回答本文を含まない発表待ち合図。supabase/migrations/0063参照）の
// クライアント側での「新旧判定」を一箇所にまとめた純粋関数。
// src/store/useLiveFollowerStore.tsから、
//   1. fetchAnsweringCue()による再取得結果の反映
//   2. answering_cuesのRealtimeイベント受信
// の両方から呼ぶ。この2経路は別々の非同期処理であり、どちらが先に完了するかは
// 保証されない（古い再取得が新しいRealtimeイベントの後に完了して上書きする、
// または逆に最新の再取得の後に遅延した古いRealtimeイベントが届いて巻き戻す、
// という新旧逆転が起こり得る）。判定をこの1箇所にまとめないと、2経路で
// 判定がずれ、回答席の点灯・送信ボタンのロック・送信音・pendingParticipantId・
// busy状態が端末ごとにずれてしまう。
//
// supabase/migrations/0063のanswering_cues.revisionは、
// recompute_answering_cue_for_turn()のUPSERTのたびに単調増加する
// （1ライブにつき1行=PK live_idのため、ターンが変わってもリセットされない）。

export interface AnsweringCueSnapshot {
  liveId: string;
  turnId: string;
  pendingParticipantId: string | null;
  busy: boolean;
  revision: number;
}

/**
 * 現在保持しているcue(current)に対し、新しく届いた情報(incoming。該当ライブの
 * cueが存在しない場合はnull)を反映してよいかどうかを判定し、採用すべき値を返す。
 *
 * 比較ルール：
 * - currentが無ければ、常にincomingを採用する。
 * - incomingLiveId（今回の情報が属するライブ）がcurrent.liveIdと異なれば、
 *   incomingがnullであっても無条件に採用する（別ライブへの切り替え。
 *   前ライブの大きなrevisionに新ライブの値が邪魔されないようにするため、
 *   revisionの大小に関係なく必ずliveIdを先に見る）。
 * - incomingLiveIdが同じで、incomingがnullなら採用する（該当ライブの
 *   cueが無くなった＝クリアする）。
 * - incomingLiveIdが同じで、incomingがある場合は、
 *   incoming.revision >= current.revision の場合だけ採用し、
 *   それ未満（古いrevision）は無視して現在値を保つ。
 */
export function resolveAnsweringCue(
  current: AnsweringCueSnapshot | null,
  incomingLiveId: string,
  incoming: AnsweringCueSnapshot | null,
): AnsweringCueSnapshot | null {
  if (!current) return incoming;
  if (incomingLiveId !== current.liveId) return incoming;
  if (!incoming) return null;
  return incoming.revision >= current.revision ? incoming : current;
}
