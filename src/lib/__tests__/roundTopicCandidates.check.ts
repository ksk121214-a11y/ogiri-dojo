// 実機要望対応：次の周のお題を「登録済みのお題（topic_bank）」から選べるようにしたことに伴う、
// 候補絞り込みロジック（src/lib/roundTopicCandidates.ts）の検証。
// ・このライブで既に使ったお題（topic_bank_idで判定）は候補から除外する。
// ・旧データ・手入力経由で本文が同じ既存topicsも、trim済み本文で重複と見なして除外する。
// ・同じ次回ラウンド内で、他の組が今まさに選んでいるお題も候補から除外する。
// ・手入力は常に可能（この絞り込みの対象外）。
import assert from "node:assert/strict";

import { candidatesForGroup, usedBodySet, usedTopicBankIdSet, type ExistingTopicRef } from "../roundTopicCandidates";

const TOPIC_BANK = [
  { id: "bank-1", body: "お題A" },
  { id: "bank-2", body: "お題B" },
  { id: "bank-3", body: "お題C" },
  { id: "bank-4", body: "お題D" },
];

function main() {
  // ---- 既に使ったお題（topic_bank_idで判定）は候補から除外される ----
  {
    const existing: ExistingTopicRef[] = [{ topic_bank_id: "bank-1", body: "お題A" }];
    const used = usedTopicBankIdSet(existing);
    const bodies = usedBodySet(existing);
    const candidates = candidatesForGroup(TOPIC_BANK, used, bodies, new Set());
    assert.deepEqual(candidates.map((c) => c.id), ["bank-2", "bank-3", "bank-4"]);
    console.log("PASS: topic_bank_idで既に使われたお題（bank-1）は候補から除外される");
  }

  // ---- 旧データ・手入力経由で本文が一致する既存topics（topic_bank_idは無し）も除外される ----
  {
    const existing: ExistingTopicRef[] = [{ topic_bank_id: null, body: "  お題B  " }]; // 前後に空白（旧データ/手入力想定）
    const used = usedTopicBankIdSet(existing);
    const bodies = usedBodySet(existing);
    const candidates = candidatesForGroup(TOPIC_BANK, used, bodies, new Set());
    assert.ok(!candidates.some((c) => c.id === "bank-2"), "trim済み本文が一致する手入力の既存お題が除外されていない");
    assert.deepEqual(candidates.map((c) => c.id), ["bank-1", "bank-3", "bank-4"]);
    console.log("PASS: topic_bank_idが無い（手入力・旧データ）既存topicsも、trim済み本文の一致で候補から除外される");
  }

  // ---- 同じ次回ラウンド内で、他の組が選択中のお題は候補から除外される ----
  {
    const used = usedTopicBankIdSet([]);
    const bodies = usedBodySet([]);
    const pickedByOtherGroups = new Set(["bank-3"]);
    const candidates = candidatesForGroup(TOPIC_BANK, used, bodies, pickedByOtherGroups);
    assert.deepEqual(candidates.map((c) => c.id), ["bank-1", "bank-2", "bank-4"]);
    console.log("PASS: 同じ次回ラウンド内で他の組が選択中のお題（bank-3）は候補から除外される");
  }

  // ---- 自分自身が選んでいるお題は除外対象にならない（pickedByOtherGroupsに自分は含めない前提） ----
  {
    const used = usedTopicBankIdSet([]);
    const bodies = usedBodySet([]);
    // 呼び出し側（RoundDecisionPanel）がpickedByOtherGroupsを組み立てる際、自分の
    // groupIdは除外して渡す前提。ここではその前提どおりの入力で、自分の選択中IDが
    // 候補として残り続けることを確認する（再選択・選択解除を妨げない）。
    const pickedByOtherGroups = new Set<string>();
    const candidates = candidatesForGroup(TOPIC_BANK, used, bodies, pickedByOtherGroups);
    assert.ok(candidates.some((c) => c.id === "bank-1"), "自分が選択中のお題まで候補から消えてしまっている");
    console.log("PASS: pickedByOtherGroupsに自分自身のgroupIdを含めない限り、自分が選択中のお題は候補に残る");
  }

  // ---- 何も使われていなければ全件が候補になる・手入力はこの絞り込みに影響されない ----
  {
    const candidates = candidatesForGroup(TOPIC_BANK, new Set(), new Set(), new Set());
    assert.equal(candidates.length, 4);
    console.log("PASS: 既存お題・他組の選択が無い場合は登録済みのお題が全件候補になる（手入力は常に別途選べる＝UI側の固定の「手入力」選択肢）");
  }

  // ---- 複数条件の複合（既に使用＋他組選択中の両方が同時に働く） ----
  {
    const existing: ExistingTopicRef[] = [{ topic_bank_id: "bank-4", body: "お題D" }];
    const used = usedTopicBankIdSet(existing);
    const bodies = usedBodySet(existing);
    const pickedByOtherGroups = new Set(["bank-2"]);
    const candidates = candidatesForGroup(TOPIC_BANK, used, bodies, pickedByOtherGroups);
    assert.deepEqual(candidates.map((c) => c.id), ["bank-1", "bank-3"]);
    console.log("PASS: 「既に使用」と「他組が選択中」の両方の除外条件が同時に正しく働く");
  }

  console.log("ALL ROUND_TOPIC_CANDIDATES CHECKS PASSED");
}

main();
