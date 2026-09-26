// 全体点検（2026-09-27）で直した3件の回帰テスト。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isNoAudioRoute } from "../audioRoutes";
import { pickInitialCalendarMonth } from "../calendarInitialMonth";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

// 1) 音声対象外の画面
for (const p of ["/terms", "/terms/", "/privacy", "/privacy/", "/auth/callback", "/auth/callback/"]) {
  assert.ok(isNoAudioRoute(p), `${p} は音声対象外`);
}
for (const p of ["/", "/live", "/live-schedule", "/mypage", "/termsx", "/how-to-play"]) {
  assert.ok(!isNoAudioRoute(p), `${p} は音声対象`);
}
const provider = read("src", "components", "app", "AudioProvider.tsx");
assert.ok(/isNoAudioRoute\(pathname\)\) return;\s*\n\s*audioManager\.preloadAllSfx\(\)/.test(provider), "SE事前読み込みが対象外画面でも走る");
assert.ok(/!isNoAudioRoute\(pathname\) && !audioManager\.hasShownBgmPrompt\(\)/.test(provider), "BGM確認が対象外画面で出る");
assert.ok(/const NO_BGM_PROMPT_PREFIXES = \["\/admin", "\/live\/host"\]/.test(provider), "管理画面・司会画面の既存除外が変わっている");
const ambient = read("src", "components", "app", "AmbientBgmController.tsx");
assert.ok(/isNoAudioRoute\(pathname\)\) \{\s*\n\s*stopBgm\(\);/.test(ambient), "対象外画面でBGMを止めていない");

// 2) カレンダー初期月
const today = { year: 2026, month: 9, day: 27 };
assert.deepEqual(pickInitialCalendarMonth([], today), { year: 2026, month: 9 });
assert.deepEqual(pickInitialCalendarMonth([{ year: 2026, month: 10, day: 3 }], today), { year: 2026, month: 10 });
assert.deepEqual(
  pickInitialCalendarMonth(
    [{ year: 2026, month: 9, day: 5 }, { year: 2026, month: 10, day: 3 }, { year: 2026, month: 11, day: 7 }],
    today,
  ),
  { year: 2026, month: 10 },
  "今日以降で最も近い月",
);
assert.deepEqual(pickInitialCalendarMonth([{ year: 2026, month: 9, day: 5 }, { year: 2026, month: 8, day: 1 }], today), { year: 2026, month: 9 }, "全て過去なら最新の過去");
assert.deepEqual(pickInitialCalendarMonth([{ year: 2026, month: 9, day: 27 }], today), { year: 2026, month: 9 }, "当日は当月");
const page = read("src", "app", "(main)", "live-schedule", "page.tsx");
assert.ok(/loading \? \([\s\S]*?<LiveCalendar marks=\{calendarMarks\} \/>/.test(page), "読み込み完了前にカレンダーを描画している（初期月が確定しない）");
const cal = read("src", "components", "home", "LiveCalendar.tsx");
assert.ok(/pickInitialCalendarMonth\(marks,/.test(cal) && /const goToday = /.test(cal), "初期月の選択または今日ボタンがない");

// 3) 投稿画面：未ログインはログイン案内
const sns = read("src", "app", "(main)", "sns", "new", "page.tsx");
const idxLogin = sns.indexOf("if (!authUser)");
const idxGuest = sns.indexOf("if (isGuestUser(authUser, profile))");
const idxForm = sns.indexOf("onSubmit={handleSubmit}");
assert.ok(idxLogin > 0 && idxLogin < idxGuest && idxGuest < idxForm, "未ログイン→ゲスト→フォームの順で分岐していない");
assert.ok(/Xでログインすると、お題を投稿できます/.test(sns), "未ログイン案内文がない");
assert.ok(/useAuthStore\(\(s\) => s\.loading\)/.test(sns) && /if \(authLoading\)/.test(sns), "認証確認中にログイン案内やフォームが一瞬出る");
assert.ok(/noTicket = ticketKnown && ticketCount <= 0/.test(sns), "プロフィール取得前に券0枚と表示し得る");
// 4) 開発用モック画面は本番で404
for (const d of [["live-demo"], ["live", "design-preview"], ["live", "design-preview-2"]]) {
  const l = read("src", "app", ...d, "layout.tsx");
  assert.ok(/process\.env\.NODE_ENV === "production"\) notFound\(\)/.test(l), `${d.join("/")} が本番で404にならない`);
}
console.log("PASS: 音声対象外画面・カレンダー初期月・投稿画面の未ログイン案内");
