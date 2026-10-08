// ストアの状態から画面表示用データを組み立てる派生ロジック（選択関数）。

import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import { withRanks, type RoomRankingEntry } from "@/lib/liveRoomSelectors";
import type { LiveDemoState } from "@/store/useLiveDemoStore";
import type { DemoAnswer, DemoGroup, DemoParticipant } from "@/types/liveDemo";

export function getCurrentTurn(state: LiveDemoState) {
  return state.turns[state.currentTurnIndex] ?? null;
}

export function getStageGroup(state: LiveDemoState): DemoGroup | null {
  const turn = getCurrentTurn(state);
  if (!turn) return null;
  return state.groups.find((g) => g.id === turn.groupId) ?? null;
}

export function isMyGroupOnStage(state: LiveDemoState): boolean {
  const stageGroup = getStageGroup(state);
  return !!stageGroup && stageGroup.memberIds.includes(MY_PARTICIPANT_ID);
}

export function getMyParticipant(state: LiveDemoState): DemoParticipant | null {
  return state.participants.find((p) => p.id === MY_PARTICIPANT_ID) ?? null;
}

export function getMyGroup(state: LiveDemoState): DemoGroup | null {
  const me = getMyParticipant(state);
  if (!me) return null;
  return state.groups.find((g) => g.id === me.groupId) ?? null;
}

export function getParticipant(
  state: LiveDemoState,
  id: string,
): DemoParticipant | null {
  return state.participants.find((p) => p.id === id) ?? null;
}

export function getParticipantName(state: LiveDemoState, id: string): string {
  return getParticipant(state, id)?.displayName ?? "???";
}

export function getTopicBody(state: LiveDemoState, topicId: string): string {
  return state.topics.find((t) => t.id === topicId)?.body ?? "";
}

// 投稿順で回答を返す（採点済みでもスコア順に並べ替えない §1.6）
export function getTurnAnswers(state: LiveDemoState, turnId: string): DemoAnswer[] {
  return state.answers
    .filter((a) => a.turnId === turnId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export interface RankingEntry {
  participant: DemoParticipant;
  total: number;
}

// この組・この周のスコア上位（L5 組結果発表用）
export function getGroupTurnRanking(
  state: LiveDemoState,
  turnId: string,
): RankingEntry[] {
  const answers = getTurnAnswers(state, turnId);
  const totals = new Map<string, number>();
  for (const a of answers) {
    totals.set(a.participantId, (totals.get(a.participantId) ?? 0) + a.scoreTotal);
  }
  const stageGroup = state.groups.find((g) =>
    state.turns.find((t) => t.id === turnId)?.groupId === g.id,
  );
  const memberIds = stageGroup?.memberIds ?? [...totals.keys()];
  return memberIds
    .map((id) => ({
      participant: getParticipant(state, id)!,
      total: totals.get(id) ?? 0,
    }))
    .filter((e) => e.participant)
    .sort((a, b) => b.total - a.total);
}

// 個人合計スコア（全ライブ通算）による総合ランキング（L6 最終結果用）
export function getOverallRanking(state: LiveDemoState): RankingEntry[] {
  const totals = new Map<string, number>();
  for (const a of state.answers) {
    totals.set(a.participantId, (totals.get(a.participantId) ?? 0) + a.scoreTotal);
  }
  return state.participants
    .map((p) => ({ participant: p, total: totals.get(p.id) ?? 0 }))
    .sort((a, b) => b.total - a.total);
}

// 本日のベストアンサー（単一回答で最高スコアの一撃 §1.7）
export function getBestAnswer(state: LiveDemoState): DemoAnswer | null {
  if (state.answers.length === 0) return null;
  return [...state.answers].sort((a, b) => {
    if (b.scoreTotal !== a.scoreTotal) return b.scoreTotal - a.scoreTotal;
    return a.createdAt - b.createdAt;
  })[0];
}

export function getScoreForAnswer(state: LiveDemoState, answerId: string) {
  return state.scores.filter((s) => s.answerId === answerId);
}

export function getMyScoreForCurrentJudging(state: LiveDemoState) {
  if (!state.judging) return null;
  return (
    state.scores.find(
      (s) =>
        s.answerId === state.judging?.answerId &&
        s.judgeParticipantId === MY_PARTICIPANT_ID,
    )?.points ?? null
  );
}

// ---------------------------------------------------------------------------
// 実ライブの表示部品（GroupResultView・FinalResultView）へ渡すデータへの変換。
// 同点の順位（rank）は実ライブと同じwithRanks（liveRoomSelectors）で付けるため、
// 体験版だけ別の順位の付け方になることを防ぐ。
// ---------------------------------------------------------------------------

export function toRoomRanking(entries: { participant: DemoParticipant; total: number }[]): RoomRankingEntry[] {
  return withRanks(
    entries.map((e) => ({ participantId: e.participant.id, name: e.participant.displayName, total: e.total })),
  );
}

export function buildGroupResultData(state: LiveDemoState, turnId: string) {
  const turn = state.turns.find((t) => t.id === turnId);
  return {
    round: turn?.round ?? 0,
    groupOrder: turn?.groupOrder ?? 0,
    topicBody: turn ? getTopicBody(state, turn.topicId) : "",
    ranking: toRoomRanking(getGroupTurnRanking(state, turnId)),
    laughCount: state.answers.filter((a) => a.turnId === turnId && a.laughTriggered).length,
  };
}

export function buildFinalResultData(state: LiveDemoState) {
  const ranking = toRoomRanking(getOverallRanking(state));
  return {
    // 実ライブの最終結果画面はベストアンサーを表示しない（FinalResultView参照）
    bestAnswer: null,
    ranking,
    myRank: ranking.find((r) => r.participantId === MY_PARTICIPANT_ID)?.rank ?? null,
  };
}
