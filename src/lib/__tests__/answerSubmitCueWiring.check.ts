// StageAnsweringView.tsx / AudienceAnsweringView.tsxが、回答音の二重再生修正
// （src/lib/answerSubmitCue.ts、検証本体はanswerSubmitCue.check.ts）を正しく配線しており、
// 削除対象だったフリップ時のspotlightIn再生effect・不要なplaySfx importが残っていないことを
// 静的に確認する（既存の*.check.tsのスタイルを踏襲）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

for (const file of ["src/components/live-room/StageAnsweringView.tsx", "src/components/live-room/AudienceAnsweringView.tsx"]) {
  const src = read(file);

  assert.match(
    src,
    /import \{ initialAnswerCueState, nextAnswerCueState \} from "@\/lib\/answerSubmitCue";/,
    `${file}がanswerSubmitCueの純粋ステートマシンを読み込んでいない`,
  );
  assert.doesNotMatch(src, /playSfx/, `${file}に不要なplaySfx importまたは呼び出しが残っている`);
  assert.doesNotMatch(src, /spotlightIn/, `${file}にフリップ時のspotlightIn再生effectが残っている`);
  assert.doesNotMatch(src, /spotlightSeenRef/, `${file}に不要なspotlightSeenRefが残っている`);

  assert.match(
    src,
    /useState\(\(\) => initialAnswerCueState\(busyNow\)\)/,
    `${file}がinitialAnswerCueStateで初期状態を作っていない`,
  );
  // 2026-10 lint対応：effect内でのsetState（react-hooks/set-state-in-effect）を避け、
  // boardRoundIdと同じ「レンダー中に直接setStateして即座に再レンダーさせる」パターンにした。
  assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*setAnswerCueState/, `${file}がeffect内でsetAnswerCueStateを呼んでいる（react-hooks/set-state-in-effectに違反する）`);
  assert.match(
    src,
    /const computedAnswerCueState = nextAnswerCueState\(answerCueState, busyNow, cueTurnId, cueRevision\);/,
    `${file}がbusy/cueTurnId/cueRevisionの変化をnextAnswerCueStateへ渡していない`,
  );
  assert.match(
    src,
    /if \(\s*computedAnswerCueState\.wasBusy !== answerCueState\.wasBusy \|\|\s*computedAnswerCueState\.cueId !== answerCueState\.cueId\s*\) \{\s*setAnswerCueState\(computedAnswerCueState\);\s*\}/,
    `${file}が変化時だけsetAnswerCueStateを呼ぶ形になっていない`,
  );
  assert.match(
    src,
    /const answerSubmitCue = busyNow && answerCueState\.cueId \? \{ cueId: answerCueState\.cueId \} : null;/,
    `${file}のanswerSubmitCueがanswerCueState.cueIdから組み立てられていない`,
  );

  console.log(`PASS: ${file}はanswerSubmitCueの立ち上がり検知を使い、spotlightIn再生effect・playSfx importが削除されている`);
}

console.log("ALL ANSWER_SUBMIT_CUE_WIRING CHECKS PASSED");
