// ライブ準備でのお題必要数（組数×周回数）と、不足・超過の日本語案内。
// DB側の判定（supabase/migrations/0084 create_live_preparation）と同じ式にすること。
export function requiredTopicCount(groupCount: number, roundsPerLive: number): number {
  return groupCount * roundsPerLive;
}

// ランダム選択：お題バンクの件数が必要数に足りないかを判定し、不足時は案内文を返す。
export function randomTopicShortageMessage(required: number, available: number): string | null {
  if (available >= required) return null;
  return `お題バンクが不足しています。あと${required - available}件必要です（必要${required}件）。`;
}

// 手動選択：選択数が必要数とちょうど一致しているかを判定し、ずれていれば案内文を返す。
export function manualTopicSelectionMessage(required: number, selected: number): string | null {
  if (selected === required) return null;
  if (selected < required) return `あと${required - selected}件選んでください（必要${required}件）。`;
  return `${selected - required}件多く選んでいます（必要${required}件）。`;
}
