// 「爆笑スタジアム」ライブ体験モックの型定義。
// 仕様書.md §15 のデータモデルをベースに、ローカルモック用に簡略化したもの。
// Supabase接続時はこれらの型をベースにテーブル定義へ寄せていく想定。

export type LivePhase =
  | "interlude" // 幕間演出（暗転→タイトル）§13
  | "opening" // 組分け発表 §13 / L2
  | "topic_reveal" // お題発表 §1.5
  | "answering" // 回答（持ち時間90秒＝本番standard。審査サイクルはjudgingで管理）
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
  topScoreVotes: number; // 最高点（3点）を付けた審査員数。過半数で笑いエフェクト発生（2026-07-14改訂：0〜2点の3段階→0〜3点の4段階に変更）
  judgeCount: number; // 採点対象になった時点の審査員母数
  // 採点開始時点で評価権を持つ全員のID（回答者本人・組に出ている人は含まない）。未評価者もここに残す（0点扱い）
  eligibleJudgeIds: string[];
  laughTriggered: boolean;
  createdAt: number;
}

export interface DemoScore {
  answerId: string;
  judgeParticipantId: string;
  points: 0 | 1 | 2 | 3;
}

// 送信ごとの審査サイクル（answering中のサブ状態）
export interface JudgingState {
  answerId: string;
  endsAt: number; // 採点締切（ローカル時刻ベース。本来はサーバ基準時刻で同期 §1.4）
  judgeCount: number;
}

// 送信〜実際の回答表示の間に置く「一呼吸」の間（送信直後・前の審査サイクル終了直後の両方で使う）。
// この間はまだDemoAnswerを作らず、画面には何も表示しない（前の回答は消えた後、まだ次が出ていない状態）。
// seq は送信時に確定する回答番号。実ライブは送信（DB登録）の時点で「残り○回」が減るため、
// 回数はフリップではなくこの時点で数える。
export interface RevealPending {
  // 回答の合図（送信の瞬間に1つ作る）。送信音と回答席の点灯の音を、この1つの合図で1回だけ鳴らす
  cueId: string;
  participantId: string;
  body: string;
  seq: number;
  revealAt: number;
}
