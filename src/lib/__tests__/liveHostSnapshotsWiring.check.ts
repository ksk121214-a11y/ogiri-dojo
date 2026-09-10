// 配線確認：src/lib/liveHostSnapshots.ts の仕組みが、実際に
// src/store/useLiveHostStore.ts の想定した箇所へ組み込まれていることを、
// ソースの静的検査で確認する（純粋関数の単体テストだけでは配線が分からないため）。
// tsc / next build ＋ liveHostSnapshots.check.ts（遅延Promise・DB書き込みモックで
// 完全復旧オーケストレーション・所有権・await ごとの凍結再確認を検証）に加えて、
// この静的検査を置く。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src", "store", "useLiveHostStore.ts"), "utf8");
const count = (needle: string) => src.split(needle).length - 1;

// 1: liveHostSnapshots から必要な関数をimportしている。
{
  const m = src.match(/import\s*\{[\s\S]*?\}\s*from\s*"@\/lib\/liveHostSnapshots";/);
  assert.ok(m, "liveHostSnapshotsからのimport文が見つからない");
  for (const name of [
    "answersSnapshotMatches",
    "awaitChannelsSubscribed",
    "botScoringAllowed",
    "childrenSnapshotReady",
    "createChannelSwapController",
    "createRecoveryCoordinator",
    "createSliceGate",
    "hydrateAfterLive",
    "insertGuardPasses",
    "loadSnapshotSlice",
    "progressionFrozen",
    "runGuardedSteps",
    "scoresSnapshotMatches",
    "shouldReleaseInitInFlight",
    "shouldReleaseRetryFlag",
    "shouldRetryNow",
  ]) {
    assert.ok(m[0].includes(name), `import文に ${name} が無い`);
  }
  console.log("PASS: 配線-1（必要な純粋関数をimport）");
}

