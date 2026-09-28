// 寄合帳の権限（未ログイン/ゲスト/会員）・通報ボタン・演者取得状態・不正ID・ライブ予定の回帰テスト。
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { deriveAuthorLookupStatus } from "../authorLookupStatus";
import { pickInitialCalendarMonth } from "../calendarInitialMonth";
import { readOnlyNoticeText, resolveSnsAccess } from "../snsAccess";
import { isUuid } from "../uuid";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(n)) out.push(f);
  }
  return out;
}

// 1) 立場の判定：認証確認中・未ログイン・ゲスト・通常会員を分ける
const member = { is_anonymous: false };
const anon = { is_anonymous: true };
assert.equal(resolveSnsAccess({ authUser: null, authLoading: true, profile: null }), "checking", "認証確認中は未ログインにしない");
assert.equal(resolveSnsAccess({ authUser: member, authLoading: true, profile: null }), "checking");
assert.equal(resolveSnsAccess({ authUser: null, authLoading: false, profile: null }), "anonymous");
assert.equal(resolveSnsAccess({ authUser: anon, authLoading: false, profile: null }), "guest");
assert.equal(resolveSnsAccess({ authUser: member, authLoading: false, profile: { isGuest: true } }), "guest");
assert.equal(resolveSnsAccess({ authUser: member, authLoading: false, profile: null }), "member", "profile取得前でも会員（券は別途unknown扱い）");
assert.equal(resolveSnsAccess({ authUser: member, authLoading: false, profile: { isGuest: false } }), "member");
assert.equal(readOnlyNoticeText("checking", "回答"), null);
assert.equal(readOnlyNoticeText("member", "回答"), null);
assert.ok(readOnlyNoticeText("anonymous", "回答")!.includes("Xログインが必要"));
assert.ok(readOnlyNoticeText("guest", "回答")!.includes("ゲストは回答できません"));

// 寄合帳の操作UIは、すべて共通判定（useSnsAccess）経由。個別のisGuestUser判定が残っていない。
for (const f of ["SnsTopicDetail", "SnsAnswerDetail", "SnsFeedSection", "SnsLiveResultBody", "SnsFollowButton"]) {
  const s = read("src", "components", "sns", `${f}.tsx`);
  assert.ok(/useSnsAccess\(\)/.test(s), `${f} が共通の権限判定を使っていない`);
  assert.ok(!/isGuestUser\(/.test(s), `${f} に個別のゲスト判定が残っている`);
}
assert.ok(/access !== "member"\) return null/.test(read("src", "components", "sns", "SnsFollowButton.tsx")), "未ログイン・ゲストにフォローボタンが出る");
for (const f of ["SnsTopicDetail", "SnsAnswerDetail", "SnsLiveResultBody"]) {
  assert.ok(/<SnsReadOnlyNotice access=\{access\}/.test(read("src", "components", "sns", `${f}.tsx`)), `${f} に閲覧のみの案内がない`);
}
// 投稿画面：認証確認中→未ログイン→ゲスト→フォーム
const newPage = read("src", "app", "(main)", "sns", "new", "page.tsx");
assert.ok(newPage.indexOf("if (authLoading)") < newPage.indexOf("if (!authUser)"), "認証確認中の分岐が未ログインより後ろ");
// 会員の「券0枚」表示・回答/ツッコミの送信不可は、会員情報の取得後だけ
for (const f of ["SnsTopicDetail", "SnsAnswerDetail"]) {
  assert.ok(/noTicket = ticketKnown && ticketCount <= 0/.test(read("src", "components", "sns", `${f}.tsx`)), `${f}: 会員情報取得前に「券0枚」と出し得る`);
}

