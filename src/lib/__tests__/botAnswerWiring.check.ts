// 配線確認：司会画面のボット回答処理（useLiveHostStore.ts の runBotBehavior）が、
// 人間優先の猶予・同時1件・冪等キー（src/lib/botAnswerPolicy.ts）を経由していること。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src", "store", "useLiveHostStore.ts"), "utf8");
const fn = src.match(/async function runBotBehavior\([\s\S]*?\n\}\n/);
assert.ok(fn, "runBotBehavior が見つからない");
const body = fn![0];

assert.ok(/observeBotIdleWindow\(botIdleTracker,/.test(body), "送信可能な時間帯（idle window）を追跡していない");
assert.ok(/humanUnsentCount/.test(body) && /!botParticipantIds\.has\(p\.id\)/.test(body), "人間の未送信回答者を数えていない");
assert.ok(/decideBotAnswerGate\(\{[\s\S]*?graceMs: botHumanGraceMs\(live\.timing_profile\)/.test(body), "猶予がlives.timing_profile（standard/short_test）から決まっていない");
assert.ok(/tryBeginBotAnswer\(botAnswerGuard, key, nowFresh\)/.test(body), "ボット回答INSERTがsingle-flight/冪等キーを経由していない");
assert.ok(/nowFresh === null \|\| !tryBeginBotAnswer/.test(body), "サーバー同期時計が確定していない間にボット回答を送信し得る");
assert.ok(/participant\.kicked_at/.test(body), "退場済みのボットが回答対象から外れていない");
assert.ok(/classifyBotAnswerInsertError\(error\)/.test(body) && /finishBotAnswer\(botAnswerGuard, key, outcome, /.test(body), "INSERT結果の分類・完了通知がない");
// answersへのINSERTはボット回答の1箇所だけで、bots.map（全ボット並列）の中には無い。
assert.equal((body.match(/from\("answers"\)\.insert\(/g) ?? []).length, 1, "answers INSERTが複数箇所にある");
assert.ok(!/bots\.map\([\s\S]{0,400}from\("answers"\)/.test(body), "全ボットが並列にanswersへINSERTする構造が残っている（409の原因）");
assert.ok(/await Promise\.all\(\[answerStep\(\), \.\.\.bots\.map\(scoringStep\)\]\)/.test(body), "回答は1件・採点は並列、の構造になっていない");
// 停止時に状態を破棄する。
assert.ok(/resetBotIdleTracker\(botIdleTracker\);\s*\n\s*resetBotAnswerGuard\(botAnswerGuard\);/.test(src), "stop時にボットの回答状態をリセットしていない");
console.log("PASS: ボット回答は、人間優先の猶予（timing_profile別）・同時1件・冪等キー・INSERT直前の再確認を経由する");

// ボットのログアウトは終了処理（通常終了・緊急中止）が完了を待つ（短いタイムアウト付き）。
{
  const bots = readFileSync(join(process.cwd(), "src", "store", "useLiveBotStore.ts"), "utf8");
  assert.ok(/removeAllBots: async \(timeoutMs = BOT_LOGOUT_TIMEOUT_MS\)/.test(bots), "removeAllBotsがPromiseを返すasync関数になっていない");
  assert.ok(/Promise\.allSettled\(/.test(bots) && /Promise\.race\(\[logouts, timeout\]\)/.test(bots), "allSettled＋タイムアウトで待っていない");
  assert.equal((src.match(/await botLogout;/g) ?? []).length, 2, "通常終了・緊急中止の両方がボットのログアウト完了を待っていない");
  assert.ok(!/^\s*useLiveBotStore\.getState\(\)\.removeAllBots\(\);/m.test(src), "removeAllBotsの戻り値を捨てて（待たずに）呼んでいる箇所がある");
  console.log("PASS: 通常終了・緊急中止の両方が、ボットのログアウト完了を短いタイムアウト付きで待つ");
}
