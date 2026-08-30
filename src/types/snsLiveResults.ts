// 寄合帳「ライブ結果」タブで扱う表示用の型。
// DBの生データ(sns_live_results/sns_live_result_answers等)をそのまま画面に渡さず、
// 一覧カード・詳細ページそれぞれに必要な形へ整形したものをストア側で組み立てる。

export interface SnsLiveResultSummary {
  id: string; // sns_live_results.id
  liveId: string;
  sequenceNumber: number;
  title: string | null;
  endedAtLabel: string;
  // 1位の最高得点回答のプレビュー（同点が複数ある場合は先頭の1件のみ）。0件なら null。
  topAnswerPreview: string | null;
  perfectCount: number;
  likeCount: number;
  commentCount: number;
}

export type SnsLiveResultLabel = "rank1" | "rank2" | "rank3" | "managerBest" | "perfect";

export interface SnsLiveResultAnswerCard {
  // sns_live_result_answers.id（いいね・コメントの紐付け先）。
  resultAnswerId: string;
  answerId: string;
  authorId: string; // 実プロフィールUUID、または閲覧者本人なら"me"
  topicBody: string | null;
  body: string;
  score: number;
  labels: SnsLiveResultLabel[];
  likes: number;
  liked: boolean;
  commentCount: number;
}

export interface SnsLiveResultComment {
  id: string;
  resultAnswerId: string;
  authorId: string;
  body: string;
  createdAtLabel: string;
}

export interface SnsLiveResultDetail {
  id: string; // sns_live_results.id
  liveId: string;
  sequenceNumber: number;
  title: string | null;
  endedAtLabel: string;
  managerComment: string | null;
  // rank1/2/3ごとにグルーピングした代表カード（同点なら複数枚）。
  podium: { rank: 1 | 2 | 3; cards: SnsLiveResultAnswerCard[] }[];
  managerBest: SnsLiveResultAnswerCard | null;
  // 1〜3位代表と重複するカードは除いた、満点のみのカード一覧。
  perfect: SnsLiveResultAnswerCard[];
  comments: Record<string, SnsLiveResultComment[]>; // key: resultAnswerId
}
