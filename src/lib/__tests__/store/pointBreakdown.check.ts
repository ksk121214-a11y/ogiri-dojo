// 最終結果画面のポイント表示分離（2026-09-22）の検証。
// 「今回の獲得」と「獲得ポイント」が同じ数字になっていたバグの修正で切り出した
// computePointBreakdownが、1位・2位・3位・4位以下（観客・ゲスト・テストライブは
// UI側の表示条件で呼ばれないだけで、この関数自体はrank=nullも含め正しく計算する
// 必要がある）の内訳・合計を正しく返すことを検証する。
import assert from "node:assert/strict";

import { computePointBreakdown, computeRankBonusPoints } from "@/lib/pointBreakdown";

function main() {
  // 1位：参加10 + 得点25 + 順位ボーナス100 = 135（要望に書かれている具体例と一致）。
  const first = computePointBreakdown(25, 1);
  assert.deepEqual(first, {
    ogiriPoints: 25,
    participationPoints: 10,
    rankBonusPoints: 100,
    totalPoints: 135,
  });
  console.log("PASS: 1位（大喜利25点）は今回の獲得25・参加10pt・ボーナス100pt・合計135ptになる");

  // 2位：順位ボーナス60。
  const second = computePointBreakdown(20, 2);
  assert.equal(second.rankBonusPoints, 60);
  assert.equal(second.totalPoints, 20 + 10 + 60);
  console.log("PASS: 2位は順位ボーナス60pt、合計は今回の獲得+参加10pt+60ptになる");

  // 3位：順位ボーナス30。
  const third = computePointBreakdown(15, 3);
  assert.equal(third.rankBonusPoints, 30);
  assert.equal(third.totalPoints, 15 + 10 + 30);
  console.log("PASS: 3位は順位ボーナス30pt、合計は今回の獲得+参加10pt+30ptになる");

  // 4位以下：順位ボーナス0。
  const fourth = computePointBreakdown(5, 4);
  assert.equal(fourth.rankBonusPoints, 0);
  assert.equal(fourth.totalPoints, 5 + 10 + 0);
  console.log("PASS: 4位以下は順位ボーナス0pt、合計は今回の獲得+参加10ptだけになる");

  // 参加人数が少ない等でrankがnull（=ランキングに載っていない）場合も0扱いにする。
  const noRank = computePointBreakdown(0, null);
  assert.equal(noRank.rankBonusPoints, 0);
  console.log("PASS: rank=nullでも例外にならず、順位ボーナスは0扱いになる");

  // 参加ポイントは常に10ptで、大喜利得点(ogiriPoints)は素通しされる（分離の核心）。
  assert.equal(computePointBreakdown(0, 1).participationPoints, 10);
  assert.equal(computePointBreakdown(999, null).ogiriPoints, 999);
  console.log("PASS: participationPointsは常に10pt、ogiriPointsは渡した値がそのまま素通しされる（分離できている）");

  // computeRankBonusPoints単体でも同じ値を返す（重複実装していないことの確認）。
  assert.equal(computeRankBonusPoints(1), 100);
  assert.equal(computeRankBonusPoints(2), 60);
  assert.equal(computeRankBonusPoints(3), 30);
  assert.equal(computeRankBonusPoints(4), 0);
  assert.equal(computeRankBonusPoints(null), 0);
  console.log("PASS: computeRankBonusPointsは1/2/3/4位以下/nullそれぞれで正しい順位ボーナスを返す");

  console.log("ALL POINT_BREAKDOWN CHECKS PASSED");
}

main();
