// 2026-09-22（最終結果画面のポイント表示分離）：最終結果画面の「今回の獲得」と
// 「獲得ポイント」が同じ数字になっていた問題を修正するため、内訳を1箇所の純粋関数に
// まとめる。数式はsupabase/migrations/0071_guest_hardening.sqlのapply_live_rank_rewards
// （10 + total_score + rankBonus(100/60/30/0)）と完全に一致させ、DBへ実際に加算される
// 値（totalPoints）と画面のプレビュー表示が食い違わないようにする。
import { MASTERY_GAIN } from "@/data/collectionData";

export interface PointBreakdown {
  // 大喜利の回答・採点だけで獲得した点数（参加ポイント・順位ボーナスを含まない）。
  ogiriPoints: number;
  // 参加ポイント（現状10pt固定）。
  participationPoints: number;
  // 順位ボーナス（1位100pt・2位60pt・3位30pt・4位以下0pt）。
  rankBonusPoints: number;
  // 上記3つの合計。DBへ実際に加算される最終合計値（mastery_meter/total_points/points_balance）。
  totalPoints: number;
}

export function computeRankBonusPoints(rank: number | null): number {
  if (rank === 1) return MASTERY_GAIN.rankBonus.first;
  if (rank === 2) return MASTERY_GAIN.rankBonus.second;
  if (rank === 3) return MASTERY_GAIN.rankBonus.third;
  return 0;
}

export function computePointBreakdown(ogiriPoints: number, rank: number | null): PointBreakdown {
  const participationPoints = MASTERY_GAIN.participation;
  const rankBonusPoints = computeRankBonusPoints(rank);
  return {
    ogiriPoints,
    participationPoints,
    rankBonusPoints,
    totalPoints: ogiriPoints + participationPoints + rankBonusPoints,
  };
}
