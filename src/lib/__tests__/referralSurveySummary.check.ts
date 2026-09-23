// summarizeReferralSurvey（src/lib/referralSurveySummary.ts）の検証。
// 運営者専用「ライブ予定」画面の結果公開欄に表示する、ライブ単位の流入アンケート
// 集計ロジック（x/friend/app/other/未回答/回答済み/対象）が正しいことを確認する。
import assert from "node:assert/strict";

import {
  referralSourceDisplayLabel,
  summarizeReferralSurvey,
  toOverallReferralSurveyCounts,
  type ReferralSurveyParticipantRow,
} from "../referralSurveySummary";

const row = (referralSource: string | null, isGuest = false): ReferralSurveyParticipantRow => ({
  referralSource,
  isGuest,
});

// 1: 空配列は全項目0（対象0件をそのまま返し、0除算等で例外にならない）。
assert.deepEqual(summarizeReferralSurvey([]), {
  x: 0,
  friend: 0,
  app: 0,
  other: 0,
  noAnswer: 0,
  answered: 0,
  target: 0,
});
console.log("PASS: 参加者0件は全項目0になる");

// 2: 要求例と同じ構成（x3・friend2・app1・other0・未回答1・回答済み6/対象7）を再現する。
const sample: ReferralSurveyParticipantRow[] = [
  row("x"),
  row("x"),
  row("x"),
  row("friend"),
  row("friend"),
  row("app"),
  row(null),
];
assert.deepEqual(summarizeReferralSurvey(sample), {
  x: 3,
  friend: 2,
  app: 1,
  other: 0,
  noAnswer: 1,
  answered: 6,
  target: 7,
});
console.log("PASS: 要求例どおりの内訳（X3・友人2・アプリ1・その他0・未回答1・回答済み6/対象7）を再現する");

// 3: is_guest=trueのゲストは、referral_sourceの値によらず内訳・未回答・対象人数の
//    どこにもカウントされない（アンケート自体の対象外）。
const withGuests: ReferralSurveyParticipantRow[] = [
  row("x"),
  row(null, true), // ゲスト（未回答扱いにしない）
  row("friend", true), // ゲスト（xやfriendにカウントしない）
];
assert.deepEqual(summarizeReferralSurvey(withGuests), {
  x: 1,
  friend: 0,
  app: 0,
  other: 0,
  noAnswer: 0,
  answered: 1,
  target: 1,
});
console.log("PASS: is_guest=trueの行は内訳・未回答・対象人数のいずれからも除外される");

// 4: 全員未回答（null）の場合、answered=0・target=noAnswerになる。
const allUnanswered: ReferralSurveyParticipantRow[] = [row(null), row(null), row(null)];
assert.deepEqual(summarizeReferralSurvey(allUnanswered), {
  x: 0,
  friend: 0,
  app: 0,
  other: 0,
  noAnswer: 3,
  answered: 0,
  target: 3,
});
console.log("PASS: 全員未回答の場合はanswered=0・noAnswer=targetになる");

// 5: other区分・全区分が最低1件ずつ揃った一般的なケース。
const allCategories: ReferralSurveyParticipantRow[] = [row("x"), row("friend"), row("app"), row("other"), row(null)];
assert.deepEqual(summarizeReferralSurvey(allCategories), {
  x: 1,
  friend: 1,
  app: 1,
  other: 1,
  noAnswer: 1,
  answered: 4,
  target: 5,
});
console.log("PASS: x/friend/app/other/未回答が1件ずつでも正しく内訳される");

// 6（司会コンソール・終了ライブ結果公開の集計不一致レビュー対応）：ゲストだけが
// 参加している場合、回答済み・未回答・対象人数のすべてが0になる
// （ゲストのreferral_source=nullを「未回答」に数えない）。
const guestsOnly: ReferralSurveyParticipantRow[] = [row(null, true), row(null, true)];
assert.deepEqual(summarizeReferralSurvey(guestsOnly), {
  x: 0,
  friend: 0,
  app: 0,
  other: 0,
  noAnswer: 0,
  answered: 0,
  target: 0,
});
console.log("PASS: ゲストだけが参加している場合、回答済み・未回答・対象人数がすべて0になる");