// 2) 通報ボタン：対象を必須にし、ダミーconfirmだけで「通報済み」にする経路がない
const report = read("src", "components", "app", "ReportButton.tsx");
assert.ok(/targetType: ReportTargetType;\s*\n\s*targetId: string;/.test(report), "targetType/targetIdが必須になっていない");
assert.ok(!/window\.confirm/.test(report), "確認だけで通報済みにするダミー処理が残っている");
assert.ok(/from\("reports"\)\.insert\(/.test(report) && /setReported\(true\)/.test(report), "DB保存後に報告済みにしていない");
assert.ok(report.indexOf("insert(") < report.indexOf("setReported(true)"), "保存前に報告済みにしている");
assert.ok(/authLoading \|\| !authUser \|\| isGuestUser\(authUser, profile\) \|\| !isUuid\(targetId\)\) return null/.test(report), "未ログイン・ゲスト・仮IDで通報ボタンが出る");
assert.ok(/submitter\.current\.isSubmitting\(\)/.test(report), "送信中の連打を防いでいない");
// 全利用箇所がtargetType/targetIdを渡している
for (const f of walk(join(process.cwd(), "src"))) {
  if (f.includes("__tests__")) continue;
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/<ReportButton\b([\s\S]*?)\/>/g)) {
    assert.ok(/targetType=/.test(m[1]) && /targetId=/.test(m[1]), `${f}: 対象を渡さないReportButton`);
  }
}
for (const f of ["SnsAuthorProfile.tsx"]) assert.ok(!/ReportButton/.test(read("src", "components", "sns", f)), "演者プロフィールに未対応の通報ボタンが残っている");
for (const f of [["components", "live-room", "GroupResultView.tsx"], ["components", "live-room", "FinalResultView.tsx"]]) {
  assert.ok(!/ReportButton/.test(read("src", ...f)), `${f.join("/")} に未対応の通報ボタンが残っている`);
}
assert.ok(/reportTarget && \(/.test(read("src", "components", "sns", "SnsAuthorBadge.tsx")), "対象なしのバッジに通報ボタンが出る");

// 3) 演者取得状態
const a = "11111111-1111-4111-8111-111111111111";
assert.equal(deriveAuthorLookupStatus({ authorId: a, hasInfo: false, attempt: null }), "loading", "取得前にnot-foundにしない");
assert.equal(deriveAuthorLookupStatus({ authorId: a, hasInfo: false, attempt: { id: "22222222-2222-4222-8222-222222222222", result: "ok" } }), "loading", "別IDの結果でnot-foundにしない");
assert.equal(deriveAuthorLookupStatus({ authorId: a, hasInfo: true, attempt: null }), "found");
assert.equal(deriveAuthorLookupStatus({ authorId: a, hasInfo: false, attempt: { id: a, result: "ok" } }), "not-found");
assert.equal(deriveAuthorLookupStatus({ authorId: a, hasInfo: false, attempt: { id: a, result: "error" } }), "error");
assert.equal(deriveAuthorLookupStatus({ authorId: "x", hasInfo: false, attempt: null }), "not-found", "不正IDはAPIを呼ばずnot-found");
for (const f of ["SnsAuthorProfile", "SnsAuthorFollowers", "SnsAuthorFollowing"]) {
  const s = read("src", "components", "sns", `${f}.tsx`);
  assert.ok(/useAuthorLookup\(authorId\)/.test(s) && /SnsAuthorLookupState/.test(s), `${f} が取得状態を分けていない`);
  assert.ok(!/演者が見つかりませんでした/.test(s), `${f} に直書きのnot-foundが残っている`);
}
const store = read("src", "store", "useSnsStore.ts");
assert.ok(/resolveAuthorName: async[\s\S]*?"error"/.test(store), "resolveAuthorNameが通信失敗を返さない");

// 4) 不正ID：UUIDでなければAPIを呼ばない
assert.ok(isUuid(a) && isUuid("0F8FAD5B-D9CB-469F-A165-70867728950E"));
for (const v of ["x", "", "topic-1", "11111111-1111-4111-8111-11111111111", "11111111-1111-4111-8111-1111111111111", "11111111111141118111111111111111"]) assert.ok(!isUuid(v), `${v} はUUIDでない`);
assert.ok(/existing\) return existing;\s*\n\s*if \(!isUuid\(topicId\)\) return null/.test(store), "fetchTopicByIdがUUID検査していない");
assert.ok(/existing\) return existing;\s*\n\s*if \(!isUuid\(answerId\)\) return null/.test(store), "fetchAnswerByIdがUUID検査していない");
assert.ok(/isUuid\(liveResultId\)/.test(read("src", "store", "useSnsLiveResultsStore.ts")), "ライブ結果がUUID検査していない");
for (const f of ["SnsAuthorFollowers", "SnsAuthorFollowing"]) assert.ok(/isUuid\(authorId\)/.test(read("src", "components", "sns", `${f}.tsx`)), `${f} のフォロー取得がUUID検査していない`);

