// 配線確認：src/lib/liveHostSnapshots.ts の仕組みが、実際に
// src/store/useLiveHostStore.ts の想定した箇所へ組み込まれていることを、
// ソースの静的検査で確認する（純粋関数の単体テストだけでは配線が分からないため）。
// このリポジトリには実ストアを丸ごと動かす統合テスト基盤が無いため、
// tsc / next build（型・ビルド検証）＋ liveHostSnapshots.check.ts（遅延Promiseで
// 非同期順序・復旧オーケストレーションを検証）に加えて、この静的検査を置く。
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
    "childrenSnapshotReady",
    "createSliceGate",
    "hydrateAfterLive",
    "loadSnapshotSlice",
    "scoresSnapshotMatches",
    "shouldReleaseInitInFlight",
    "shouldReleaseRetryFlag",
    "shouldRetryNow",
  ]) {
    assert.ok(m[0].includes(name), `import文に ${name} が無い`);
  }
  console.log("PASS: 配線-1（必要な純粋関数をimport）");
}

// 2: スライスごとの取得世代ゲートを5つ作っている（live/children/answers/resolved/scores）。
{
  for (const g of ["liveGate", "childrenGate", "answersGate", "resolvedGate", "scoresGate"]) {
    assert.ok(src.includes(`const ${g} = createSliceGate()`), `${g} を createSliceGate で作っていない`);
  }
  console.log("PASS: 配線-2（live/children/answers/resolved/scores の5スライスゲート）");
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
  // refetchLive / refetchChildren（Realtime起点）、refreshAnswersForTurn、
  // refreshScoresForActiveAnswer、refresh() の live/children/answers、hydrate の各スライス。
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

// 6: 未確認スライスは advanceIfDue で自動進行を凍結し、読み取り再試行だけ行う。
{
  const fn = src.match(/async function advanceIfDue\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "advanceIfDue が見つからない");
  assert.ok(
    /if \(!state\.liveSnapshotConfirmed\) \{\s*\n\s*retryLiveSnapshot\(\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が live 未確認時に retryLiveSnapshot だけして return していない",
  );
  assert.ok(
    /if \(!childrenSnapshotReady\(state\.childrenSnapshotLiveId, live\.id\)\) \{\s*\n\s*retryChildrenSnapshot\(live\.id\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が children 未確認時に retryChildrenSnapshot だけして return していない",
  );
  assert.ok(
    /if \(!answersSnapshotMatches\(state\.answersSnapshot, live\.id, live\.current_turn_id\)\) \{\s*\n\s*retryAnswersSnapshot\(live\.current_turn_id\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が answers 未確認時に retryAnswersSnapshot だけして return していない",
  );
  console.log("PASS: 配線-6（未確認スライスは自動進行を凍結し読み取り再試行だけ）");
}

// 7: P2-1（awaitをまたいだ後の再確認）：autoProgressFrozen が定義され、
//    advanceIfDue の await ブロック後・各遷移RPC/更新の直前で使われている。
{
  assert.ok(
    /function autoProgressFrozen\(tickGeneration: number, requireAnswers: boolean\): boolean/.test(src),
    "autoProgressFrozen が定義されていない",
  );
  assert.ok(/const tickGeneration = progressGeneration;/.test(src), "advanceIfDue先頭で tickGeneration を捕捉していない");
  assert.ok(count("autoProgressFrozen(tickGeneration") >= 5, "autoProgressFrozen による再確認が不足");
  const fn = src.match(/async function advanceIfDue\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.ok(
    /await syncAnsweringPause\(\);\s*\n[\s\S]{0,400}?if \(autoProgressFrozen\(tickGeneration, true\)\) return;/.test(fn[0]),
    "answering分岐の await ブロック後に autoProgressFrozen 再確認が無い",
  );
  console.log("PASS: 配線-7（awaitをまたいだ後に確認状態とprogressGenerationを再確認）");
}

// 8: 再試行は single-flight ＋ 最小間隔 ＋ 所有権付き finally（shouldReleaseRetryFlag）。
{
  assert.ok(src.includes("const SNAPSHOT_RETRY_INTERVAL_MS = 2_000"), "再試行の最小間隔定数が無い/2秒でない");
  for (const fn of ["retryLiveSnapshot", "retryChildrenSnapshot", "retryAnswersSnapshot", "retryScoresSnapshot"]) {
    const m = src.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
    assert.ok(m, `${fn} が見つからない`);
    assert.ok(m[0].includes("shouldRetryNow("), `${fn} が shouldRetryNow を使っていない`);
    assert.ok(m[0].includes("SNAPSHOT_RETRY_INTERVAL_MS"), `${fn} が最小間隔を使っていない`);
    assert.ok(
      /shouldReleaseRetryFlag\(progressGeneration, myGeneration\)/.test(m[0]),
      `${fn} の finally が所有権判定なしでフラグを解除している`,
    );
    assert.ok(
      !/\.finally\(\(\) => \{\s*\n\s*\w+RetryInFlight = false;\s*\n\s*\}\)/.test(m[0]),
      `${fn} が無条件に XRetryInFlight = false へ戻している`,
    );
  }
  console.log("PASS: 配線-8（再試行は single-flight ＋ 最小間隔2秒 ＋ 所有権付き解除）");
}

// 9: P1-1（完全復旧）：hydrateHostForActiveLive が定義され、init と retryLiveSnapshot の
//    両方から呼ばれている。retryLiveSnapshot は init 実行中は走らない。
{
  assert.ok(
    /async function hydrateHostForActiveLive\(generation: number\): Promise<HydrateOutcome>/.test(src),
    "hydrateHostForActiveLive が定義されていない",
  );
  assert.ok(src.includes("hydrateAfterLive({"), "hydrateHostForActiveLive が hydrateAfterLive を使っていない");
  assert.ok(count("hydrateHostForActiveLive(") >= 2, "hydrateHostForActiveLive が init/retry の両方から呼ばれていない");
  const retryFn = src.match(/function retryLiveSnapshot\(\)[\s\S]*?\n\}/);
  assert.ok(retryFn);
  assert.ok(retryFn[0].includes("if (initInFlight) return;"), "retryLiveSnapshot が init 実行中ガードを持たない");
  assert.ok(
    retryFn[0].includes("hydrateHostForActiveLive(myGeneration)"),
    "retryLiveSnapshot が liveの再取得だけで済ませている（完全復旧を呼んでいない）",
  );
  const initFn = src.match(/init: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(initFn);
  assert.ok(
    /const outcome = await hydrateHostForActiveLive\(myGeneration\);/.test(initFn[0]),
    "init が hydrateHostForActiveLive を使っていない（旧インラインのまま）",
  );
  assert.ok(
    /if \(outcome === "live-unconfirmed"\) \{[\s\S]*?ensureTickTimer\(myGeneration\);\s*\n\s*return;/.test(initFn[0]),
    "init が live 未確認時に ensureTickTimer だけして return していない",
  );
  assert.ok(!/tickTimer = setInterval/.test(initFn[0]), "init が setInterval を直接呼んでいる");
  console.log("PASS: 配線-9（初回init失敗→retryで完全復旧、initと共通処理へ集約）");
}

// 10: init は各スライスを個別反映（hydrate経由）で、末尾の複数スライス一括setが無い。
{
  const initFn = src.match(/init: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(initFn);
  assert.ok(
    !/set\(\(s\) => \(\{[\s\S]*?\bturns\b[\s\S]*?\}\)\)/.test(initFn[0]) &&
      !/set\(\{[\s\S]{0,40}live,[\s\S]*?\.\.\.children,[\s\S]*?answers:/.test(initFn[0]),
    "init が複数スライスを1回のsetでまとめて反映している（巻き戻しの温床）",
  );
  console.log("PASS: 配線-10（init は各スライスを個別反映、末尾の一括setなし）");
}

// 11: stopHostProgress が全ゲート(5つ)を begin() し、retryフラグ・snapshot識別情報・
//     liveSnapshotConfirmed を戻す。
{
  const fn = src.match(/stopHostProgress: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(fn, "stopHostProgress が見つからない");
  for (const g of [
    "liveGate.begin()",
    "childrenGate.begin()",
    "answersGate.begin()",
    "resolvedGate.begin()",
    "scoresGate.begin()",
  ]) {
    assert.ok(fn[0].includes(g), `stopHostProgress が ${g} していない`);
  }
  assert.ok(fn[0].includes("liveRetryInFlight = false"), "stopHostProgress が liveRetryInFlight を戻していない");
  assert.ok(fn[0].includes("scoresRetryInFlight = false"), "stopHostProgress が scoresRetryInFlight を戻していない");
  assert.ok(
    fn[0].includes("liveSnapshotConfirmed: false") &&
      fn[0].includes("childrenSnapshotLiveId: null") &&
      fn[0].includes("scoresSnapshot: null"),
    "stopHostProgress が確認状態/識別情報を戻していない",
  );
  console.log("PASS: 配線-11（stopHostProgress が全ゲート begin＋retryフラグ・確認状態リセット）");
}

// 12: init/hydrate のstop検出ブランチが cleanupChannels() を呼ばない。
{
  assert.ok(
    /progressGenerationが変わるのはstopHostProgress\(\)のときだけ/.test(src),
    "stop検出ブランチに cleanup しない理由コメントが無い",
  );
  const initFn = src.match(/init: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(initFn);
  assert.ok(
    !/if \(stopped\(\)[\s\S]{0,200}?\) \{[\s\S]{0,300}?cleanupChannels\(\);/.test(initFn[0]),
    "init のstop検出ブランチが cleanupChannels() を呼んでいる",
  );
  console.log("PASS: 配線-12（init/hydrate のstop検出は新世代 channel を cleanup しない）");
}

// 13: 生の Supabase エラーメッセージを refresh() が返していない。
{
  const fn = src.match(/refresh: async \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(fn, "refresh が見つからない");
  assert.ok(!fn[0].includes("liveError.message"), "refresh が生の liveError.message を返している");
  assert.ok(!/reason: e instanceof Error \? e\.message/.test(fn[0]), "refresh が生の例外メッセージを返している");
  console.log("PASS: 配線-13（refresh は生のSupabaseエラーを画面へ返さない）");
}

// 14: P1-2（scores新旧逆転防止）：scoresの全書き込み経路が scoresGate/refreshScoresForActiveAnswer を通る。
{
  assert.ok(
    /async function refreshScoresForActiveAnswer\(\): Promise<SliceLoadOutcome>/.test(src),
    "refreshScoresForActiveAnswer が定義されていない",
  );
  // scoresCh（Realtime）ハンドラが refreshScoresForActiveAnswer を使う。
  assert.ok(
    /table: "scores" \}, \(\) => \{\s*\n\s*void refreshScoresForActiveAnswer\(\);/.test(src),
    "scores の Realtime ハンドラが refreshScoresForActiveAnswer を使っていない",
  );
  // resyncAnswersAndScoresForCurrentLive も同様。
  assert.ok(
    /async function resyncAnswersAndScoresForCurrentLive\(\)[\s\S]*?await refreshScoresForActiveAnswer\(\);/.test(src),
    "resyncAnswersAndScoresForCurrentLive が refreshScoresForActiveAnswer を使っていない",
  );
  // resolveIfDue：確定直前の再取得を scoresGate トークンで囲み、追い越されたら進めない。
  assert.ok(
    /const scoresToken = scoresGate\.begin\(\);\s*\n\s*const freshScoresResult = await fetchScoresForAnswer\(active\.id\);/.test(src),
    "resolveIfDue の確定直前 scores 再取得が scoresGate トークンで囲まれていない",
  );
  assert.ok(
    /if \(!scoresGate\.isCurrent\(scoresToken\)\) \{\s*\n\s*\/\/[\s\S]*?return;\s*\n\s*\}/.test(src),
    "resolveIfDue が「追い越されたら進めない」チェックをしていない",
  );
  // resolveIfDue：確定前ガードで scoresSnapshotMatches を使う。
  assert.ok(
    /if \(\s*\n?\s*!scoresSnapshotMatches\(\s*\n?\s*state\.scoresSnapshot,/.test(src),
    "resolveIfDue が scoresSnapshotMatches によるガードをしていない",
  );
  // answers が変わる経路で scoresGate.begin() ＋ scoresSnapshot: null。
  assert.ok(count("scoresGate.begin()") >= 8, `scoresGate.begin() の配線が少なすぎる (${count("scoresGate.begin()")})`);
  console.log("PASS: 配線-14（scoresの全書き込み経路が scoresGate/refreshScoresForActiveAnswer を通る）");
}

// 15: 組結果の本番値が15秒のまま（制約）。
{
  const timing = readFileSync(join(process.cwd(), "src", "data", "liveRoomTiming.ts"), "utf8");
  const prod = timing.match(/const PRODUCTION_TIMING = \{[\s\S]*?\n\} as const;/);
  assert.ok(prod, "PRODUCTION_TIMING が見つからない");
  assert.ok(/groupResultMs:\s*15_000\b/.test(prod[0]), "PRODUCTION_TIMING.groupResultMs が 15_000 でない");
  console.log("PASS: 配線-15（組結果の本番値は15秒のまま）");
}

// 16: 採点3点制・回答席/フリップ/音声演出の主要ロジックが不変（制約）。
{
  assert.ok(/points: isPerfectRound \? 3 : randomBotScore\(\)/.test(src), "ボット採点の3点制ロジックが変わっている");
  assert.ok(/const topScoreVotes = freshScores\.filter\(\(s\) => s\.points === 3\)\.length;/.test(src), "満点(3点)判定ロジックが変わっている");
  assert.ok(/REVEAL_SEQUENCE_MS/.test(src) && /reveal_sequence_until/.test(src), "フリップ/演出シーケンス配線が変わっている");
  console.log("PASS: 配線-16（採点3点制・演出シーケンスのロジックは不変）");
}

console.log("ALL LIVE_HOST_SNAPSHOTS WIRING CHECKS PASSED");
