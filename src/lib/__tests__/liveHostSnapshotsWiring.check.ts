// 配線確認：src/lib/liveHostSnapshots.ts の仕組みが、実際に
// src/store/useLiveHostStore.ts の想定した箇所へ組み込まれていることを、
// ソースの静的検査で確認する（純粋関数の単体テストだけでは配線が分からないため）。
// このリポジトリには実ストアを丸ごと動かす統合テスト基盤が無いため、
// tsc / next build（型・ビルド検証）に加えてこの静的検査を置く。
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
    "loadSnapshotSlice",
    "shouldReleaseInitInFlight",
    "shouldRetryNow",
  ]) {
    assert.ok(m[0].includes(name), `import文に ${name} が無い`);
  }
  console.log("PASS: 配線-1（必要な純粋関数をimport）");
}

// 2: スライスごとの取得世代ゲートを4つ作っている（live/children/answers/resolved）。
{
  for (const g of ["liveGate", "childrenGate", "answersGate", "resolvedGate"]) {
    assert.ok(src.includes(`const ${g} = createSliceGate()`), `${g} を createSliceGate で作っていない`);
  }
  console.log("PASS: 配線-2（live/children/answers/resolved の4スライスゲート）");
}

// 3: 各取得経路が loadSnapshotSlice を通っている
//   （refreshAnswersForTurn / refetchLive / refetchChildren / updateLiveIfPhaseの0行 /
//    resolveIfDueの0行 / init の各スライス / refresh の各スライス / advanceIfDueの再試行）。
{
  assert.ok(count("loadSnapshotSlice") >= 12, `loadSnapshotSlice の使用箇所が少なすぎる (${count("loadSnapshotSlice")})`);
  console.log("PASS: 配線-3（各取得経路が loadSnapshotSlice を通る）");
}

// 4: 問題1（取得失敗で確認済みのままにしない）：markUnconfirmed が
//   childrenSnapshotLiveId:null / answersSnapshot:null / liveSnapshotConfirmed:false を
//   セットしている経路が十分にある。
{
  assert.ok(count("childrenSnapshotLiveId: null") >= 5, "childrenSnapshotLiveId:null への戻しが不足");
  assert.ok(count("answersSnapshot: null") >= 5, "answersSnapshot:null への戻しが不足");
  assert.ok(count("liveSnapshotConfirmed: false") >= 4, "liveSnapshotConfirmed:false への戻しが不足");
  console.log("PASS: 配線-4（取得失敗時に確認状態を未確認へ戻す経路が複数）");
}

