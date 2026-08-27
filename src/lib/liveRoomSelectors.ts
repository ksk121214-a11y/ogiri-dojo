// 実バックエンド版ライブの「組結果発表」「最終結果発表」向け派生ロジック。
// src/lib/liveDemoSelectors.ts（ローカルモック用、useLiveDemoStore依存）と同じ考え方だが、
// DBの行そのままの型を引数で受け取る純粋関数として作り直したもの。
import type { AnswerRow, ParticipantRow } from "@/lib/liveRoomTypes";

export interface RoomRankingEntry {
  participantId: string;
  name: string;
  total: number;
}

// ライブ画面（舞台・客席・結果発表）で表示する参加者名の共通の丸め込み。
// 5文字までは表示し、6文字目以降は省略する（狭いスペースに詰め込むための割り切り）。
export const LIVE_DISPLAY_NAME_MAX_LENGTH = 5;
export function truncateLiveDisplayName(name: string): string {
  return name.length > LIVE_DISPLAY_NAME_MAX_LENGTH
    ? name.slice(0, LIVE_DISPLAY_NAME_MAX_LENGTH)
    : name;
}

// この組・この周のスコア上位（組結果発表用）。turnIdの回答だけを集計対象にする。
export function getGroupTurnRanking(
  answers: AnswerRow[],
  participants: ParticipantRow[],
  turnId: string,
  groupId: string,
  namesByParticipantId: Record<string, string>,
): RoomRankingEntry[] {
  const totals = new Map<string, number>();
  for (const a of answers) {
    if (a.turn_id !== turnId || !a.resolved) continue;
    totals.set(a.participant_id, (totals.get(a.participant_id) ?? 0) + a.score_total);
  }
  const members = participants.filter((p) => p.role === "player" && p.group_id === groupId);
  return members
    .map((p) => ({
      participantId: p.id,
      name: namesByParticipantId[p.id] ?? "（名前未設定）",
      total: totals.get(p.id) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);
}

// 個人合計スコア（このライブ全体）による総合ランキング（最終結果用）。
export function getOverallRanking(
  resolvedAnswers: AnswerRow[],
  participants: ParticipantRow[],
  namesByParticipantId: Record<string, string>,
): RoomRankingEntry[] {
  const totals = new Map<string, number>();
  for (const a of resolvedAnswers) {
    totals.set(a.participant_id, (totals.get(a.participant_id) ?? 0) + a.score_total);
  }
  const players = participants.filter((p) => p.role === "player");
  return players
    .map((p) => ({
      participantId: p.id,
      name: namesByParticipantId[p.id] ?? "（名前未設定）",
      total: totals.get(p.id) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);
}

// 本日のベストアンサー（単一回答で最高スコアの一撃。同点なら早い者勝ち）。
export function getBestAnswer(resolvedAnswers: AnswerRow[]): AnswerRow | null {
  if (resolvedAnswers.length === 0) return null;
  return [...resolvedAnswers].sort((a, b) => {
    if (b.score_total !== a.score_total) return b.score_total - a.score_total;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
}
