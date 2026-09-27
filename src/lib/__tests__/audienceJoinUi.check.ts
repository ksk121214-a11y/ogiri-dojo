// 「爆笑発生」表示と、未参加者の画面・参加ボタンの出し分け。
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { laughCountLabel, planAudienceJoinUi } from "../audienceJoinUiPlan";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(n)) out.push(f);
  }
  return out;
}

// 1〜3) 爆笑発生
assert.equal(laughCountLabel(10), "爆笑発生：10件");
assert.equal(laughCountLabel(1), "爆笑発生：1件");
assert.equal(laughCountLabel(0), null, "0件は表示しない");
assert.equal(laughCountLabel(-1), null);
for (const f of walk(join(process.cwd(), "src"))) {
  if (f.includes("__tests__")) continue;
  const s = readFileSync(f, "utf8");
  for (const line of s.split("\n")) {
    if (line.trim().startsWith("//") || line.includes("//")) continue;
    assert.ok(!line.includes("笑いエフェクト発生"), `${f}: 利用者向けに「笑いエフェクト発生」が残っている`);
  }
}
for (const f of [
  ["components", "live-room", "GroupResultView.tsx"],
  ["components", "live-demo", "GroupResultScreen.tsx"],
  ["components", "live-design-preview-2", "GroupResultViewPreview2.tsx"],
]) {
  assert.ok(/laughCountLabel\(/.test(read("src", ...f)), `${f.join("/")} が共通の「爆笑発生」表示を使っていない`);
}

// 12・13・16) フェーズごとの画面
const P = (phase: string, hasParticipant: boolean, entering: boolean) => planAudienceJoinUi({ phase, hasParticipant, entering });
// 参加済みは通常画面・参加ボタンなし
for (const ph of ["opening", "topic_reveal", "answering", "group_result", "final_result"]) {
  assert.deepEqual(P(ph, true, false), { view: "normal", panel: false });
}
// 観客参加ボタンを押した直後（entering）：中間画面（join-prompt）も参加ボタン（panel）も出さない
assert.deepEqual(P("answering", false, true), { view: "entering", panel: false }, "answeringで中間画面や再押下ボタンが出る");
assert.deepEqual(P("opening", false, true), { view: "entering", panel: false });
assert.deepEqual(P("topic_reveal", false, true), { view: "normal", panel: false });
assert.deepEqual(P("group_result", false, true), { view: "normal", panel: false });
assert.deepEqual(P("final_result", false, true), { view: "normal", panel: false });
// 直接アクセス・失敗後（entering=false）：中央の参加ボタンを出す（二重に出さない）
assert.deepEqual(P("answering", false, false), { view: "join-prompt", panel: false });
assert.deepEqual(P("topic_reveal", false, false), { view: "join-prompt", panel: false });
assert.deepEqual(P("group_result", false, false), { view: "normal", panel: true });
assert.deepEqual(P("final_result", false, false), { view: "normal", panel: true });
assert.deepEqual(P("opening", false, false), { view: "normal", panel: false }, "openingは既存の参加登録UI（OpeningView）を維持");
assert.deepEqual(P("interlude", false, false), { view: "normal", panel: false });
for (const ph of ["opening", "topic_reveal", "answering", "group_result", "final_result", "interlude", "scheduled", "closed"]) {
  for (const entering of [true, false]) {
    const r = P(ph, false, entering);
    assert.ok(!(r.view === "join-prompt" && r.panel), `${ph}: 中央ボタンが二重になる`);
  }
}

// 配線：固定の参加ボタンは無く、中央のボタン・入場中表示・再試行文言がある
const page = read("src", "app", "live", "page.tsx");
assert.ok(!/AudienceJoinButton/.test(page), "画面下固定のAudienceJoinButtonが残っている");
assert.ok(/planAudienceJoinUi\(/.test(page) && /AudienceEnteringScreen/.test(page), "ページが出し分けを使っていない");
for (const f of ["AudienceJoinPanel", "AudienceJoinPrompt", "AudienceEnteringScreen"]) {
  assert.ok(!/\bfixed\b/.test(read("src", "components", "live-room", `${f}.tsx`)), `${f} が画面固定になっている`);
}
const panel = read("src", "components", "live-room", "AudienceJoinPanel.tsx");
assert.ok(/観客席へ入場中…/.test(panel) && /もう一度、観客として参加する/.test(panel) && /観客として参加する/.test(panel));
assert.ok(/min-h-\[52px\]/.test(panel) && /bg-\[#c8102e\]/.test(panel) && /text-white/.test(panel), "ボタンが塗りの大きなボタンになっていない");
assert.ok(/role="alert"/.test(panel) && /\{error\}/.test(panel), "エラーがボタン近くに出ていない");
assert.ok(/finally \{\s*setJoining\(false\)/.test(panel), "失敗後にロックが解除されない");
assert.ok(/観客席へ入場中…/.test(read("src", "components", "live-room", "AudienceEnteringScreen.tsx")));
// join_liveはstoreでsingle-flight
const follower = read("src", "store", "useLiveFollowerStore.ts");
assert.ok(/joinLiveFlight/.test(follower) && /\.finally\(\(\) => \{\s*if \(joinLiveFlight\?\.promise === promise\) joinLiveFlight = null/.test(follower), "joinLiveがsingle-flightでない");
// 意図はメモリのみ（localStorageに残さない）・ページ離脱で破棄
const intentStore = read("src", "store", "useAudienceJoinIntentStore.ts");
const noComments = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
assert.ok(!/localStorage|sessionStorage/.test(noComments(intentStore + read("src", "lib", "audienceJoinIntent.ts"))), "意図が永続化されている");
assert.ok(/return \(\) => \{\s*useAudienceJoinIntentStore\.getState\(\)\.discard\(\);[\s\S]*?gate\.cancel\(\)/.test(page), "ページ離脱で意図の破棄・ゲスト同意モーダルのキャンセルをしていない");
console.log("PASS: 爆笑発生表示・未参加者の画面出し分け・中央の参加ボタン・single-flight");
