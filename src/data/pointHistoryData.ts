// ヘッダーのポイント表示から開く「獲得履歴」のダミーデータ。
// 実際のポイント増減ロジック（表彰ボーナス等）と直接は連動していない参考表示用。
export interface PointHistoryEntry {
  id: string;
  label: string;
  amount: number; // 正=獲得、負=消費
  dateLabel: string;
}

export const POINT_HISTORY: PointHistoryEntry[] = [
  { id: "ph-1", label: "第12回ライブ 1位表彰ボーナス", amount: 300, dateLabel: "2026年7月6日" },
  { id: "ph-2", label: "第12回ライブ ベストアンサー", amount: 100, dateLabel: "2026年7月6日" },
  { id: "ph-3", label: "第12回ライブ 参加賞", amount: 30, dateLabel: "2026年7月6日" },
  { id: "ph-4", label: "くじ引き", amount: -100, dateLabel: "2026年7月2日" },
  { id: "ph-5", label: "第11回ライブ 3位表彰ボーナス", amount: 100, dateLabel: "2026年6月29日" },
  { id: "ph-6", label: "第11回ライブ 参加賞", amount: 30, dateLabel: "2026年6月29日" },
];
