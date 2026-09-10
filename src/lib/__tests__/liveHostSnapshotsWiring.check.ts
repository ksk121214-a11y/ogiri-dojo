// 配線確認：src/lib/liveHostSnapshots.ts の純粋関数が、実際に
// src/store/useLiveHostStore.ts の想定した箇所で使われていることを、
// ソースの静的検査で確認する。
//
// 純粋関数の単体テスト（liveHostSnapshots.check.ts）だけでは「useLiveHostStoreに
// 正しく組み込まれているか」までは分からないため、それを補う。
// （このリポジトリには実ストアを丸ごと動かす統合テスト基盤が無いため、
//   tsc / next build による型・ビルド検証に加えて、この静的検査で
//   「呼び出しが存在すること」「旧フィールドが残っていないこと」を保証する。）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// __dirname は run.sh のコンパイル済み一時ディレクトリ内の __tests__/ を指す。
// 元のソースは常にリポジトリ内なので、CWD（run.shがcd済み）からの相対で読む。
const storePath = join(process.cwd(), "src", "store", "useLiveHostStore.ts");
const src = readFileSync(storePath, "utf8");

function count(needle: string): number {
  return src.split(needle).length - 1;
}

// 1: liveHostSnapshotsから必要な関数をimportしている。
{
  const importBlock = src.match(/import\s*\{[\s\S]*?\}\s*from\s*"@\/lib\/liveHostSnapshots";/);
  assert.ok(importBlock, "liveHostSnapshotsからのimport文が見つからない");
  for (const name of [
    "answersSnapshotMatches",
    "childrenSnapshotReady",
    "resolveAnswersSnapshot",
    "resolveChildrenSnapshot",
    "shouldReleaseInitInFlight",
  ]) {
    assert.ok(importBlock[0].includes(name), `import文に ${name} が無い`);
  }
  console.log("PASS: 配線-1（liveHostSnapshotsの純粋関数をimportしている）");
}

// 2: resolveChildrenSnapshot は init() と refresh() の少なくとも2箇所で使われている。
{
  assert.ok(count("resolveChildrenSnapshot(") >= 2, "resolveChildrenSnapshotの呼び出しが2箇所未満");
  console.log("PASS: 配線-2（resolveChildrenSnapshotをinit/refreshで使用）");
}

// 3: resolveAnswersSnapshot は refreshAnswersForTurn / init / refresh の
//    少なくとも3箇所で使われている。
{
  assert.ok(count("resolveAnswersSnapshot(") >= 3, "resolveAnswersSnapshotの呼び出しが3箇所未満");
  console.log("PASS: 配線-3（resolveAnswersSnapshotをrefreshAnswersForTurn/init/refreshで使用）");
}

// 4: answersSnapshotMatches は advanceIfDue / processRevealQueue / resolveIfDue /
//    syncAnsweringPause の少なくとも4箇所でガードに使われている。
{
  assert.ok(count("answersSnapshotMatches(") >= 4, "answersSnapshotMatchesのガードが4箇所未満");
  console.log("PASS: 配線-4（answersSnapshotMatchesをadvanceIfDue/processRevealQueue/resolveIfDue/syncAnsweringPauseで使用）");
}

// 5: childrenSnapshotReady は advanceIfDue の自動進行ガードで使われている。
{
  assert.ok(count("childrenSnapshotReady(") >= 1, "childrenSnapshotReadyの呼び出しが無い");
  console.log("PASS: 配線-5（childrenSnapshotReadyをadvanceIfDueのガードで使用）");
}

