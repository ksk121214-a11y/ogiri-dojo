// 問題2対応：管理画面「SNS上での表示プレビュー」のテストライブ誤表示(#0000)バグの
// 回帰確認。src/lib/snsLiveResultPreview.tsの純粋関数（プレビュー表示可否・
// fetchDetail呼び出し可否の判定）を直接検証し、加えて実際に組み込まれている
// src/app/admin/live-results/[liveId]/page.tsxの静的検査（配線確認）で、
// 4箇所のfetchDetail呼び出しすべてがこの判定でガードされていること・
// プレビューカードがテストライブでは不自然な#0000表示にならないメッセージへ
// 差し替わっていることを確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shouldFetchSnsLiveResultDetail, shouldShowSnsLiveResultPreview } from "../snsLiveResultPreview";

// 1: 純粋関数の判定ロジック自体の確認。
{
  assert.equal(shouldShowSnsLiveResultPreview("official"), true, "officialライブでプレビューを表示すべきなのにfalseになった");
  assert.equal(shouldShowSnsLiveResultPreview("test"), false, "test ライブでプレビューを表示しないはずがtrueになった");
  assert.equal(shouldShowSnsLiveResultPreview(null), false, "live_modeがnullの場合にプレビューを表示してしまう");
  assert.equal(shouldShowSnsLiveResultPreview(undefined), false, "live_modeがundefinedの場合にプレビューを表示してしまう");

  assert.equal(shouldFetchSnsLiveResultDetail("official"), true, "official ライブでfetchDetailを呼ぶべきなのにfalseになった");
  assert.equal(shouldFetchSnsLiveResultDetail("test"), false, "test ライブでfetchDetailを呼ばないはずがtrueになった");
  assert.equal(shouldFetchSnsLiveResultDetail(null), false, "live_modeがnullの場合にfetchDetailを呼んでしまう");
  assert.equal(shouldFetchSnsLiveResultDetail(undefined), false, "live_modeがundefinedの場合にfetchDetailを呼んでしまう");

  console.log("PASS: shouldShowSnsLiveResultPreview/shouldFetchSnsLiveResultDetailはofficialの場合だけtrueを返す");
}

// 2: 配線確認（静的検査）：管理画面が実際にこれらの判定関数をimportし、
//    4箇所のfetchDetail呼び出し・プレビューカードの分岐に使っていること。
{
  const page = readFileSync(
    join(process.cwd(), "src", "app", "admin", "live-results", "[liveId]", "page.tsx"),
    "utf8",
  );

  assert.ok(
    /import \{ shouldFetchSnsLiveResultDetail, shouldShowSnsLiveResultPreview \} from "@\/lib\/snsLiveResultPreview";/.test(
      page,
    ),
    "管理画面がsrc/lib/snsLiveResultPreview.tsの判定関数をimportしていない",
  );

  // fetchDetail(...)の呼び出し箇所は4つ（load/refreshResultAnswers/
  // handleSaveManagerComment/handleTogglePublish）で、すべて
  // shouldFetchSnsLiveResultDetailの条件分岐配下にあること。
  const fetchDetailCalls = page.match(/fetchDetail\([^)]*\)/g) ?? [];
  assert.equal(fetchDetailCalls.length, 4, `fetchDetail呼び出し箇所が4箇所ではない（実際:${fetchDetailCalls.length}）`);

  const guardedCount = (page.match(/shouldFetchSnsLiveResultDetail\(/g) ?? []).length;
  assert.equal(
    guardedCount,
    4,
    `shouldFetchSnsLiveResultDetailによるガードが4箇所（fetchDetail呼び出し箇所と同数）になっていない（実際:${guardedCount}）`,
  );

  // 各fetchDetail呼び出しの直前十分な範囲にshouldFetchSnsLiveResultDetailの
  // 条件チェックが存在すること（呼び出しが素通しになっていないことの確認）。
  for (const call of fetchDetailCalls) {
    const idx = page.indexOf(call);
    assert.ok(idx >= 0, `fetchDetail呼び出し(${call})の位置が特定できない`);
    const before = page.slice(Math.max(0, idx - 200), idx);
    assert.ok(
      /shouldFetchSnsLiveResultDetail\(/.test(before),
      `fetchDetail呼び出し(${call})の直前にshouldFetchSnsLiveResultDetailによるガードが見当たらない`,
    );
  }

  // プレビューカードはshouldShowSnsLiveResultPreviewで分岐し、テストライブでは
  // 「#0000」につながるSnsLiveResultBodyのプレビュー表示を行わず、日本語の
  // 案内メッセージに差し替えていること。
  const previewCardIdx = page.indexOf('title="SNS上での表示プレビュー"');
  assert.ok(previewCardIdx >= 0, "SNS上での表示プレビューのAdminCardが見つからない");
  const previewCardBlock = page.slice(previewCardIdx, previewCardIdx + 600);
  assert.ok(
    /!shouldShowSnsLiveResultPreview\(live\.live_mode\)/.test(previewCardBlock),
    "プレビューカードがshouldShowSnsLiveResultPreview(live.live_mode)で分岐していない",
  );
  assert.ok(
    previewCardBlock.includes("テストライブのためSNSには公開されず、表示プレビューもありません"),
    "テストライブ向けの案内メッセージが見当たらない",
  );

  console.log(
    "PASS: 管理画面のfetchDetail呼び出し4箇所すべてがshouldFetchSnsLiveResultDetailでガードされ、プレビューカードもshouldShowSnsLiveResultPreviewで分岐している",
  );
}

console.log("ALL SNS_LIVE_RESULT_PREVIEW CHECKS PASSED");
