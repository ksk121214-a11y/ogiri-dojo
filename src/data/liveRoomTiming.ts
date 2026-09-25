// 実バックエンド版ライブ（/live, /live/host）の進行タイミング。
// src/data/liveDemoData.ts（体験版のため一部短縮している）とは別に、
// 仕様書.md §1.5の実仕様レンジからそれぞれ中央付近の値を採用する。
//
// 2026-09-25（3回目レビュー対応・項目2）：以前はNEXT_PUBLIC_LIVE_TIMING_MODEという
// クライアントのビルド時フラグ「だけ」でSTANDARD/SHORT_TESTを切り替えており、
// DB側の進行RPC（0079）は常に本番相当の固定値を使っていたため、通し稽古ビルドで
// 「画面は0秒になるがDBの締切はまだ先」という食い違いが起きていた。
// 今はlives.timing_profile（DBに保存された、そのライブが実際に使う信頼済みの
// プロファイル）を必ず参照する。NEXT_PUBLIC_LIVE_TIMING_MODEは、司会がテスト
// ライブを新規作成する瞬間に「短縮時間で作るかどうか」を決めるためだけに使う
// （createLivePreparationのtimingProfile引数。本番ライブでは無視される。DB側にも
// official(本番)ライブはstandard固定という制約がある）。
const TEST_MODE = process.env.NEXT_PUBLIC_LIVE_TIMING_MODE === "test";

// 司会準備画面（createLivePreparation）が、テストライブを新規作成する瞬間に
// timing_profile: "short_test" を渡すかどうかの判定にのみ使う。本番ビルドでは
// 常にfalseになり、liveMode==="official"のライブは（このフラグの値に関わらず）
// DB制約(lives_official_timing_profile_check)によりstandard以外にできない。
export const IS_SHORT_TEST_BUILD = TEST_MODE;

// lives.timing_profile='standard'に対応する本番相当の時間。
export const STANDARD_TIMING = {
  interludeMs: 15_000, // 実仕様: 幕間10〜20秒
  openingMs: 45_000, // 実仕様: 開幕30〜60秒
  topicRevealMs: 13_000, // 2026-08-27改訂：22秒→15秒→10秒→13秒（テンポ優先、実仕様レンジ15〜30秒は緩和）
  answerMs: 60_000, // 2026-08-27改訂：90秒→60秒
  judgeMs: 10_000, // 実仕様どおり：採点10秒
  judgeGraceMs: 400, // 採点タイマー表示が0になった後の滑り込み猶予
  groupResultMs: 15_000, // 2026-09-08改訂：30秒→15秒（実仕様: 組結果15秒）
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

// lives.timing_profile='short_test'に対応する、通し稽古テスト用の短縮値。
// 回答を実際に打つ・採点ボタンを押す動作は引き続き余裕を持って試せる長さを残し、
// 待つだけのフェーズを中心に縮めている。DB側（0079の_live_phase_duration_ms）と
// 必ず同じ値にすること（変更時は両方直す）。
export const SHORT_TEST_TIMING = {
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

// 体験版・使い方説明ページ等、実際のlives行（timing_profile）を持たない
// 画面のためだけに残す（NEXT_PUBLIC_LIVE_TIMING_MODEというビルド時フラグに
// 依存する、そのビルド全体の既定値）。実バックエンド版のライブルーム画面は
// これを直接importせず、必ず下のgetLiveRoomTiming(live.timing_profile)を使うこと。
export const LIVE_ROOM_TIMING = TEST_MODE ? SHORT_TEST_TIMING : STANDARD_TIMING;

// 3回目レビュー対応（項目2）：実際のライブ行が持つtiming_profileから、画面表示・
// クライアント側の進行判断が使うべき時間の組を1つに決める。DB側の進行RPCが
// 参照するlives.timing_profileと必ず同じ入力・同じ対応関係にすることで、
// 「画面表示とDB判定が違う時間設定を使う」状態を作らない。
export function getLiveRoomTiming(
  timingProfile: string | null | undefined,
): typeof STANDARD_TIMING | typeof SHORT_TEST_TIMING {
  return timingProfile === "short_test" ? SHORT_TEST_TIMING : STANDARD_TIMING;
}

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
// ライブ本番の回答入力の文字数上限。入力欄自体に文字数カウンター等は出さず、
// 上限を超えた状態で送信しようとした時だけエラーメッセージで知らせる。
export const MAX_ANSWER_BODY_LENGTH = 50;
