// 「大喜利道場」ライブ体験モックの型定義。
// 仕様書.md §15 のデータモデルをベースに、ローカルモック用に簡略化したもの。
// Supabase接続時はこれらの型をベースにテーブル定義へ寄せていく想定。

export type LivePhase =
  | "interlude" // 幕間演出（暗転→タイトル）§13
  | "opening" // 組分け発表 §13 / L2
  | "topic_reveal" // お題発表 §1.5
  | "answering" // 回答（持ち時間120秒、審査サイクルはjudgingで管理）
  | "group_result" // 組結果発表 L5
  | "final_result" // 最終結果・個人表彰 L6
  | "closed"; // 閉幕

export interface DemoParticipant {
  id: string;
  displayName: string;
  isTestUser: boolean;
  groupId: string;
}

export interface DemoGroup {
  id: string;
  order: number; // 出番順（1始まり）
  memberIds: string[];
}

export interface DemoTopic {
  id: string;
  body: string;
}

// 組×周の1登壇（仕様書 Turn 相当）
export interface DemoTurn {
  id: string;
  round: number; // 何周目（1始まり）
  groupId: string;
  groupOrder: number;
  topicId: string;
}

export interface DemoAnswer {
  id: string;
  turnId: string;
  groupId: string;
  participantId: string;
  seq: number; // その人のその組での何回目（1..maxAnswersPerPlayer）
  body: string;
  scoreTotal: number; // 確定後に集計（採点中は0）
  twoPointVotes: number;
  judgeCount: number; // 採点対象になった時点の審査員母数
  laughTriggered: boolean;
  createdAt: number;
}

export interface DemoScore {
  answerId: string;
  judgeParticipantId: string;
  points: 0 | 1 | 2;
}

// 送信ごとの審査サイクル（answering中のサブ状態）
export interface JudgingState {
  answerId: string;
  endsAt: number; // 採点締切（ローカル時刻ベース。本来はサーバ基準時刻で同期 §1.4）
  judgeCount: number;
}
