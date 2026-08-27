// 実Supabaseの本番ライブ用テーブル行そのままの型定義。
// src/types/liveDemo.ts（ローカルモック用のcamelCase型）とは完全に分離し、
// 動いている/live-demoのモックには一切手を触れない。

export type LivePhase =
  | "scheduled"
  | "interlude"
  | "opening"
  | "topic_reveal"
  | "answering"
  | "group_result"
  | "final_result"
  | "closed";

export interface LiveRow {
  id: string;
  scheduled_at: string;
  rounds_per_live: number;
  current_phase: LivePhase;
  current_turn_id: string | null;
  // フェーズ同期用（フェーズA追加分）。
  phase_deadline: string | null;
  answering_paused: boolean;
  answering_remaining_ms: number | null;
  // 採点確定後の演出シーケンス（フリップが消える→間を置く→玉が消える→得点表示→
  // しばらく見せる→間を置く）が終わるまでの締切時刻（2026-08-16追加）。
  reveal_sequence_until: string | null;
  created_at: string;
}

export interface GroupRow {
  id: string;
  live_id: string;
  group_order: number;
}

export interface TopicRow {
  id: string;
  live_id: string;
  body: string;
  format: "text" | "image_caption";
  created_at: string;
}

export type ParticipantRole = "player" | "audience";

export interface ParticipantRow {
  id: string;
  live_id: string;
  user_id: string;
  group_id: string | null;
  role: ParticipantRole;
  preferred_role: ParticipantRole;
  joined_at: string;
}

export type TurnStatus = "pending" | "active" | "done";

export interface TurnRow {
  id: string;
  live_id: string;
  round: number;
  group_id: string;
  topic_id: string;
  status: TurnStatus;
}

export interface AnswerRow {
  id: string;
  turn_id: string;
  live_id: string;
  participant_id: string;
  seq: number;
  body: string;
  score_total: number;
  top_score_votes: number;
  judge_count: number;
  laugh_triggered: boolean;
  revealed_at: string | null;
  judging_ends_at: string | null;
  resolved: boolean;
  created_at: string;
}

export interface ScoreRow {
  answer_id: string;
  judge_participant_id: string;
  points: 0 | 1 | 2 | 3;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  display_name: string;
  display_name_set: boolean;
  x_username: string | null;
  avatar_url: string | null;
  is_host: boolean;
}