// 2: 5スライスゲート ＋ 完全復旧の所有権コーディネータ ＋ runtime確立トラッキング。
{
  for (const g of ["liveGate", "childrenGate", "answersGate", "resolvedGate", "scoresGate"]) {
    assert.ok(src.includes(`const ${g} = createSliceGate()`), `${g} を createSliceGate で作っていない`);
  }
  assert.ok(src.includes("const recovery = createRecoveryCoordinator()"), "recovery コーディネータが無い");
  assert.ok(/let subscribedLiveId: string \| null = null;/.test(src), "subscribedLiveId が無い");
  assert.ok(/let runtimeReadyLiveId: string \| null = null;/.test(src), "runtimeReadyLiveId が無い");
  assert.ok(
    /const channelSwap = createChannelSwapController<[\s\S]{0,120}?>\(\{/.test(src),
    "DB購読チャンネルの入れ替え管理（createChannelSwapController）が無い",
  );
  assert.ok(/let currentChannelTracker: ChannelSubscriptionTracker \| null = null;/.test(src), "currentChannelTracker が無い");
  console.log("PASS: 配線-2（5スライスゲート ＋ recoveryコーディネータ ＋ channelSwapController）");
}

// 3: 各取得経路が loadSnapshotSlice を通っている。
{
  assert.ok(count("loadSnapshotSlice") >= 12, `loadSnapshotSlice の使用箇所が少なすぎる (${count("loadSnapshotSlice")})`);
  console.log("PASS: 配線-3（各取得経路が loadSnapshotSlice を通る）");
}

// 4: 取得失敗で確認済みのままにしない：未確認へ戻す経路が十分にある。
{
  assert.ok(count("childrenSnapshotLiveId: null") >= 5, "childrenSnapshotLiveId:null への戻しが不足");
  assert.ok(count("answersSnapshot: null") >= 5, "answersSnapshot:null への戻しが不足");
  assert.ok(count("scoresSnapshot: null") >= 5, "scoresSnapshot:null への戻しが不足");
  assert.ok(count("liveSnapshotConfirmed: false") >= 4, "liveSnapshotConfirmed:false への戻しが不足");
  console.log("PASS: 配線-4（取得失敗時に確認状態を未確認へ戻す経路が複数）");
}

// 5: P2-1（再取得を「開始した」時点で未確認化）：主要な再取得経路が markPending を持つ。
{
  assert.ok(count("markPending:") >= 8, `markPending の配線が少なすぎる (${count("markPending:")})`);
  for (const anchor of [
    /const refetchLive =[\s\S]*?markPending: \(\) => useLiveHostStore\.setState\(\{ liveSnapshotConfirmed: false \}\)/,
    /const refetchChildren =[\s\S]*?markPending: \(\) => useLiveHostStore\.setState\(\{ childrenSnapshotLiveId: null \}\)/,
    /function refreshAnswersForTurn[\s\S]*?markPending: \(\) => useLiveHostStore\.setState\(\{ answersSnapshot: null \}\)/,
    /async function refreshScoresForActiveAnswer[\s\S]*?markPending: \(\) => useLiveHostStore\.setState\(\{ scoresSnapshot: null \}\)/,
  ]) {
    assert.ok(anchor.test(src), `再取得経路の markPending 配線が見つからない: ${anchor}`);
  }
  console.log("PASS: 配線-5（Realtime/refresh/再試行の再取得開始時点で未確認化する）");
}

// 6: advanceIfDue：(a) live未確認→retryLiveSnapshot、(b) 進行環境未確立→ensureHostRecovery、
//    (c) children未確認→retryChildrenSnapshot。
{
  const fn = src.match(/async function advanceIfDue\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "advanceIfDue が見つからない");
  assert.ok(
    /if \(!state\.liveSnapshotConfirmed\) \{\s*\n\s*retryLiveSnapshot\(\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が live 未確認時に retryLiveSnapshot だけして return していない",
  );
  assert.ok(
    /if \(!isHostRuntimeEstablished\(live\)\) \{\s*\n\s*retryLiveSnapshot\(\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が『進行環境未確立→retryLiveSnapshot（throttle付き完全復旧合流）』していない（P1-1）",
  );
  assert.ok(
    /if \(!childrenSnapshotReady\(state\.childrenSnapshotLiveId, live\.id\)\) \{\s*\n\s*retryChildrenSnapshot\(live\.id\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が children 未確認時に retryChildrenSnapshot だけして return していない",
  );
  console.log("PASS: 配線-6（advanceIfDue: live未確認/環境未確立/children未確認 の3段ガード）");
}

// 7: P2（await ごとに凍結を再確認）：answering分岐が runGuardedSteps を使い、
//    ステップは processRevealQueue → runBotBehavior → resolveIfDue → syncAnsweringPause。
{
  const fn = src.match(/async function advanceIfDue\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.ok(
    /const guarded = await runGuardedSteps\(\s*\n\s*\(\) => progressFrozenForTick\(tickGeneration, tickLiveId, true\),/.test(fn[0]),
    "answering分岐が runGuardedSteps + progressFrozenForTick を使っていない",
  );
  for (const step of ["processRevealQueue", "runBotBehavior", "resolveIfDue", "syncAnsweringPause"]) {
    assert.ok(
      new RegExp(`name: "${step}", run: \\(\\) => ${step}\\(tickGeneration, tickLiveId\\)`).test(fn[0]),
      `runGuardedSteps のステップに ${step}(tickGeneration, tickLiveId) が無い`,
    );
  }
  assert.ok(/if \(guarded\.blockedAt !== null\) return;/.test(fn[0]), "blockedAt を見て return していない");
  assert.ok(
    /function progressFrozenForTick\(\s*\n?\s*tickGeneration: number,\s*\n?\s*tickLiveId: string \| null,\s*\n?\s*requireAnswers: boolean,\s*\n?\s*\): boolean/.test(src),
    "progressFrozenForTick の定義が想定と違う",
  );
  assert.ok(/return progressionFrozen\(/.test(src), "progressFrozenForTick が progressionFrozen へ委譲していない");
  assert.ok(!/function autoProgressFrozen\(/.test(src), "旧 autoProgressFrozen が残っている");
  assert.ok(count("progressFrozenForTick(tickGeneration, tickLiveId") >= 6, "遷移RPC直前の再確認が不足");
  console.log("PASS: 配線-7（answering分岐は runGuardedSteps で各awaitごとに凍結を再確認）");
}

// 8: 多層防御：processRevealQueue / resolveIfDue / syncAnsweringPause / runBotBehavior が
//    tickGeneration/tickLiveId を受け取り、DB書き込み直前に progressFrozenForTick を呼ぶ。
{
  for (const fn of ["processRevealQueue", "resolveIfDue", "syncAnsweringPause", "runBotBehavior"]) {
    const m = src.match(new RegExp(`async function ${fn}\\(tickGeneration: number, tickLiveId: string \\| null\\)`));
    assert.ok(m, `${fn} が tickGeneration/tickLiveId を受け取っていない`);
  }
  // reveal / resolve / pause / resume の各 DB 書き込み直前の多層ガード。
  assert.ok(
    /reveal 更新の直前でもう一度凍結を確認する[\s\S]{0,80}?progressFrozenForTick\(tickGeneration, tickLiveId, true\)/.test(src),
    "processRevealQueue の reveal 更新直前ガードが無い",
  );
  assert.ok(
    /確定 UPDATE の直前でもう一度凍結を確認する[\s\S]{0,80}?progressFrozenForTick\(tickGeneration, tickLiveId, true\)/.test(src),
    "resolveIfDue の確定 UPDATE 直前ガードが無い",
  );
  assert.ok(
    /pause UPDATE の直前[\s\S]{0,80}?progressFrozenForTick\(tickGeneration, tickLiveId, true\)/.test(src) &&
      /resume UPDATE の直前[\s\S]{0,80}?progressFrozenForTick\(tickGeneration, tickLiveId, true\)/.test(src),
    "syncAnsweringPause の pause/resume UPDATE 直前ガードが無い",
  );
  console.log("PASS: 配線-8（各ヘルパーが世代/liveId を受け取り DB 書き込み直前に再確認）");
}

// 9: runBotBehavior：answers/children/scores 同期中はボット insert しない。
{
  const fn = src.match(/async function runBotBehavior\([\s\S]*?\n\}\n/);
  assert.ok(fn, "runBotBehavior が見つからない");
  assert.ok(
    /if \(progressFrozenForTick\(tickGeneration, tickLiveId, true\)\) return;/.test(fn[0]),
    "runBotBehavior 冒頭の凍結ガードが無い（answers/children同期中はボット行動しない）",
  );
  assert.ok(
    /const botScoringOk = botScoringAllowed\(/.test(fn[0]),
    "runBotBehavior が botScoringAllowed（scores同期中はボット採点しない）を使っていない",
  );
  assert.ok(/} else if \(activeAnswer && botScoringOk\) \{/.test(fn[0]), "ボット採点分岐が botScoringOk でガードされていない");
  assert.ok(
    /if \(!stillOnThisTurn\(\)\) return;/.test(fn[0]) && count("if (!stillOnThisTurn()) return;") >= 2,
    "Promise.all 内の insert 直前に stillOnThisTurn()（insertGuardPasses）再確認が無い",
  );
  assert.ok(
    /if \(\s*\n?\s*!scoresSnapshotMatches\(sNow\.scoresSnapshot, live\.id, turn\.id, activeAnswer\.id\)\s*\n?\s*\)/.test(fn[0]),
    "ボット採点 insert 直前の scoresSnapshot 再確認が無い（必須10）",
  );
  console.log("PASS: 配線-9（runBotBehavior: 同期中は回答/採点insertしない＋insert直前の再確認）");
}

// 10: retryLiveSnapshot：runtime確立済みなら軽量 fetchLiveRow、未確立なら ensureHostRecovery。
{
  const fn = src.match(/function retryLiveSnapshot\(\)[\s\S]*?\n\}\n/);
  assert.ok(fn, "retryLiveSnapshot が見つからない");
  assert.ok(fn[0].includes("if (initInFlight) return;"), "retryLiveSnapshot の init 実行中ガードが無い");
  assert.ok(
    /if \(live && subscribedLiveId === live\.id && runtimeReadyLiveId === live\.id\) \{[\s\S]*?fetchLiveRow\(live\.id\)/.test(fn[0]),
    "runtime確立済みのときの軽量 fetchLiveRow 経路が無い",
  );
  assert.ok(
    /void ensureHostRecovery\(myGeneration\)/.test(fn[0]),
    "未確立のときに ensureHostRecovery へ合流していない",
  );
  assert.ok(
    /shouldReleaseRetryFlag\(progressGeneration, myGeneration\)/.test(fn[0]),
    "retryLiveSnapshot の finally が所有権判定なしでフラグを解除している",
  );
  console.log("PASS: 配線-10（retryLiveSnapshot: 軽量 fetchLiveRow / 完全復旧合流 の使い分け）");
}

// 11: 再試行4種は single-flight ＋ 最小間隔 ＋ 所有権付き finally。
{
  assert.ok(src.includes("const SNAPSHOT_RETRY_INTERVAL_MS = 2_000"), "再試行の最小間隔定数が無い/2秒でない");
  for (const fn of ["retryChildrenSnapshot", "retryAnswersSnapshot", "retryScoresSnapshot"]) {
    const m = src.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
    assert.ok(m, `${fn} が見つからない`);
    assert.ok(m[0].includes("shouldRetryNow("), `${fn} が shouldRetryNow を使っていない`);
    assert.ok(
      /shouldReleaseRetryFlag\(progressGeneration, myGeneration\)/.test(m[0]),
      `${fn} の finally が所有権判定なしでフラグを解除している`,
    );
  }
  console.log("PASS: 配線-11（再試行は single-flight ＋ 最小間隔2秒 ＋ 所有権付き解除）");
}

// 12: init / refresh が完全復旧オーケストレーション（ensureHostRecovery）へ合流する。
{
  const initFn = src.match(/init: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(initFn, "init が見つからない");
  assert.ok(
    /const outcome = await ensureHostRecovery\(myGeneration\);/.test(initFn[0]),
    "init が ensureHostRecovery を使っていない",
  );
  assert.ok(!/tickTimer = setInterval/.test(initFn[0]), "init が setInterval を直接呼んでいる");

  const refreshFn = src.match(/refresh: async \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(refreshFn, "refresh が見つからない");
  assert.ok(
    /if \(!live0 \|\| !get\(\)\.liveSnapshotConfirmed \|\| !isHostRuntimeEstablished\(live0\)\) \{\s*\n\s*const outcome = await ensureHostRecovery\(progressGeneration\);/.test(
      refreshFn[0],
    ),
    "refresh が未初期化/未確立時に ensureHostRecovery へ合流していない（P1-1）",
  );
  assert.ok(!refreshFn[0].includes("liveError.message"), "refresh が生の liveError.message を返している");
  assert.ok(!/reason: e instanceof Error \? e\.message/.test(refreshFn[0]), "refresh が生の例外メッセージを返している");
  console.log("PASS: 配線-12（init/refresh が完全復旧オーケストレーションへ合流・生エラー非露出）");
}

// 13: hydrateHostForActiveLive：hydrateAfterLive を使い、target-changed ループ・
//     recoveryToken の所有権確認・runtimeReadyLiveId 記録を持つ。
{
  assert.ok(
    /async function hydrateHostForActiveLive\(\s*\n?\s*generation: number,\s*\n?\s*recoveryToken: number,\s*\n?\s*\): Promise<HydrateOutcome>/.test(src),
    "hydrateHostForActiveLive が recoveryToken を受け取っていない",
  );
  assert.ok(src.includes("hydrateAfterLive({"), "hydrateHostForActiveLive が hydrateAfterLive を使っていない");
  assert.ok(/for \(let attempt = 0; attempt < 3; attempt\+\+\)/.test(src), "target-changed のやり直しループが無い");
  assert.ok(/if \(result === "target-changed"\) \{[\s\S]{0,120}?continue;/.test(src), "target-changed 時に新liveIdでやり直していない");
  assert.ok(/ownsRecovery: \(\) => recovery\.owns\(recoveryToken\)/.test(src), "hydrateAfterLive に ownsRecovery を渡していない");
  assert.ok(/markRuntimeReady: \(\) => \{[\s\S]{0,120}?runtimeReadyLiveId = targetLiveId;/.test(src), "markRuntimeReady で runtimeReadyLiveId を記録していない");
  assert.ok(
    /subscribeAndWait: \(\) =>[\s\S]{0,260}?subscribeAndWaitForLive\(\s*\n?\s*targetLiveId,/.test(src),
    "subscribeAndWait が subscribeAndWaitForLive(targetLiveId, ...) を使っていない（P1-2：SUBSCRIBED を待つ）",
  );
  assert.ok(
    /function ensureHostRecovery\(generation: number\): Promise<HostHydrationOutcome> \{\s*\n\s*return recovery\.run\(/.test(src),
    "ensureHostRecovery が recovery.run 経由になっていない",
  );
  console.log("PASS: 配線-13（hydrateHostForActiveLive: target-changed ループ ＋ 所有権 ＋ SUBSCRIBED待ち購読 ＋ runtimeReady 記録）");
}

// 14: isHostRuntimeEstablished：tickTimer / subscribedLiveId / runtimeReadyLiveId /
//     answeringタイマー復元 を全て確認する。
{
  const fn = src.match(/function isHostRuntimeEstablished\(live: LiveRow\): boolean \{[\s\S]*?\n\}/);
  assert.ok(fn, "isHostRuntimeEstablished が見つからない");
  assert.ok(/if \(tickTimer === null\) return false;/.test(fn[0]), "tickTimer の確認が無い");
  assert.ok(/if \(subscribedLiveId !== live\.id\) return false;/.test(fn[0]), "subscribedLiveId の確認が無い");
  assert.ok(/if \(runtimeReadyLiveId !== live\.id\) return false;/.test(fn[0]), "runtimeReadyLiveId の確認が無い");
  assert.ok(
    /if \(live\.current_phase === "answering" && lastAnsweringTickAt === null\) return false;/.test(fn[0]),
    "answering タイマー復元の確認が無い",
  );
  console.log("PASS: 配線-14（isHostRuntimeEstablished の完全readyの条件）");
}

// 15: stopHostProgress：全ゲート begin ＋ recovery.invalidate ＋ subscribedLiveId/
//     runtimeReadyLiveId クリア ＋ retryフラグ ＋ snapshot識別情報リセット。
{
  const fn = src.match(/stopHostProgress: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(fn, "stopHostProgress が見つからない");
  for (const g of ["liveGate.begin()", "childrenGate.begin()", "answersGate.begin()", "resolvedGate.begin()", "scoresGate.begin()"]) {
    assert.ok(fn[0].includes(g), `stopHostProgress が ${g} していない`);
  }
  assert.ok(fn[0].includes("recovery.invalidate()"), "stopHostProgress が recovery.invalidate() していない");
  assert.ok(fn[0].includes("subscribedLiveId = null") && fn[0].includes("runtimeReadyLiveId = null"), "stopHostProgress が subscribedLiveId/runtimeReadyLiveId をクリアしていない");
  assert.ok(fn[0].includes("scoresRetryInFlight = false"), "stopHostProgress が scoresRetryInFlight を戻していない");
  assert.ok(
    fn[0].includes("liveSnapshotConfirmed: false") && fn[0].includes("scoresSnapshot: null"),
    "stopHostProgress が確認状態/識別情報を戻していない",
  );
  console.log("PASS: 配線-15（stopHostProgress: 全ゲート begin ＋ recovery無効化 ＋ 確立/retry/snapshot リセット）");
}

// 16: P1（旧チャンネルの削除完了前に同名を再作成しない）。
//     - DB購読チャンネルは channelSwap（createChannelSwapController）経由で入れ替える
//     - cleanupChannels は channelSwap.invalidate() へ委譲
//     - subscribeLiveChannels は channelSwap.swap() 経由で spawnLiveChannels を呼ぶ
//     - spawn は gen固有 topic（topicFor / buildChannelTopic）を使う＝同名衝突しない
//     - subscribedLiveId は onChannelStatus が全必須 SUBSCRIBED を確認したときだけ設定
{
  assert.ok(
    /function cleanupChannels\(\) \{\s*\n\s*channelSwap\.invalidate\(\);/.test(src),
    "cleanupChannels が channelSwap.invalidate() へ委譲していない",
  );
  assert.ok(
    /function subscribeLiveChannels\(liveId: string\) \{\s*\n\s*const \{ tracker \} = channelSwap\.swap\(liveId, spawnLiveChannels\);/.test(src),
    "subscribeLiveChannels が channelSwap.swap(liveId, spawnLiveChannels) 経由になっていない",
  );
  assert.ok(
    /topicFor: \(kind, liveId, gen\) => buildChannelTopic\("host", kind, gen, liveId\)/.test(src),
    "channelSwap の topicFor が gen固有 topic（buildChannelTopic）を使っていない",
  );
  assert.ok(
    /function spawnLiveChannels\(/.test(src) &&
      count(".channel(topicFor(") === 5,
    "spawnLiveChannels が gen固有 topic（topicFor）で5チャンネルを作っていない",
  );
  // 「作った直後に subscribedLiveId = liveId」を **しない**（.subscribe() は接続完了ではない）。
  assert.ok(
    !/return \[livesCh[\s\S]{0,120}?subscribedLiveId = liveId;/.test(src),
    "spawnLiveChannels が .subscribe() 直後に subscribedLiveId を立てている（接続完了ではない）",
  );
  assert.ok(
    src.includes("const REQUIRED_CHANNELS = [\"lives\", \"participants\", \"turns\", \"answers\", \"scores\"]"),
    "必須チャンネル一覧（REQUIRED_CHANNELS）が無い",
  );
  // onChannelStatus：古い世代は無視、SUBSCRIBED を集約、全 SUBSCRIBED でだけ確立、
  // CHANNEL_ERROR / TIMED_OUT / CLOSED でランタイム無効化。
  const onStatus = src.match(/const onChannelStatus = \(channel: string\) =>[\s\S]*?\n {2}\};/);
  assert.ok(onStatus, "onChannelStatus が見つからない");
  assert.ok(/if \(!isCurrentGen\(\)\) return;/.test(onStatus[0]), "onChannelStatus が古い購読世代を弾いていない");
  assert.ok(
    /if \(useLiveHostStore\.getState\(\)\.live\?\.id !== liveId\) return;/.test(onStatus[0]),
    "onChannelStatus が『この channel の liveId が現在ライブか』を確認していない（P2）",
  );
  assert.ok(
    /if \(tracker\.allSubscribed\(\) && !tracker\.hasFailure\(\)\) \{\s*\n\s*subscribedLiveId = liveId;/.test(onStatus[0]),
    "全必須チャンネル SUBSCRIBED のときだけ subscribedLiveId を確立していない",
  );
  assert.ok(
    /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT" \|\| status === "CLOSED"/.test(onStatus[0]) &&
      /if \(subscribedLiveId === liveId\) subscribedLiveId = null;/.test(onStatus[0]) &&
      /if \(runtimeReadyLiveId === liveId\) runtimeReadyLiveId = null;/.test(onStatus[0]),
    "接続異常（CHANNEL_ERROR/TIMED_OUT/CLOSED）で該当liveIdの runtime を無効化していない",
  );
  console.log("PASS: 配線-16（P1：channelSwap経由・gen固有topic・全SUBSCRIBEDでだけ確立・古い世代/別ライブは無視）");
}

// 16b: P1-1/P2（旧購読の遅延コールバックが現在ライブへ影響しない）。
//   - `stillCurrent: () => true` を廃止
//   - refetchLive / refetchChildren は targetMatches（isCurrentGen ＋ state.live.id === liveId）
//   - loadSnapshotSlice の beginGuard（gate.begin より前の対象確認）で二重防御
{
  assert.ok(!/stillCurrent: \(\) => true(?!\))/.test(src.replace(/\/\/.*$/gm, "")), "`stillCurrent: () => true` が残っている（P1-1）");
  assert.ok(
    /const targetMatches = \(\) =>\s*\n?\s*isCurrentGen\(\) && useLiveHostStore\.getState\(\)\.live\?\.id === liveId;/.test(src),
    "spawnLiveChannels に targetMatches（購読世代 ＋ 現在の live.id）が無い",
  );
  assert.ok(
    /const refetchLive = \(\) => \{\s*\n\s*if \(!targetMatches\(\)\) return;[\s\S]*?beginGuard: targetMatches,[\s\S]*?stillCurrent: \(\) => targetMatches\(\),/.test(src),
    "refetchLive が targetMatches ＋ beginGuard で守られていない",
  );
  assert.ok(
    /const refetchChildren = \(\) => \{\s*\n\s*if \(!targetMatches\(\)\) return;[\s\S]*?beginGuard: targetMatches,[\s\S]*?stillCurrent: \(\) => targetMatches\(\),/.test(src),
    "refetchChildren が targetMatches ＋ beginGuard で守られていない",
  );
  // answers / scores のインラインコールバックも targetMatches で守る。
  assert.ok(count("if (!targetMatches()) return;") >= 5, "Realtime コールバックの targetMatches ガードが不足");
  console.log("PASS: 配線-16b（P1-1/P2：stillCurrent:()=>true 廃止・targetMatches ＋ beginGuard の二重防御）");
}

// 16c: subscribeAndWaitForLive：awaitChannelsSubscribed で SUBSCRIBED を待ち、
//      abort に stop / 進行世代 / 対象liveId / 購読世代の入れ替わり を含める。
{
  const fn = src.match(/async function subscribeAndWaitForLive\([\s\S]*?\n\}/);
  assert.ok(fn, "subscribeAndWaitForLive が無い");
  assert.ok(fn[0].includes("awaitChannelsSubscribed({"), "awaitChannelsSubscribed を使っていない");
  assert.ok(
    /aborted: \(\) => currentChannelGen\(\) !== chGen \|\| abortedFn\(\)/.test(fn[0]),
    "aborted が購読世代の入れ替わり（channelSwap.currentGen）を見ていない",
  );
  assert.ok(
    /if \(outcome !== "timeout"\) return outcome;[\s\S]{0,200}?subscribeLiveChannels\(targetLiveId\);/.test(fn[0]),
    "タイムアウト時に一度だけ張り直す経路が無い（無限待ち防止）",
  );
  assert.ok(count("if (abortedFn()) return \"aborted\";") >= 2, "張り直し前の中断確認が無い（stop直後にchannelを増やさない）");
  assert.ok(src.includes("const CHANNEL_SUBSCRIBE_TIMEOUT_MS = 10_000"), "接続待ちタイムアウト定数が無い");
  console.log("PASS: 配線-16c（subscribeAndWaitForLive: SUBSCRIBED待ち ＋ 中断条件 ＋ タイムアウト再張り）");
}

// 16d: ensureTickTimer は既に1本あれば張り直さない。
{
  assert.ok(/function ensureTickTimer\(generation: number\) \{[\s\S]*?if \(tickTimer\) return;/.test(src), "ensureTickTimer が『既に1本あればそのまま』になっていない");
  console.log("PASS: 配線-16d（ensureTickTimer はタイマーを重複作成しない）");
}

// 16e: ホスト側は "follower-tsukkomi" の生 Broadcast チャンネルを一切作らず、
//      ボット反応はホスト専用 RPC host_send_bot_tsukkomi 経由で送る。
{
  assert.ok(!/ensureTsukkomiChannel/.test(src), "ensureTsukkomiChannel が残っている（廃止するはず）");
  assert.ok(!/"follower-tsukkomi"/.test(src), "ホスト側に固定topic名 \"follower-tsukkomi\" が残っている");
  assert.ok(
    !/type: "broadcast",\s*\n\s*event: "tsukkomi"/.test(src),
    "ホスト側に生の Realtime Broadcast 送信（event:\"tsukkomi\"）が残っている",
  );
  // ボット反応は host_send_bot_tsukkomi RPC。発生確率・間隔・テンプレート・
  // clap/stamp割合は不変（0.05 / 1_500 / TSUKKOMI_TEMPLATES / roll<1/3・<2/3）。
  const botBlock = src.match(
    /if \(bots\.length > 0 && now - lastBotTsukkomiAt > 1_500 && Math\.random\(\) < 0\.05\) \{[\s\S]*?\n {2}\}/,
  );
  assert.ok(botBlock, "ボット反応ブロックが見つからない（頻度ロジックが変わっている）");
  assert.ok(
    /roll < 1 \/ 3[\s\S]*?TSUKKOMI_TEMPLATES\[Math\.floor\(Math\.random\(\) \* TSUKKOMI_TEMPLATES\.length\)\][\s\S]*?roll < 2 \/ 3[\s\S]*?"爆笑"[\s\S]*?"clap", "👏"/.test(
      botBlock[0],
    ),
    "clap/stamp の割合・テンプレートが変わっている",
  );
  assert.ok(
    /supabase\s*\n?\s*\.rpc\("host_send_bot_tsukkomi", \{\s*\n\s*p_live_id: live\.id,\s*\n\s*p_participant_id: senderBot\.participantId,\s*\n\s*p_kind: kind,\s*\n\s*p_text: text,/.test(
      botBlock[0],
    ),
    "ボット反応が host_send_bot_tsukkomi RPC 経由で送られていない",
  );
  assert.ok(
    /if \(error\) console\.warn\("\[tsukkomi\] ボット反応の送信に失敗", error\)/.test(botBlock[0]),
    "RPC失敗時に進行を止めずコンソール警告に留めていない",
  );
  console.log("PASS: 配線-16e（ホスト：Broadcast廃止・ボット反応は host_send_bot_tsukkomi RPC・頻度不変）");
}

// 16g: 観客側（useLiveFollowerStore）の購読も channelSwap 化。
{
  const follower = readFileSync(
    join(process.cwd(), "src", "store", "useLiveFollowerStore.ts"),
    "utf8",
  );
  const fcount = (n: string) => follower.split(n).length - 1;
  assert.ok(
    /const followerChannelSwap = createChannelSwapController</.test(follower),
    "観客側が createChannelSwapController を使っていない",
  );
  assert.ok(
    /topicFor: \(kind, _liveId, gen\) => buildChannelTopic\("follower", kind, gen\)/.test(follower),
    "観客側の topic が世代固有（follower-<kind>-g<gen>）になっていない",
  );
  assert.ok(
    !/\.channel\("follower-/.test(follower),
    "観客側に固定topic名 \"follower-…\" のチャンネルが残っている（固定topic名依存）",
  );
  assert.ok(!/let channels\b/.test(follower) && !/let tsukkomiChannel\b/.test(follower), "観客側の旧チャンネル配列/固定tsukkomiChannel が残っている");
  assert.ok(!/function cleanupChannels\b/.test(follower), "観客側の非所有権 cleanupChannels が残っている");
  assert.ok(
    /const channelSwapResult = followerChannelSwap\.swap\(""/.test(follower),
    "観客側が followerChannelSwap.swap(...) を使っていない",
  );
  assert.ok(
    /channelSwapResult\.dispose\(\);/.test(follower),
    "観客側の cleanup が所有権付き dispose() を使っていない",
  );
  // 各コールバックの世代ガード（isCurrentGen）。
  assert.ok(
    fcount("if (!isCurrentGen()) return;") >= 3 && /const isCurrentGen = swapArgs\.isCurrentGen;/.test(follower),
    "観客側コールバックの古い世代ガード（isCurrentGen）が不足",
  );
  // live_tsukkomi_events の Postgres Changes 購読は維持（固定topic名は使わない）。
  assert.ok(
    /table: "live_tsukkomi_events"/.test(follower) && /swapArgs\.topicFor\("tsukkomi"\)/.test(follower),
    "観客側が live_tsukkomi_events を世代固有 topic で購読していない",
  );
  console.log("PASS: 配線-16g（観客側：channelSwap化・固定topic名廃止・所有権付きcleanup・世代ガード）");
}

// 16f: loadSnapshotSlice の beginGuard は gate.begin より前（対象不一致で gate を進めない）。
{
  assert.ok(
    /export async function loadSnapshotSlice<TResult>\([\s\S]*?if \(deps\.beginGuard && !deps\.beginGuard\(\)\) return "target-changed";\s*\n\s*const token = deps\.gate\.begin\(\);/.test(
      readFileSync(join(process.cwd(), "src", "lib", "liveHostSnapshots.ts"), "utf8"),
    ),
    "loadSnapshotSlice の beginGuard が gate.begin() より前で確認していない",
  );
  console.log("PASS: 配線-16f（beginGuard は gate.begin より前＝対象不一致で gate を進めない）");
}

// 17: init/hydrate のstop検出ブランチが cleanupChannels() を呼ばない。
{
  assert.ok(
    /progressGenerationが変わるのはstopHostProgress\(\)のときだけ/.test(src),
    "stop検出ブランチに cleanup しない理由コメントが無い",
  );
  const initFn = src.match(/init: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(initFn);
  assert.ok(
    !/if \(stopped\(\)[\s\S]{0,120}?\) \{[\s\S]{0,300}?cleanupChannels\(\);/.test(initFn[0]),
    "init のstop検出ブランチが cleanupChannels() を呼んでいる",
  );
  console.log("PASS: 配線-17（stop検出は新世代 channel を cleanup しない）");
}

// 18: 組結果15秒（制約）。
{
  const timing = readFileSync(join(process.cwd(), "src", "data", "liveRoomTiming.ts"), "utf8");
  const prod = timing.match(/const PRODUCTION_TIMING = \{[\s\S]*?\n\} as const;/);
  assert.ok(prod, "PRODUCTION_TIMING が見つからない");
  assert.ok(/groupResultMs:\s*15_000\b/.test(prod[0]), "PRODUCTION_TIMING.groupResultMs が 15_000 でない");
  console.log("PASS: 配線-18（組結果の本番値は15秒のまま）");
}

// 19: 採点3点制・回答席/フリップ/音声演出の主要ロジックが不変（制約）。
{
  assert.ok(/points: isPerfectRound \? 3 : randomBotScore\(\)/.test(src), "ボット採点の3点制ロジックが変わっている");
  assert.ok(/const topScoreVotes = freshScores\.filter\(\(s\) => s\.points === 3\)\.length;/.test(src), "満点(3点)判定ロジックが変わっている");
  assert.ok(/REVEAL_SEQUENCE_MS/.test(src) && /reveal_sequence_until/.test(src), "フリップ/演出シーケンス配線が変わっている");
  console.log("PASS: 配線-19（採点3点制・演出シーケンスのロジックは不変）");
}

console.log("ALL LIVE_HOST_SNAPSHOTS WIRING CHECKS PASSED");