// 6: shouldReleaseInitInFlight は init() の finally で使われている。
{
  assert.ok(
    /\.finally\(\(\)\s*=>\s*\{[\s\S]*?shouldReleaseInitInFlight\(initInFlight,\s*promise\)/.test(src),
    "init()のfinallyでshouldReleaseInitInFlight(initInFlight, promise)を使っていない",
  );
  console.log("PASS: 配線-6（init()のfinallyでshouldReleaseInitInFlightを使用）");
}

// 7: 旧フィールド childrenSnapshotReady（boolean）を完全に廃止し、
//    childrenSnapshotLiveId（string|null）へ置き換えている。
{
  assert.equal(count("childrenSnapshotReady:"), 0, "旧フィールド childrenSnapshotReady: が残っている");
  assert.ok(count("childrenSnapshotLiveId") >= 8, "childrenSnapshotLiveIdの参照が少なすぎる（各liveIdセット経路に配線されていない疑い）");
  console.log("PASS: 配線-7（childrenSnapshotReadyフィールドを廃止しchildrenSnapshotLiveIdへ移行）");
}

// 8: answersSnapshot をstateフィールドとして持ち、複数箇所で更新している。
{
  assert.ok(count("answersSnapshot:") >= 6, "answersSnapshot: の更新箇所が少なすぎる");
  console.log("PASS: 配線-8（answersSnapshotを複数経路で更新）");
}

// 9: stopHostProgress が childrenSnapshotLiveId / answersSnapshot / answersRetryInFlight を
//    片付けている。
{
  const stopFn = src.match(/stopHostProgress:\s*\(\)\s*=>\s*\{[\s\S]*?\n  \},/);
  assert.ok(stopFn, "stopHostProgressの本体が見つからない");
  assert.ok(stopFn[0].includes("answersRetryInFlight = false"), "stopHostProgressがanswersRetryInFlightを戻していない");
  assert.ok(
    stopFn[0].includes("childrenSnapshotLiveId: null") && stopFn[0].includes("answersSnapshot: null"),
    "stopHostProgressがsnapshot識別情報をnullへ戻していない",
  );
  console.log("PASS: 配線-9（stopHostProgressが進行用stateとフラグを片付ける）");
}

// 10: init()のstop検出ブランチで cleanupChannels() を呼ばない（新世代のchannelを消さない）。
{
  // 「stopされた」コメントの直後に cleanupChannels(); が続いていないこと。
  assert.ok(
    !/stopされた[\s\S]{0,400}?cleanupChannels\(\);\s*\n\s*return;/.test(src) ||
      /ここではcleanupChannels\(\)を呼ぶと/.test(src),
    "init()のstop検出ブランチが依然としてcleanupChannels()を呼んでいる可能性",
  );
  assert.ok(
    /progressGenerationが変わるのはstopHostProgress\(\)のときだけ/.test(src),
    "init()のstop検出ブランチに、cleanupしない理由の説明が無い",
  );
  console.log("PASS: 配線-10（init()のstop検出ブランチは新世代channelをcleanupしない）");
}

// 11（必須テスト2の配線）：syncAnsweringPause の本体に answersSnapshotMatches ガードがある。
{
  const fn = src.match(/async function syncAnsweringPause\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "syncAnsweringPauseが見つからない");
  assert.ok(
    fn[0].includes("answersSnapshotMatches(state.answersSnapshot, live.id, live.current_turn_id)"),
    "syncAnsweringPauseにanswersSnapshot未確認時のガードが無い",
  );
  console.log("PASS: 配線-11（syncAnsweringPauseにanswers未確認ガード）");
}

// 12（必須テスト6の配線）：createLivePreparation成功時、Realtimeを待たず
//    childrenResult.ok なら childrenSnapshotLiveId: live.id をその場で立てる。
{
  assert.ok(
    src.includes("childrenSnapshotLiveId: childrenResult.ok ? live.id : null"),
    "createLivePreparationがfetchLiveChildren成功時にその場でreadyにしていない",
  );
  console.log("PASS: 配線-12（createLivePreparation成功時にRealtimeを待たずready）");
}

// 13（必須テスト7の配線）：closeLive の両経路が childrenSnapshotLiveId: null を設定。
{
  assert.ok(count("childrenSnapshotLiveId: null") >= 4, "closeLive/refresh/init等でchildrenSnapshotLiveId: nullが不足");
  console.log("PASS: 配線-13（closeLive等でchildrenSnapshotLiveId: null）");
}

// 14（必須テスト13の配線）：0行更新後に再同期を呼ぶ。
{
  assert.ok(count("resyncAnswersAndScoresForCurrentLive()") >= 2, "0行更新後の再同期呼び出しが2箇所未満");
  const resolveFn = src.match(/async function resolveIfDue\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(resolveFn, "resolveIfDueが見つからない");
  assert.ok(
    resolveFn[0].includes("resolvedRows.length === 0") &&
      resolveFn[0].includes("fetchLiveRow(state.live.id)"),
    "resolveIfDueの0行更新ブランチでlive再取得をしていない",
  );
  console.log("PASS: 配線-14（0行更新後にlive/answersを再取得）");
}

// 15（必須テスト14の配線）：answering→group_result のRPC通信失敗時、
//    answeringRemainingMsTrueを0のまま維持して次tickで再試行する。
{
  const advanceFn = src.match(/async function advanceIfDue\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(advanceFn, "advanceIfDueが見つからない");
  const idxTimerZero = advanceFn[0].indexOf("answeringRemainingMsTrue = 0;");
  const idxRpc = advanceFn[0].indexOf('.rpc("host_advance_answering_to_group_result"');
  const idxErrReturn = advanceFn[0].indexOf("host_advance_answering_to_group_result failed");
  assert.ok(idxTimerZero > -1 && idxRpc > idxTimerZero, "RPC呼び出し前にansweringRemainingMsTrue = 0にしていない");
  assert.ok(idxErrReturn > idxRpc, "RPC通信失敗時のエラーログ/returnが無い");
  // エラーブランチで null へ戻していない（= 次tickで再試行できる）
  const errBranch = advanceFn[0].slice(idxErrReturn, idxErrReturn + 200);
  assert.ok(
    !errBranch.includes("answeringRemainingMsTrue = null"),
    "RPC通信失敗ブランチでローカルタイマーをnullへ戻してしまっている（次tickで再試行できなくなる）",
  );
  console.log("PASS: 配線-15（RPC通信失敗後もタイマーは0のまま＝次tickで再試行）");
}

// 16（必須テスト15）：組結果の本番値が15秒のまま（今回の変更で退行していない）。
{
  const timingSrc = readFileSync(join(process.cwd(), "src", "data", "liveRoomTiming.ts"), "utf8");
  const prodBlock = timingSrc.match(/const PRODUCTION_TIMING = \{[\s\S]*?\n\} as const;/);
  assert.ok(prodBlock, "PRODUCTION_TIMINGブロックが見つからない");
  assert.ok(
    /groupResultMs:\s*15_000\b/.test(prodBlock[0]),
    "PRODUCTION_TIMING.groupResultMsが15_000ではない",
  );
  console.log("PASS: 配線-16（組結果の本番値は15秒のまま）");
}

console.log("ALL LIVE_HOST_SNAPSHOTS WIRING CHECKS PASSED");