// 7: 通常会員1人（未回答）とゲスト1人が参加した場合、「未回答1人・対象1人」に
//    なる（ゲストの分だけ対象人数が水増しされない）。
const oneMemberOneGuest: ReferralSurveyParticipantRow[] = [row(null, false), row(null, true)];
assert.deepEqual(summarizeReferralSurvey(oneMemberOneGuest), {
  x: 0,
  friend: 0,
  app: 0,
  other: 0,
  noAnswer: 1,
  answered: 0,
  target: 1,
});
console.log("PASS: 通常会員1人（未回答）とゲスト1人の参加は「未回答1人・対象1人」になる");

// 8: 通常会員が回答済みの場合、ゲストが同席していても該当する選択肢へ正しく
//    加算される（司会コンソールと終了ライブの集計が一致することの前提）。
const answeredMemberWithGuest: ReferralSurveyParticipantRow[] = [row("friend", false), row("x", true)];
assert.deepEqual(summarizeReferralSurvey(answeredMemberWithGuest), {
  x: 0,
  friend: 1,
  app: 0,
  other: 0,
  noAnswer: 0,
  answered: 1,
  target: 1,
});
console.log("PASS: 通常会員の回答（friend）はゲスト同席でも正しい選択肢へ加算され、ゲストのxは無視される");

// ---- referralSourceDisplayLabel（司会コンソールの参加者ごとの表示） ----

// 9: ゲストは、referral_sourceの値によらず常に「対象外（ゲスト）」。
assert.equal(referralSourceDisplayLabel(null, true), "対象外（ゲスト）");
assert.equal(referralSourceDisplayLabel("x", true), "対象外（ゲスト）");
console.log("PASS: ゲストの個別表示は常に「対象外（ゲスト）」になる（回答値の有無によらない）");

// 10: 通常会員でreferral_source=nullは「未回答」（ゲストの「対象外」とは区別する）。
assert.equal(referralSourceDisplayLabel(null, false), "未回答");
console.log("PASS: 通常会員のreferral_source=nullは「未回答」と表示され、ゲストの「対象外」と区別される");

// 11: 通常会員の回答済みは、選択した流入元の日本語ラベルを表示する。
assert.equal(referralSourceDisplayLabel("x", false), "X（旧Twitter）");
assert.equal(referralSourceDisplayLabel("friend", false), "友人・知人の紹介");
assert.equal(referralSourceDisplayLabel("app", false), "アプリ内");
assert.equal(referralSourceDisplayLabel("other", false), "その他");
console.log("PASS: 通常会員の回答済みは選択した流入元（x/friend/app/other）の日本語ラベルを表示する");

// ---- toOverallReferralSurveyCounts（全体アンケート集計RPCの戻り値の変換） ----

// 12: RPCの生の行(x_count/friend_count/app_count/other_count/answered_total)を
//     camelCaseのOverallReferralSurveyCountsへそのまま対応付ける。
assert.deepEqual(
  toOverallReferralSurveyCounts({ x_count: 5, friend_count: 3, app_count: 2, other_count: 1, answered_total: 11 }),
  { x: 5, friend: 3, app: 2, other: 1, answeredTotal: 11 },
);
console.log("PASS: toOverallReferralSurveyCountsはRPCの戻り値(x_count等)を正しくcamelCaseへ変換する（要求例の5/3/2/1/11を再現）");

// 13: 全項目0（未回答の会員しかいない）の場合もそのまま0で変換される
//     （呼び出し側でanswered_total===0を「アンケートの回答はまだありません」の
//     判定に使うための前提）。
assert.deepEqual(
  toOverallReferralSurveyCounts({ x_count: 0, friend_count: 0, app_count: 0, other_count: 0, answered_total: 0 }),
  { x: 0, friend: 0, app: 0, other: 0, answeredTotal: 0 },
);
console.log("PASS: 全項目0のRPC結果はanswered_total=0のまま変換される（「回答はまだありません」判定に使える）");

console.log("ALL REFERRAL_SURVEY_SUMMARY CHECKS PASSED");
