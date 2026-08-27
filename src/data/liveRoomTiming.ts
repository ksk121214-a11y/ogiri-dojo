// 実バックエンド版ライブ（/live, /live/host）の進行タイミング。
// src/data/liveDemoData.ts（体験版のため一部短縮している）とは別に、
// 仕様書.md §1.5の実仕様レンジからそれぞれ中央付近の値を採用する。
//
// ローカルの.env.local（gitignore済み、本番/リハには絶対に配らない）で
// NEXT_PUBLIC_LIVE_TIMING_MODE=test を設定すると、通し稽古用に短縮した値になる。
// 未設定なら常に本番相当の値のまま。
const TEST_MODE = process.env.NEXT_PUBLIC_LIVE_TIMING_MODE === "test";

const PRODUCTION_TIMING = {
  interludeMs: 15_000, // 実仕様: 幕間10〜20秒
  openingMs: 45_000, // 実仕様: 開幕30〜60秒
  topicRevealMs: 10_000, // 2026-08-27改訂：22秒→15秒→10秒（テンポ優先、実仕様レンジ15〜30秒は緩和）
  answerMs: 60_000, // 2026-08-27改訂：90秒→60秒
  judgeMs: 10_000, // 実仕様どおり：採点10秒
  judgeGraceMs: 400, // 採点タイマー表示が0になった後の滑り込み猶予
  groupResultMs: 30_000, // 実仕様: 組結果20〜40秒
  // 回答表示前の間。採点確定→弾ける演出→この間→次の回答表示、という流れなので、
  // 弾ける演出(ScoringPhysicsBoardのresolvedPopDelayMs+ポップの尺)より
  // 十分長く、かつ消えた後にも間が感じられる長さにしてある。
  revealDelayMs: 2_200,
  earlyConfirmDelayMs: 350, // 全審査員投票後、締切確定までの猶予（採点ボタンの光る演出用）
  laughEffectMs: 1_100, // 笑いエフェクト（画面フラッシュ＋紙吹雪）の表示時間
  // 採点確定後の演出シーケンス（src/data/liveDemoData.tsのDEMO_TIMINGと同じ役割）。
  // ①回答フリップ・採点ボードを閉じるまでの表示猶予 → ②フリップが消えてから玉が
  // 弾け始めるまでの間 → ③得点を回答席に見せておく時間 → ④点数が消えたあと次の人が
  // 送信できるようになるまでの最後の一呼吸。この一連の間、lives.reveal_sequence_until
  // により全クライアントで送信がロックされる（useLiveHostStore.tsのresolveIfDue参照）。
  revealGraceMs: 2_200,
  ballPopPauseMs: 1_700, // 2026-08-18改訂：1100ms→1700msに延長
  scoreDisplayMs: 3_200, // 2026-08-18改訂：3800ms→3200msに短縮
  gateTailMs: 400,
} as const;

// 通し稽古テスト用の短縮値。回答を実際に打つ・採点ボタンを押す動作は
// 引き続き余裕を持って試せる長さを残し、待つだけのフェーズを中心に縮めている。
const TEST_TIMING = {
  interludeMs: 4_000,
  openingMs: 8_000,
  topicRevealMs: 7_000, // +2秒
  answerMs: 20_000,
  judgeMs: 6_000,
  judgeGraceMs: 400,
  groupResultMs: 6_000,
  // 「評価終了→弾ける演出→間を空けて→次の回答/持ち時間再開」の間隔を
  // テストモードでも本番同様に確保するため、他の項目ほどは短縮しない。
  revealDelayMs: 2_200,
  earlyConfirmDelayMs: 350,
  laughEffectMs: 1_100,
  revealGraceMs: 2_200,
  ballPopPauseMs: 1_700, // 2026-08-18改訂：1100ms→1700msに延長
  scoreDisplayMs: 3_200, // 2026-08-18改訂：3800ms→3200msに短縮
  gateTailMs: 400,
} as const;

export const LIVE_ROOM_TIMING = TEST_MODE ? TEST_TIMING : PRODUCTION_TIMING;

// ScoringPhysicsBoard.tsxのPOP_DURATION_MSと同じ値。liveDemoData.tsと同じ理由で、
// コンポーネントに依存しないこのファイルへは値を複製している（変更時は両方直すこと）。
const BALL_POP_ANIM_MS = 320;

// 確定(resolved)から、回答席への得点表示を始めるまでの経過時間。
export const SCORE_REVEAL_DELAY_MS =
  LIVE_ROOM_TIMING.revealGraceMs + LIVE_ROOM_TIMING.ballPopPauseMs + BALL_POP_ANIM_MS;

// 確定(resolved)から、次の人が送信できるようになるまでの一連の流れ全体の長さ。
// lives.reveal_sequence_untilはこの値を使う。
export const REVEAL_SEQUENCE_MS =
  SCORE_REVEAL_DELAY_MS + LIVE_ROOM_TIMING.scoreDisplayMs + LIVE_ROOM_TIMING.gateTailMs;

export const MAX_ANSWERS_PER_PLAYER = 5;
export const ROUNDS_PER_LIVE_DEFAULT = 1; // 2026-08-27改訂：2周→1周
