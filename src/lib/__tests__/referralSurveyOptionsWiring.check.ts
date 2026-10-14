// 流入アンケートの選択肢変更（2026-10-14、0090：X・YouTube・TikTok・友人・その他）の
// 配線確認（静的検査）。実際にReactをレンダリングする自動テスト基盤が無いため、
// ソースを読み取り、要求された挙動がコード上に存在することを確認する。
//
// 確認する要求事項：
// - 参加登録画面の選択肢は共通定義(REFERRAL_SOURCE_ANSWER_OPTIONS)から描画し、
//   「アプリ内」(app)の選択肢を直書きしていない。
// - 表示条件は共通関数(shouldShowReferralSurvey)を使う（回答済みには再表示しない）。
// - 運営画面（全体集計・ライブ単位集計・司会コンソール）にYouTube・TikTokが表示され、
//   過去の「アプリ内」回答も旧選択肢として表示され続ける。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

// 1: 参加登録画面の選択肢
const presentation = read("src", "components", "live-room", "OpeningPresentation.tsx");
assert.ok(presentation.includes("REFERRAL_SOURCE_ANSWER_OPTIONS.map("), "選択肢が共通定義から描画されていない");
assert.ok(!presentation.includes('value="app"'), "「アプリ内」(app)の選択肢が直書きで残っている");
assert.ok(!presentation.includes("アプリ内"), "参加登録画面に「アプリ内」の文言が残っている");
assert.ok(presentation.includes('<option value="">選択しない</option>'), "「選択しない」の選択肢が消えている");
console.log("PASS: 参加登録画面の選択肢は共通定義から描画され、「アプリ内」を含まない（「選択しない」は維持）");

// 2: 表示条件
const openingView = read("src", "components", "live-room", "OpeningView.tsx");
assert.ok(
  openingView.includes("shouldShowReferralSurvey({ isGuest, profileLoading, profile })"),
  "OpeningViewが共通の表示条件(shouldShowReferralSurvey)を使っていない",
);
console.log("PASS: 参加登録画面は共通の表示条件（未回答の通常会員だけに表示）を使う");

// 3: 運営画面の表示
const schedule = read("src", "app", "admin", "schedule", "page.tsx");
for (const text of [
  "X：{summary.x}人",
  "YouTube：{summary.youtube}人",
  "TikTok：{summary.tiktok}人",
  "友人：{summary.friend}人",
  "その他：{summary.other}人",
  "アプリ内（旧選択肢）：{summary.app}人",
]) {
  const count = schedule.split(text).length - 1;
  assert.equal(count, 2, `ライブ予定画面の全体集計・ライブ単位集計の両方に「${text}」が無い(件数=${count})`);
}
const host = read("src", "app", "live", "host", "page.tsx");
for (const text of [
  "X {referralCounts.x}",
  "YouTube {referralCounts.youtube}",
  "TikTok {referralCounts.tiktok}",
  "友人 {referralCounts.friend}",
  "その他 {referralCounts.other}",
  "アプリ内（旧） {referralCounts.app}",
]) {
  assert.ok(host.includes(text), `司会コンソールに「${text}」が無い`);
}
assert.ok(!schedule.includes("X（旧Twitter）：") && !schedule.includes("友人・知人の紹介："), "ライブ予定画面に旧表記が残っている");
assert.ok(!host.includes("紹介 {referralCounts.friend}"), "司会コンソールに旧表記（紹介）が残っている");
console.log("PASS: 運営画面（全体集計・ライブ単位集計・司会コンソール）がX・YouTube・TikTok・友人・その他の表記で、旧アプリ内も表示される");

console.log("ALL REFERRAL_SURVEY_OPTIONS_WIRING CHECKS PASSED");
