// 限定特典（最初の目撃者・限定アイコン）の対象ライブ判定の検証。
// DB側（0084の_apply_first_live_reward / mark_final_result_presence）と範囲が一致することも、
// 0084の本文から「1 and 5」の判定と、フロントの定数が同じ値であることで確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LIMITED_REWARD_MAX_OFFICIAL_SEQUENCE, isLimitedRewardLive } from "../limitedRewardEligibility";

// 1) 第1〜5回の公式ライブ・非緊急中止だけが対象
{
  for (let n = 1; n <= 5; n++) {
    assert.equal(isLimitedRewardLive("official", n, false), true, `official #${n} は対象のはず`);
  }
  console.log("PASS: 公式ライブの開催番号1〜5（緊急中止なし）は限定特典の対象");
}

// 2) 対象外：#0・#6以降・テスト・緊急中止・番号なし・小数・負数
{
  assert.equal(isLimitedRewardLive("official", 0, false), false, "#0は対象外");
  assert.equal(isLimitedRewardLive("official", 6, false), false, "#6は対象外");
  assert.equal(isLimitedRewardLive("official", 10, false), false, "#10は対象外");
  assert.equal(isLimitedRewardLive("official", -1, false), false, "負数は対象外");
  assert.equal(isLimitedRewardLive("official", 1.5, false), false, "小数は対象外");
  assert.equal(isLimitedRewardLive("official", null, false), false, "番号なしは対象外");
  assert.equal(isLimitedRewardLive("official", undefined, false), false, "番号未定義は対象外");
  assert.equal(isLimitedRewardLive("test", 1, false), false, "テストライブは対象外");
  assert.equal(isLimitedRewardLive(null, 1, false), false, "モード未定義は対象外");
  for (let n = 1; n <= 5; n++) {
    assert.equal(isLimitedRewardLive("official", n, true), false, `緊急中止の#${n}は対象外`);
  }
  console.log("PASS: #0・#6以降・テスト・番号なし・緊急中止は限定特典の対象外");
}

// 3) 定数と、DB側0084の範囲判定が一致している
{
  assert.equal(LIMITED_REWARD_MAX_OFFICIAL_SEQUENCE, 5, "フロントの上限は5のはず");
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0084_live_limited_rewards_to_round5_and_timing.sql"), "utf8");
  const rangeChecks = sql.match(/official_sequence_number not between 1 and 5 then/g) ?? [];
  assert.equal(rangeChecks.length, 2, "0084の2つの関数（mark・_apply）がどちらも1〜5の範囲判定になっていない");
  assert.ok(!/official_sequence_number <> 1 then/.test(sql), "0084に旧来の#1限定判定が残っている");
  console.log("PASS: フロントの対象判定（上限5）と0084のDB判定（1〜5）が一致している");
}
