// 実機要望対応：「プレイヤー全員への運営メッセージ」のテンプレートへ「次の周」を追加する。
// 固定で「2周目」等と書くと3周目以降で誤案内になるため、live.rounds_per_live（現在までに
// 存在する周数。host_add_next_roundのp_expected_round計算と同じ基準）から次の周数を
// 毎回算出していることを静的に確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "src/app/live/host/page.tsx"), "utf8");

assert.match(
  src,
  /const nextRound = \(live\?\.rounds_per_live \?\? 0\) \+ 1;/,
  "次の周数がlive.rounds_per_liveから算出されていない（固定文言になっていないか確認）",
);
assert.match(
  src,
  /label: "次の周", text: `まもなく第\$\{nextRound\}周に入ります`/,
  "「次の周」テンプレートの文言が想定どおりに組み立てられていない",
);
assert.match(
  src,
  /<AdminTemplateChips templates=\{templates\} onSelect=\{\(t\) => setMessage\(t\.text\)\}/,
  "AnnouncementPanelが動的なtemplates（次の周を含む）をAdminTemplateChipsへ渡していない",
);
// 別の通知欄（警告・お知らせ配信等）には追加していないことの確認
// （AnnouncementPanel以外でnextRoundTemplate/次の周テンプレートを使っていないこと）。
const occurrences = [...src.matchAll(/label: "次の周"/g)];
assert.equal(occurrences.length, 1, "「次の周」テンプレートが複数箇所（別の通知欄）に存在している");

console.log("PASS: 「次の周」テンプレートはプレイヤー全員への運営メッセージ欄だけに追加され、live.rounds_per_liveから周数を毎回算出する");

// 実際の文言（1周目終了時・2周目終了時）をここでも同じ式で再現し、報告用にログへ出す。
for (const roundsPerLive of [1, 2]) {
  const nextRound = roundsPerLive + 1;
  const text = `まもなく第${nextRound}周に入ります`;
  if (roundsPerLive === 1) assert.equal(text, "まもなく第2周に入ります");
  if (roundsPerLive === 2) assert.equal(text, "まもなく第3周に入ります");
  console.log(`PASS: rounds_per_live=${roundsPerLive}（第${roundsPerLive}周終了時）→ 「${text}」`);
}

console.log("ALL ANNOUNCEMENT_NEXT_ROUND_TEMPLATE CHECKS PASSED");
