// 未参加者（観客参加前）に、各フェーズでどの画面・参加ボタンを出すか。
//  entering：観客参加ボタンを押した直後（join_live完了待ち）。押せる参加ボタンは出さない。
//  join-prompt：お題・タイマーと中央の参加ボタン（直接アクセス・自動参加の失敗時の再試行）。
//  panel：結果画面の下に、通常の流れの中で置く中央の参加ボタン（画面下に固定しない）。
export type AudienceJoinView = "normal" | "entering" | "join-prompt";

export function planAudienceJoinUi(p: {
  phase: string;
  hasParticipant: boolean;
  entering: boolean;
}): { view: AudienceJoinView; panel: boolean } {
  if (p.hasParticipant) return { view: "normal", panel: false };
  switch (p.phase) {
    case "answering":
      return { view: p.entering ? "entering" : "join-prompt", panel: false };
    case "opening":
      return { view: p.entering ? "entering" : "normal", panel: false };
    case "topic_reveal":
      return { view: p.entering ? "normal" : "join-prompt", panel: false };
    case "group_result":
    case "awaiting_round_decision":
    case "final_result":
      return { view: "normal", panel: !p.entering };
    default:
      return { view: "normal", panel: false };
  }
}

// 組結果の「爆笑発生：N件」（0件以下は表示しない）。
export function laughCountLabel(count: number): string | null {
  return count > 0 ? `爆笑発生：${count}件` : null;
}
