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
  // 運営者専用管理画面（第1段階）で追加した予定管理・準備用の列。
  // sequence_numberは「第n回開催」を表す自動連番（liveTicketNo.tsで#0001形式に変換）。
  sequence_number: number;
  title: string | null;
  description: string | null;
  // プレイヤーの最大参加人数。nullなら無制限（従来どおりの挙動）。
  max_players: number | null;
  planned_group_count: number | null;
  reception_starts_at: string | null;
  reception_ends_at: string | null;
  results_published: boolean;
  ended_at: string | null;
  announcement_message: string | null;
  announcement_scope: "player" | "all" | null;
  announcement_sent_at: string | null;
  created_by: string | null;
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
  // 運営者専用管理画面（第1段階）で追加。どのtopic_bank（お題マスター）行から
  // 選ばれたか（手動追加等でnullのこともある）。
  topic_bank_id: string | null;
  // turnsに紐づいた＝参加者に公開済みかどうか。trueになった後の変更は
  // 管理画面側で確認ダイアログを挟む。
  locked: boolean;
}

export interface TopicBankRow {
  id: string;
  body: string;
  format: "text" | "image_caption";
  is_active: boolean;
  created_at: string;
  created_by: string | null;
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
  // 2026-08-30: 司会コンソールからの個別メッセージ（警告用）・退場機能で追加。
  // host_messageは全員向けのlives.announcement_messageとは別に、この参加者
  // 本人の画面にだけ表示する。kicked_atが入っている間はライブへの参加をブロックする。
  host_message: string | null;
  host_message_sent_at: string | null;
  kicked_at: string | null;
}

export type TurnStatus = "pending" | "active" | "done";

export interface TurnRow {
  id: string;
  live_id: string;
  round: number;
  group_id: string;
  topic_id: string;
  status: TurnStatus;
  // 2026-09-03: このターンで採点できる資格を持つ参加者数（自分の組以外のplayer数）。
  // ゲーム開始時にサーバー側で1回だけ確定させる（0049）。ScoringPhysicsBoardの
  // 分母(maxBalls)を全クライアントで一致させるため、各クライアントがその場の
  // participants一覧から都度計算するのをやめ、この値を共通の正として使う。
  eligible_judge_count: number;
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
