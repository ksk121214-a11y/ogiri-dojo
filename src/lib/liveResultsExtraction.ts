// 「ライブ結果」(寄合帳掲載)の自動抽出ロジック。
// 順位・満点はDBに保存されていない（0001の採点方式のまま：0〜3点、審査対象は
// 別組プレイヤー全員）ため、運営がライブ結果管理画面を開くたびにここで動的に
// 再計算する。固定の満点定数は使わず、既存システムの「judge_count（採点対象者数）と
// top_score_votes（満点票数）が一致」を満点判定に使う。
//
// 純粋関数のみで構成し、DBアクセスは行わない（呼び出し側でturns/answers/participants/
// scoresを取得してから渡す）。src/lib/liveRoomSelectors.tsのgetOverallRanking()を
// そのまま再利用し、最終結果発表画面と同じ順位ロジックで1〜3位を決める。
import { getOverallRanking } from "@/lib/liveRoomSelectors";
import type { AnswerRow, ParticipantRow } from "@/lib/liveRoomTypes";

export type PodiumRank = 1 | 2 | 3;

export interface PodiumGroup {
  rank: PodiumRank;
  participantId: string;
  // 最高得点と同点の回答すべて（1件のことが多いが、同点なら複数件になる）。
  answers: AnswerRow[];
}

// その回答を採点した審査員全員が、システム上の最高点(0〜3点スケールの3点)を
// 付けたかどうか。固定の点数を決め打ちせず、既存の採点データ（judge_count=採点対象者数、
// top_score_votes=満点票数）だけで判定する。
export function isPerfectAnswer(answer: AnswerRow): boolean {
  return answer.judge_count > 0 && answer.top_score_votes === answer.judge_count;
}

// ライブ全体のresolved(確定済み)なプレイヤー回答から、最終順位1〜3位の参加者を決める。
// 同点の扱い・並び順はgetOverallRanking()（最終結果発表画面と同一ロジック）に従う。
// 2026-09-03:「上位3順位に同点で4人以上いる場合、一部が抽出から漏れる」不具合を修正。
// 以前はranking.slice(0,3)で配列の先頭3件（＝配列の"位置"）を切り出していたため、
// 例えば1位が2人同点の場合、3人目（実際には2位）が漏れていた。getOverallRanking()が
// 既に確定させているrank（同点は同じ順位、liveRoomSelectors.tsのwithRanks参照）を見て、
// rank<=3の該当者を人数に関わらず全員含める。
export function getPodiumParticipantIds(
  resolvedAnswers: AnswerRow[],
  participants: ParticipantRow[],
): string[] {
  const ranking = getOverallRanking(resolvedAnswers, participants, {});
  return ranking.filter((r) => r.rank <= 3).map((r) => r.participantId);
}

// 指定した参加者の、そのライブ中の最高得点回答をすべて返す（同点ならすべて）。
function getMaxScoreAnswers(resolvedAnswers: AnswerRow[], participantId: string): AnswerRow[] {
  const own = resolvedAnswers.filter((a) => a.participant_id === participantId);
  if (own.length === 0) return [];
  const maxScore = Math.max(...own.map((a) => a.score_total));
  return own.filter((a) => a.score_total === maxScore);
}

// 1〜3位それぞれの最高得点回答（同点はすべて）をまとめて返す。
// 参加プレイヤーが3人未満のライブでは、存在する順位分だけ返す。
// 2026-09-03: 以前は配列の位置(index)からranks[index]で1位・2位・3位を付け直して
// おり、同点順位（例：1位が2人）と矛盾していた（2人とも1位のはずが、片方が
// 「2位」にされてしまう）。getOverallRanking()が確定させたrankをそのまま使う。
export function getPodiumGroups(
  resolvedAnswers: AnswerRow[],
  participants: ParticipantRow[],
): PodiumGroup[] {
  const ranking = getOverallRanking(resolvedAnswers, participants, {});
  const groups: PodiumGroup[] = [];
  for (const entry of ranking) {
    if (entry.rank > 3) continue;
    const answers = getMaxScoreAnswers(resolvedAnswers, entry.participantId);
    if (answers.length === 0) continue;
    groups.push({ rank: entry.rank as PodiumRank, participantId: entry.participantId, answers });
  }
  return groups;
}

// ライブ中の満点回答をすべて返す（プレイヤーの回答のみ）。
export function getPerfectAnswers(resolvedAnswers: AnswerRow[]): AnswerRow[] {
  return resolvedAnswers.filter(isPerfectAnswer);
}

// 運営ベストの選択候補：1〜3位代表(同点含む)・満点回答のいずれでもない、
// ライブ中のresolvedなプレイヤー回答すべて。
export function getManagerBestCandidates(
  resolvedAnswers: AnswerRow[],
  participants: ParticipantRow[],
  podiumGroups: PodiumGroup[],
  perfectAnswers: AnswerRow[],
): AnswerRow[] {
  const excludedIds = new Set<string>();
  for (const group of podiumGroups) for (const a of group.answers) excludedIds.add(a.id);
  for (const a of perfectAnswers) excludedIds.add(a.id);

  const playerIds = new Set(participants.filter((p) => p.role === "player").map((p) => p.id));
  return resolvedAnswers.filter((a) => playerIds.has(a.participant_id) && !excludedIds.has(a.id));
}

export interface LiveResultCandidates {
  podiumGroups: PodiumGroup[];
  perfectAnswers: AnswerRow[];
  managerBestCandidates: AnswerRow[];
}

// 上記をまとめて計算する（運営画面・自動抽出の登録処理から呼ぶエントリーポイント）。
export function computeLiveResultCandidates(
  resolvedAnswers: AnswerRow[],
  participants: ParticipantRow[],
): LiveResultCandidates {
  const podiumGroups = getPodiumGroups(resolvedAnswers, participants);
  const perfectAnswers = getPerfectAnswers(resolvedAnswers);
  const managerBestCandidates = getManagerBestCandidates(
    resolvedAnswers,
    participants,
    podiumGroups,
    perfectAnswers,
  );
  return { podiumGroups, perfectAnswers, managerBestCandidates };
}
