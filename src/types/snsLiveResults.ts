// 寄合帳「ライブ結果」タブで扱う表示用の型。
// DBの生データ(sns_live_results/sns_live_result_answers等)をそのまま画面に渡さず、
// 一覧カード・詳細ページそれぞれに必要な形へ整形したものをストア側で組み立てる。

export interface SnsLiveResultSummary {
  id: string; // sns_live_results.id
  liveId: string;
  sequenceNumber: number;
  title: string | null;
  endedAtLabel: string;
  // 1〜3位の該当者全員（同順位タイなら全員分、1エントリ=1参加者。そのライブに
  // 該当順位の参加者がいない順位は含まれない）。participantIdは、同じ表示名の
  // 別参加者を誤って同一視しないための本人識別用（Reactのkeyにも使う）。
  podiumNames: { rank: 1 | 2 | 3; participantId: string; name: string }[];
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
  // 参加者本人を識別するID（表示名が同じ別参加者の取り違え防止・グルーピング用）。
  participantId: string;
  topicId: string | null;
  topicBody: string | null;
  body: string;
  score: number;
  // sns_live_result_answers.created_at（結果データに記録された保存順。同点時の
  // 安定した並び替えの基準として使う。Supabaseの暗黙の返却順には依存しない）。
  createdAt: string;
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

// お題ごとのブロック（同じ参加者・同じお題の回答をまとめたもの）。
export interface SnsLiveResultTopicGroup {
  topicId: string | null;
  topicBody: string | null;
  // このお題でのこの参加者の回答点合計（お題ブロックの並び順に使う）。
  totalScore: number;
  // score降順・同点時は結果データの保存順で安定ソート済み。
  cards: SnsLiveResultAnswerCard[];
}

// 参加者ごとのブロック（同順位の中での1人分。その人のお題ブロックを束ねる）。
export interface SnsLiveResultParticipantGroup {
  participantId: string;
  authorId: string;
  topics: SnsLiveResultTopicGroup[];
}

export interface SnsLiveResultDetail {
  id: string; // sns_live_results.id
  liveId: string;
  sequenceNumber: number;
  title: string | null;
  endedAtLabel: string;
  managerComment: string | null;
  // 順位→参加者→お題→回答カード、の階層でグルーピング済み（同順位なら複数参加者）。
  podium: { rank: 1 | 2 | 3; participants: SnsLiveResultParticipantGroup[] }[];
  managerBest: SnsLiveResultAnswerCard | null;
  // 1〜3位代表と重複するカードは除いた、満点のみのカード一覧。
  perfect: SnsLiveResultAnswerCard[];
  comments: Record<string, SnsLiveResultComment[]>; // key: resultAnswerId
}
