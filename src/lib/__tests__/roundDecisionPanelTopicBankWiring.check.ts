// RoundDecisionPanel（次の周のお題入力）が、登録済みのお題（topic_bank）から選ぶUIと
// 手入力の両方を持ち、groupId単位で管理し、addNextRoundへtopicBankIdを渡していることを
// 静的に確認する（既存の*.check.tsのスタイルを踏襲。実際の絞り込みロジック自体は
// roundTopicCandidates.check.tsで検証済み）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "src/app/live/host/page.tsx"), "utf8");

assert.match(
  src,
  /import \{\s*candidatesForGroup as candidatesForGroupPure,\s*usedBodySet,\s*usedTopicBankIdSet,\s*\} from "@\/lib\/roundTopicCandidates";/,
  "host consoleがroundTopicCandidatesの純粋関数を読み込んでいない",
);

// groupId(文字列)をキーに、登録済みお題の出典ID(topicBankId)とtextareaの本文(body)を
// 1組として管理している（配列位置ではなくgroupId単位）。
assert.match(
  src,
  /const \[selections, setSelections\] = useState<Record<string, \{ topicBankId: string \| null; body: string \}>>/,
  "RoundDecisionPanelの入力状態がgroupIdキーのtopicBankId\\/body構造になっていない",
);

// 登録済みのお題を選ぶ<select>と、手入力用の<textarea>の両方がある。
assert.match(src, /登録済みのお題から選ぶ/, "「登録済みのお題から選ぶ」の選択UIが無い");
assert.match(src, /<option value="">（手入力）<\/option>/, "「（手入力）」の既定選択肢が無い");
assert.match(
  src,
  /placeholder=\{`\$\{g\.group_order\}組目のお題（手入力、または上で選んでから微調整）`\}/,
  "手入力用textareaのplaceholderが想定どおりでない（登録済み選択後の微調整も可能である旨の案内が無い）",
);

// 何組のお題か・その組のプレイヤーを画面上に明確に表示している。
assert.match(
  src,
  /第\{live\.rounds_per_live \+ 1\}周・\{g\.group_order\}組目/,
  "何周・何組目のお題かが表示されていない",
);
assert.match(src, /playerNamesFor\(g\.id\)/, "その組のプレイヤー名が表示されていない");

// 登録済みのお題を選ぶと本文がtextareaへ入り、本文を直接書き換えた場合は
// topicBankIdがnullに戻る（「微調整」は手入力として扱う）。
assert.match(
  src,
  /setSelections\(\(prev\) => \(\{ \.\.\.prev, \[g\.id\]: \{ topicBankId: entry\.id, body: entry\.body \} \}\)\)/,
  "登録済みのお題を選んだ時にbody/topicBankIdの両方がセットされていない",
);
assert.match(
  src,
  /setSelections\(\(prev\) => \(\{ \.\.\.prev, \[g\.id\]: \{ topicBankId: null, body: e\.target\.value \} \}\)\)/,
  "textareaを手で編集した時にtopicBankIdがnullへリセットされていない（本文不一致でDB側に拒否される原因になる）",
);

// addNextRoundへtopicBankIdを渡している（手入力では自然にnullになる）。
assert.match(
  src,
  /topicBankId: selections\[g\.id\]\?\.topicBankId \?\? null,/,
  "addNextRound呼び出しにtopicBankIdが渡っていない",
);

console.log("PASS: RoundDecisionPanelは登録済みのお題（topic_bank）からの選択と手入力の両方を持ち、groupId単位で管理し、本文を書き換えると手入力として扱われ、addNextRoundへtopicBankIdを渡す");
console.log("ALL ROUND_DECISION_PANEL_TOPIC_BANK_WIRING CHECKS PASSED");