// 5) 開発用ライブ画面は本番で本当の404（rewritesはbeforeFiles）
const cfg = read("next.config.ts");
assert.ok(/beforeFiles/.test(cfg) && /production/.test(cfg), "本番のrewritesがない");
for (const p of ["/live-demo", "/live/design-preview", "/live/design-preview-2"]) assert.ok(cfg.includes(`source: "${p}"`) && cfg.includes(`source: "${p}/:path*"`), `${p} が404にならない`);
assert.ok(!/source: "\/live\/:|source: "\/live"/.test(cfg), "通常ライブのルーティングに触れている");

// 6) ライブ予定の初期月：シナリオ
const today = { year: 2026, month: 9, day: 27 };
const m = (year: number, month: number, day: number) => ({ year, month, day });
assert.deepEqual(pickInitialCalendarMonth([m(2026, 10, 3)], today), { year: 2026, month: 10 }, "翌月に1件");
assert.deepEqual(pickInitialCalendarMonth([m(2026, 12, 5), m(2026, 10, 3), m(2027, 1, 9)], today), { year: 2026, month: 10 }, "複数月の未来→最も近い月");
assert.deepEqual(pickInitialCalendarMonth([m(2026, 8, 1), m(2026, 7, 4)], today), { year: 2026, month: 8 }, "過去のみ→最新の過去");
assert.deepEqual(pickInitialCalendarMonth([], today), { year: 2026, month: 9 }, "0件→今月");
assert.deepEqual(pickInitialCalendarMonth([m(2027, 1, 2)], { year: 2026, month: 12, day: 31 }), { year: 2027, month: 1 }, "年またぎ");
const cal = read("src", "components", "home", "LiveCalendar.tsx");
assert.ok(/useState\(\(\) => \{[\s\S]*?pickInitialCalendarMonth\(marks,/.test(cal), "初期月がuseStateの初期化（一度だけ）で決まっていない");
assert.ok(!/useEffect/.test(cal), "marks更新で表示月が勝手に変わり得る（useEffectあり）");
assert.ok(/const goToday = \(\) => \{[\s\S]*?setViewMonth\(now\.getMonth\(\) \+ 1\)/.test(cal), "「今日」で当月へ戻れない");
const plan = read("src", "lib", "useLiveSchedulePlan.ts");
assert.ok(/if \(error\) \{[\s\S]*?error: true[\s\S]*?return;\s*\n\s*\}/.test(plan), "取得失敗が「予定なし」扱いのままキャッシュされる");
const sched = read("src", "app", "(main)", "live-schedule", "page.tsx");
assert.ok(/error && calendarMarks\.length === 0/.test(sched) && /reload/.test(sched), "取得失敗時の表示・再試行がない");

// 7) 案内文の「（利用規約第8条）」は画面の案内から外れている（規約本文は別）
assert.ok(!read("src", "app", "(main)", "page.tsx").includes("（利用規約第8条）"), "ホームの案内に条番号が残っている");
assert.ok(read("src", "app", "(main)", "page.tsx").includes("運営が公式SNSや動画配信サービスで紹介する場合があります。"), "案内文本体がない");
console.log("PASS: 寄合帳の権限分離・通報ボタン・演者取得状態・不正ID・開発画面404・ライブ予定");