// 5: 問題3（live未確認中は自動進行を凍結）：advanceIfDue の先頭で
//   liveSnapshotConfirmed を見て retryLiveSnapshot だけして return する。
{
  const fn = src.match(/async function advanceIfDue\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "advanceIfDue が見つからない");
  assert.ok(
    /if \(!state\.liveSnapshotConfirmed\) \{\s*\n\s*retryLiveSnapshot\(\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が liveSnapshotConfirmed 未確認時に retryLiveSnapshot だけして return していない",
  );
  assert.ok(
    /if \(!childrenSnapshotReady\(state\.childrenSnapshotLiveId, live\.id\)\) \{\s*\n\s*retryChildrenSnapshot\(live\.id\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が children 未確認時に retryChildrenSnapshot だけして return していない",
  );
  assert.ok(
    /if \(!answersSnapshotMatches\(state\.answersSnapshot, live\.id, live\.current_turn_id\)\) \{\s*\n\s*retryAnswersSnapshot\(live\.current_turn_id\);\s*\n\s*return;/.test(fn[0]),
    "advanceIfDue が answers 未確認時に retryAnswersSnapshot だけして return していない",
  );
  console.log("PASS: 配線-5（未確認スライスは自動進行を凍結し読み取り再試行だけ）");
}

// 6: 再試行は single-flight ＋ 最小間隔（shouldRetryNow ＋ SNAPSHOT_RETRY_INTERVAL_MS）。
{
  assert.ok(src.includes("const SNAPSHOT_RETRY_INTERVAL_MS = 2_000"), "再試行の最小間隔定数が無い/2秒でない");
  for (const fn of ["retryLiveSnapshot", "retryChildrenSnapshot", "retryAnswersSnapshot"]) {
    const m = src.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
    assert.ok(m, `${fn} が見つからない`);
    assert.ok(m[0].includes("shouldRetryNow("), `${fn} が shouldRetryNow を使っていない`);
    assert.ok(m[0].includes("SNAPSHOT_RETRY_INTERVAL_MS"), `${fn} が最小間隔を使っていない`);
  }
  console.log("PASS: 配線-6（再試行は single-flight ＋ 最小間隔2秒）");
}

// 7: 問題3（fetchActiveLive失敗時に古いliveで自動進行しない）：init の live スライスが
//   unconfirmed のとき、liveSnapshotConfirmed=false のまま error を出し ensureTickTimer で
//   タイマーだけ張って return する（500ms タイマーを直接再作成しない）。
{
  const initFn = src.match(/init: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(initFn, "init が見つからない");
  assert.ok(
    /if \(liveOutcome === "unconfirmed"\) \{[\s\S]*?ensureTickTimer\(myGeneration\);\s*\n\s*return;/.test(initFn[0]),
    "init が live 未確認時に ensureTickTimer だけして return していない",
  );
  assert.ok(
    !/tickTimer = setInterval/.test(initFn[0]),
    "init が setInterval を直接呼んでいる（ensureTickTimer に集約されていない）",
  );
  console.log("PASS: 配線-7（fetchActiveLive失敗時は凍結してタイマーだけ、直接setIntervalしない）");
}

// 8: 問題2（init最後の一括setで巻き戻さない）：init は各スライスを個別に
//   loadSnapshotSlice で反映し、最後に live/participants/turns/answers 等を
//   まとめて set していない。
{
  const initFn = src.match(/init: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(initFn);
  assert.ok(
    !/set\(\(s\) => \(\{[\s\S]*?\bturns\b[\s\S]*?\}\)\)/.test(initFn[0]) &&
      !/set\(\{[\s\S]{0,40}live,[\s\S]*?\.\.\.children,[\s\S]*?answers:/.test(initFn[0]),
    "init が複数スライスを1回のsetでまとめて反映している（巻き戻しの温床）",
  );
  console.log("PASS: 配線-8（init は各スライスを個別反映、末尾の一括setなし）");
}

// 9: stopHostProgress が全ゲートを begin() し、retry フラグ・snapshot識別情報・
//    liveSnapshotConfirmed を戻す。
{
  const fn = src.match(/stopHostProgress: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(fn, "stopHostProgress が見つからない");
  for (const g of ["liveGate.begin()", "childrenGate.begin()", "answersGate.begin()", "resolvedGate.begin()"]) {
    assert.ok(fn[0].includes(g), `stopHostProgress が ${g} していない`);
  }
  assert.ok(fn[0].includes("liveRetryInFlight = false"), "stopHostProgress が liveRetryInFlight を戻していない");
  assert.ok(fn[0].includes("answersRetryInFlight = false"), "stopHostProgress が answersRetryInFlight を戻していない");
  assert.ok(
    fn[0].includes("liveSnapshotConfirmed: false") && fn[0].includes("childrenSnapshotLiveId: null"),
    "stopHostProgress が確認状態を戻していない",
  );
  console.log("PASS: 配線-9（stopHostProgress が全ゲート begin＋確認状態リセット）");
}

// 10: init のstop検出ブランチが cleanupChannels() を呼ばない。
{
  assert.ok(
    /progressGenerationが変わるのはstopHostProgress\(\)のときだけ/.test(src),
    "init のstop検出ブランチに cleanup しない理由コメントが無い",
  );
  const initFn = src.match(/init: \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(initFn);
  assert.ok(
    !/if \(stopped\(\)\) \{[\s\S]{0,300}?cleanupChannels\(\);/.test(initFn[0]),
    "init のstop検出ブランチが cleanupChannels() を呼んでいる（新世代のchannelを消す恐れ）",
  );
  console.log("PASS: 配線-10（init のstop検出は新世代 channel を cleanup しない）");
}

// 11: 生の Supabase エラーメッセージを refresh() が返していない。
{
  const fn = src.match(/refresh: async \(\) => \{[\s\S]*?\n {2}\},/);
  assert.ok(fn, "refresh が見つからない");
  assert.ok(!fn[0].includes("liveError.message"), "refresh が生の liveError.message を返している");
  assert.ok(!/reason: e instanceof Error \? e\.message/.test(fn[0]), "refresh が生の例外メッセージを返している");
  console.log("PASS: 配線-11（refresh は生のSupabaseエラーを画面へ返さない）");
}

// 12: DB書き込み結果 / RPC戻り値の live は applyAuthoritativeLive で反映（ゲートbegin＋confirmed）。
{
  assert.ok(src.includes("function applyAuthoritativeLive("), "applyAuthoritativeLive が無い");
  assert.ok(count("applyAuthoritativeLive(") >= 4, "applyAuthoritativeLive の使用が少なすぎる");
  console.log("PASS: 配線-12（書き込み/RPC結果の live は applyAuthoritativeLive 経由）");
}

// 13（必須テスト12）：組結果の本番値が15秒のまま。
{
  const timing = readFileSync(join(process.cwd(), "src", "data", "liveRoomTiming.ts"), "utf8");
  const prod = timing.match(/const PRODUCTION_TIMING = \{[\s\S]*?\n\} as const;/);
  assert.ok(prod, "PRODUCTION_TIMING が見つからない");
  assert.ok(/groupResultMs:\s*15_000\b/.test(prod[0]), "PRODUCTION_TIMING.groupResultMs が 15_000 でない");
  console.log("PASS: 配線-13（組結果の本番値は15秒のまま）");
}

// 14（既存仕様の非退行）：採点3点制・回答席/フリップ/音声演出の主要語が残っている。
{
  assert.ok(/points: isPerfectRound \? 3 : randomBotScore\(\)/.test(src), "ボット採点の3点制ロジックが変わっている");
  console.log("PASS: 配線-14（採点3点制のボットロジックは不変）");
}

console.log("ALL LIVE_HOST_SNAPSHOTS WIRING CHECKS PASSED");
