// StageAnsweringView.tsx / AudienceAnsweringView.tsxが、回答フリップ欠落の修正
// （検証本体はjudgingDisplayBackfill.check.ts）を同じ形で配線しており、
// かつ補完表示が以下へ一切波及していないことを静的に確認する：
// - 採点可否(judgingActive)・回答席ロック(busyWithOthers)は、引き続き本物の
//   activeAnswer（またはpendingCue.busy）だけから決まる（displayedAnswer/
//   backfill候補からは一切決まらない）＝補完表示しても採点可能状態には戻らない。
// - 回答送信音(answerSubmitCue)は、引き続きpendingCue/answerCueStateだけから
//   決まる＝回答音は増えない。
// - 採点ボード(boardRoundId)は、引き続き本物のactiveAnswerだけから決まる＝
//   補完表示で採点ボード・満点演出が二重発火しない。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const FILES = ["src/components/live-room/StageAnsweringView.tsx", "src/components/live-room/AudienceAnsweringView.tsx"];

for (const file of FILES) {
  const src = read(file);

  assert.match(
    src,
    /import \{ selectJudgingDisplayBackfillCandidate \} from "@\/lib\/judgingDisplayBackfill";/,
    `${file}がselectJudgingDisplayBackfillCandidateを読み込んでいない`,
  );
  assert.match(
    src,
    /const judgingDisplayBackfillCandidate = selectJudgingDisplayBackfillCandidate\(\s*turnAnswers,\s*live\?\.reveal_sequence_until \?\? null,\s*clock,\s*\);/,
    `${file}がturnAnswers・live.reveal_sequence_until・clockから候補を計算していない`,
  );
  assert.match(
    src,
    /const displayedAnswer = useJudgingDisplay\(\s*activeAnswer,\s*turnAnswers,\s*timing\.revealGraceMs,\s*judgingDisplayBackfillCandidate,\s*\);/,
    `${file}がuseJudgingDisplayへ候補（reveal_sequence_untilの残り時間込み）を渡していない`,
  );

  // 採点ボード：引き続きactiveAnswerだけから決まる（displayedAnswer/backfill候補からは
  // 決まらない＝補完表示で採点ボード・満点演出が二重発火しない）。
  assert.match(
    src,
    /if \(activeAnswer\?\.id && activeAnswer\.id !== boardRoundId\) \{\s*setBoardRoundId\(activeAnswer\.id\);\s*\}/,
    `${file}のboardRoundIdがactiveAnswer以外（displayedAnswer等）からも決まる形になっている`,
  );

  // 回答送信音：引き続きpendingCue/answerCueStateだけから決まる（displayedAnswerや
  // backfill候補を参照していない＝回答音は増えない）。
  const sfxBlockMatch = src.match(
    /\/\/ 回答送信音の合図[\s\S]*?const answerSubmitCue = busyNow && answerCueState\.cueId \? \{ cueId: answerCueState\.cueId \} : null;/,
  );
  assert.ok(sfxBlockMatch, `${file}の回答送信音ブロックが見つからない`);
  const sfxBlock = sfxBlockMatch![0];
  assert.doesNotMatch(
    sfxBlock,
    /displayedAnswer|judgingDisplayBackfillCandidate/,
    `${file}の回答送信音ブロックがdisplayedAnswer/補完候補を参照しており、回答音が増える可能性がある`,
  );

  console.log(`PASS: ${file}はjudgingDisplayBackfillを同じ形で配線し、採点ボード・回答音は影響を受けない`);
}

// 採点可否：AudienceAnsweringViewのjudgingActiveは、引き続き本物のactiveAnswerだけから
// 決まる（displayedAnswerからは決まらない＝補完表示しても採点可能状態には戻らない）。
{
  const file = "src/components/live-room/AudienceAnsweringView.tsx";
  const src = read(file);
  assert.match(
    src,
    /judgingActive=\{!!activeAnswer\}/,
    `${file}のjudgingActiveがactiveAnswer以外（displayedAnswer等）から決まる形になっている`,
  );
  console.log(`PASS: ${file}のjudgingActiveは本物のactiveAnswerだけから決まり、補完表示では採点可能にならない`);
}

// 回答席ロック：StageAnsweringView（回答送信可否の判定を持つのはこちらだけ）の
// busyWithOthersは、引き続きlive.answering_paused/cueForCurrentTurn.busy
// （pendingCue由来）だけから決まる（displayedAnswerからは決まらない）。
{
  const file = "src/components/live-room/StageAnsweringView.tsx";
  const src = read(file);
  assert.match(
    src,
    /const busyByTurnAnswers = cueForCurrentTurn\?\.busy \?\? false;\s*const busyWithOthers = live\.answering_paused \|\| busyByTurnAnswers;/,
    `${file}のbusyWithOthersがpendingCue由来のbusy以外から決まる形になっている`,
  );
  console.log(`PASS: ${file}のbusyWithOthersはpendingCue由来のbusyだけから決まる`);
}

console.log("ALL JUDGING_DISPLAY_BACKFILL_WIRING CHECKS PASSED");
