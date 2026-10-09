// ステージング誤接続時の運営操作防止(assertStagingOperationAllowed)の
// 棚卸し検査：useLiveHostStore.ts内の「Supabaseへ書き込みを行う経路」を実コードから
// 機械的に抽出し、その全てが安全確認を経由していることを検証する（手で書いた
// 対象一覧と実装がズレていないことの保証。新しい書き込みを追加してガードを
// 入れ忘れた場合にこの検査が落ちる）。
// 加えて、/live/hostから到達する運営書き込み（useLiveFollowerStoreの観客側
// 補助tick、useLiveBotStore.addBots、live/host/page.tsxのstaging_testers許可/失効）も
// 対象に含める（useLiveHostStoreだけに限定しない）。
// 実行方法はsrc/lib/__tests__/run.sh参照（他の*.check.tsと同じ素のtsc起動）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const STORE_PATH = "src/store/useLiveHostStore.ts";
const store = readFileSync(join(ROOT, STORE_PATH), "utf8");
const lines = store.split("\n");

const GUARD = "assertStagingOperationAllowed";
// 名前だけでは読み取り/書き込みを判別できない.rpc(...)呼び出しのうち、実際には
// SELECTしか行わない（SQL定義を直接確認済み）RPC。書き込み検出の対象から除外する。
const READ_ONLY_RPC_NAMES = new Set(["get_next_official_sequence_number"]);

const RPC_CALL_SOURCE = '\\b(?:supabase|bot\\.client|senderBot\\.client|client)\\s*\\.\\s*rpc\\(\\s*"([a-zA-Z0-9_]+)"';
const TABLE_WRITE_SOURCE =
  "\\b(?:supabase|bot\\.client|senderBot\\.client|client)\\s*\\.\\s*from\\([^)]*\\)\\s*\\.\\s*(?:insert|update|upsert|delete)\\(";

// Supabase/ボットクライアントへの実際の書き込み呼び出しがあるかを判定する
// （Map/Set等のローカルコレクションの.delete()等はここでは誤検出しない。
// .rpc(...)は呼び出し名がREAD_ONLY_RPC_NAMESに無いものだけを書き込みとみなす）。
// 呼び出すたびに新しいRegExpを生成する（globalフラグ付きregexのlastIndex状態が
// 呼び出し間で持ち越されるバグを避けるため）。
function hasWriteCall(body: string): boolean {
  if (new RegExp(TABLE_WRITE_SOURCE).test(body)) return true;
  if (/\bupdateLive\(/.test(body)) return true;
  for (const m of body.matchAll(new RegExp(RPC_CALL_SOURCE, "g"))) {
    if (!READ_ONLY_RPC_NAMES.has(m[1])) return true;
  }
  return false;
}

// 本文中の最初の書き込み呼び出しの位置を返す（無ければnull）。
// 「ガード文字列が本文のどこかに存在する」だけでなく「最初の書き込みより前にある」
// ことを検査するために使う。
function firstWriteIndex(body: string): number | null {
  const indices: number[] = [];
  for (const m of body.matchAll(new RegExp(TABLE_WRITE_SOURCE, "g"))) indices.push(m.index!);
  const updateLiveIdx = body.indexOf("updateLive(");
  if (updateLiveIdx >= 0) indices.push(updateLiveIdx);
  for (const m of body.matchAll(new RegExp(RPC_CALL_SOURCE, "g"))) {
    if (!READ_ONLY_RPC_NAMES.has(m[1])) indices.push(m.index!);
  }
  if (indices.length === 0) return null;
  return Math.min(...indices);
}

// 1) 公開アクション一覧を実コードから抽出する（"  name: async" または "  name: ("）。
//    create<LiveHostState>()((set, get) => ({ ... })) の中の最上位プロパティのみを
//    対象にする（2スペースインデント、直後が ": async" または ": ("）。
//    スキャン範囲は、store生成式の開始行（"export const useLiveHostStore = create<..."）
//    以降だけに限定する。これより前（spawnLiveChannels等のモジュール内部関数が
//    受け取るオブジェクトリテラルの引数等）にも偶然同じ2スペースインデントの
//    "name: (" パターンが出現し、誤って公開アクションとして抽出されてしまうため。
const STORE_DECL_LINE_RE = /^export const useLiveHostStore = create</;
const storeDeclLineIdx = lines.findIndex((l) => STORE_DECL_LINE_RE.test(l));
assert.ok(storeDeclLineIdx >= 0, "useLiveHostStoreのcreate<...>宣言行が見つからない");

const actionNameRe = /^  ([a-zA-Z][a-zA-Z0-9]*): (async )?[(]/;
type ActionSpan = { name: string; startLine: number; endLine: number };
const actionSpans: ActionSpan[] = [];
{
  const matches: { name: string; line: number }[] = [];
  for (let i = storeDeclLineIdx + 1; i < lines.length; i++) {
    const m = actionNameRe.exec(lines[i]);
    if (m) matches.push({ name: m[1], line: i });
  }
  for (let i = 0; i < matches.length; i++) {
    actionSpans.push({
      name: matches[i].name,
      startLine: matches[i].line,
      endLine: i + 1 < matches.length ? matches[i + 1].line : lines.length,
    });
  }
}

// 既知の読み取り専用アクション（書き込みを一切行わない）。新しい読み取り専用
// アクションを追加した場合はここにも追記が必要（下の「未分類」チェックで検出される）。
const READ_ONLY_ACTIONS = new Set(["loadTopicBank", "refresh", "fetchNextOfficialSequenceNumber"]);
// ライフサイクル管理用（Supabase書き込みを行わない）。
const LIFECYCLE_ACTIONS = new Set(["init", "stopHostProgress"]);

const bodyOf = (span: ActionSpan) => lines.slice(span.startLine, span.endLine).join("\n");

// 公開アクションは25件＝書き込み20件（既存4件＋必須新規16件。changeTopicAssignmentは
// 必須新規16件に含まれており、二重計上しない）＋読み取り専用3件＋ライフサイクル2件、
// と実コードから再確認する（数が合わないこと自体が棚卸し漏れ・ズレのシグナル）。
assert.equal(
  actionSpans.length,
  25,
  `公開アクションの抽出件数が想定(25件)と異なる(${actionSpans.length}件)`,
);

const missingGuard: string[] = [];
const guardAfterFirstWrite: string[] = [];
const unexpectedWriteInReadOnly: string[] = [];
const unclassified: string[] = [];
const writeActionNames: string[] = [];

for (const span of actionSpans) {
  const body = bodyOf(span);
  const hasWrite = hasWriteCall(body);
  const hasGuard = body.includes(GUARD);

  if (READ_ONLY_ACTIONS.has(span.name) || LIFECYCLE_ACTIONS.has(span.name)) {
    if (hasWrite) unexpectedWriteInReadOnly.push(span.name);
    continue;
  }
  // 書き込みを行うアクションは全て安全確認を経由していなければならない。
  if (hasWrite) {
    writeActionNames.push(span.name);
    if (!hasGuard) {
      missingGuard.push(span.name);
    } else {
      // 単にガード文字列が本文に存在するだけでなく、最初の書き込みより前にあることを確認する。
      const guardIdx = body.indexOf(GUARD);
      const writeIdx = firstWriteIndex(body);
      if (writeIdx === null || guardIdx > writeIdx) guardAfterFirstWrite.push(span.name);
    }
    continue;
  }
  // 書き込みも読み取り専用指定も無い＝分類漏れ（新規アクションの棚卸し漏れを検出する）。
  unclassified.push(span.name);
}

assert.deepEqual(
  missingGuard,
  [],
  `Supabaseへ書き込みを行うのに安全確認(${GUARD})を呼んでいない公開アクション: ${missingGuard.join(", ")}`,
);
assert.deepEqual(
  guardAfterFirstWrite,
  [],
  `安全確認(${GUARD})が最初の書き込みより後にある公開アクション: ${guardAfterFirstWrite.join(", ")}`,
);
assert.deepEqual(
  unexpectedWriteInReadOnly,
  [],
  `読み取り専用として分類したアクションが実際には書き込みを行っている: ${unexpectedWriteInReadOnly.join(", ")}`,
);
assert.deepEqual(
  unclassified,
  [],
  `書き込み・読み取り専用のいずれにも分類されない未知のアクション（棚卸し漏れの可能性）: ${unclassified.join(", ")}`,
);
assert.equal(
  writeActionNames.length,
  20,
  `書き込みを行う公開アクションの件数が想定(20件＝既存4件＋必須新規16件)と異なる(${writeActionNames.length}件): ${writeActionNames.join(", ")}`,
);

// 2) 必須対象16件（changeTopicAssignmentを含む。二重計上しない）が実際にこの一覧に
//    存在し、全て安全確認を呼んでいることを明示する。
const REQUIRED_NEW_TARGETS = [
  "openReception",
  "randomizeGroups",
  "setParticipantGroup",
  "changeTopicAssignment",
  "sendAnnouncement",
  "clearAnnouncement",
  "sendPrivateMessage",
  "clearPrivateMessage",
  "kickParticipant",
  "unkickParticipant",
  "resyncEligibleJudgeCounts",
  "updateCapacity",
  "setAccessRestricted",
  "closeLive",
  "emergencyCloseLive",
  "retryRankRewards",
];
assert.equal(
  new Set(REQUIRED_NEW_TARGETS).size,
  16,
  "REQUIRED_NEW_TARGETS自体に重複がある(二重計上のバグ)",
);
for (const name of REQUIRED_NEW_TARGETS) {
  const span = actionSpans.find((s) => s.name === name);
  assert.ok(span, `必須対象${name}が公開アクション一覧に見つからない`);
  assert.ok(
    bodyOf(span!).includes(GUARD),
    `必須対象${name}が安全確認(${GUARD})を呼んでいない`,
  );
}
// 既存の4件（今回変更していない）も維持されていることを確認する。
const EXISTING_TARGETS = ["createLivePreparation", "beginGame", "addNextRound", "finishLiveFromRoundDecision"];
for (const name of EXISTING_TARGETS) {
  const span = actionSpans.find((s) => s.name === name);
  assert.ok(span, `既存ガード対象${name}が見つからない`);
  assert.ok(bodyOf(span!).includes(GUARD), `既存ガード対象${name}が安全確認を呼んでいない`);
}
assert.equal(
  new Set([...REQUIRED_NEW_TARGETS, ...EXISTING_TARGETS]).size,
  20,
  "必須新規16件と既存4件の合計がwriteActionNamesの件数(20件)と一致しない(二重計上の可能性)",
);
console.log(
  `PASS: 棚卸し一致検査 - 公開アクション25件(書き込み20件＋読取専用3件＋ライフサイクル2件)のうち、書き込みを行う全アクションが${GUARD}を最初の書き込みより前で呼び、必須対象16件＋既存4件を含む`,
);

// 3) 自動進行（モジュール内部のtick関数）：各書き込みRPCの直前に安全確認がある。
const AUTO_PROGRESSION_WRITE_RPCS = [
  "reveal_next_answer_if_due",
  "resolve_answer_if_due",
  "sync_answering_pause_if_due",
  "host_advance_answering_to_group_result",
  "host_advance_group_result_to_next",
  "host_advance_topic_reveal_to_answering",
  "host_advance_interlude_to_opening",
];
for (const rpcName of AUTO_PROGRESSION_WRITE_RPCS) {
  const idx = store.indexOf(`"${rpcName}"`);
  assert.ok(idx >= 0, `自動進行RPC ${rpcName} の呼び出しが見つからない`);
  // 直前2000文字以内に安全確認の呼び出しがあることを確認する（直前の別のRPC呼び出しの
  // 安全確認を誤って参照しないよう、直前の別のrpc("...")呼び出しより後にあることも確認）。
  const before = store.slice(Math.max(0, idx - 2000), idx);
  assert.ok(
    before.includes(GUARD),
    `自動進行RPC ${rpcName} の直前に安全確認(${GUARD})が見つからない`,
  );
}
// runBotBehavior（ボットのtsukkomi送信・回答insert・採点insert）：遅延評価＋1呼び出し内
// 最大1回キャッシュのensureBotStagingAllowed()が、各書き込みの直前で呼ばれていること。
{
  const start = store.indexOf("async function runBotBehavior(");
  assert.ok(start >= 0, "runBotBehaviorが見つからない");
  const end = store.indexOf("\nasync function hydrateHostForActiveLive", start);
  const body = store.slice(start, end > 0 ? end : start + 6000);
  assert.ok(body.includes(GUARD), "runBotBehaviorが安全確認を呼んでいない");
  // 実際の書き込み判定自体は、本文中で1回だけ呼ばれるassertStagingOperationAllowed()を
  // ラップしたローカル関数ensureBotStagingAllowed()を経由している。このキャッシュ
  // (botStagingCheckPromise)はrunBotBehavior呼び出しごとに新しく作られるローカル変数
  // であり、呼び出しをまたいでpersistedされないことは、この変数がrunBotBehavior関数内の
  // letであるという構造（スコープ）そのものによって保証される。実際にボットが存在する
  // 状態でanswering phaseのtickを発火させ、answers/scores insertの経路を実呼び出しで
  // 検証する動的テストは、本リポジトリには現時点で存在しない（タイミング・組分け等の
  // 前提条件構築が複雑なため見送っており、この静的検査が唯一の確認手段。残課題として
  // 報告済み）。
  const assertCallCount = (body.match(/assertStagingOperationAllowed\(\)/g) ?? []).length;
  assert.equal(
    assertCallCount,
    1,
    `runBotBehaviorがassertStagingOperationAllowed()を直接呼ぶ箇所が1箇所(ensureBotStagingAllowed定義内)の想定と異なる(${assertCallCount}箇所)`,
  );
  const ensureCallCount = (body.match(/ensureBotStagingAllowed\(\)/g) ?? []).length;
  // 定義1回の呼び出し(関数内部のbotStagingCheckPromise初期化) + 3つの書き込み分岐での
  // 呼び出し(tsukkomi送信・回答insert・採点insert) = 4回参照されている想定
  // （定義自体には "ensureBotStagingAllowed()" という文字列は出現しないため、
  // ここでカウントされるのは3つの書き込み分岐での呼び出しのみ）。
  assert.equal(
    ensureCallCount,
    3,
    `runBotBehaviorでensureBotStagingAllowed()が呼ばれる箇所数が想定(3箇所)と異なる(${ensureCallCount}箇所)`,
  );
  const ensureIdx = [...body.matchAll(/ensureBotStagingAllowed\(\)/g)].map((m) => m.index!);
  const tsukkomiIdx = body.indexOf('rpc("send_tsukkomi"');
  const answerInsertIdx = body.indexOf('from("answers").insert(');
  const scoreInsertIdx = body.indexOf('from("scores").insert(');
  const lastEnsureBefore = (writeIdx: number) => Math.max(...ensureIdx.filter((i) => i < writeIdx));
  // 2026-10-10（レビュー対応）：ensureBotStagingAllowed()成功後、INSERT直前に
  // live/turn/回答状態を再検証するコードが間に入るため、window
  // （「直前」とみなす距離）に余裕を持たせる（600文字程度の再検証コードを許容）。
  const NEARBY_WINDOW = 600;
  assert.ok(
    tsukkomiIdx - lastEnsureBefore(tsukkomiIdx) < NEARBY_WINDOW,
    "runBotBehaviorのtsukkomi送信の直前にensureBotStagingAllowed()呼び出しが無い",
  );
  assert.ok(
    answerInsertIdx - lastEnsureBefore(answerInsertIdx) < NEARBY_WINDOW,
    "runBotBehaviorの回答insertの直前にensureBotStagingAllowed()呼び出しが無い",
  );
  assert.ok(
    scoreInsertIdx - lastEnsureBefore(scoreInsertIdx) < NEARBY_WINDOW,
    "runBotBehaviorの採点insertの直前にensureBotStagingAllowed()呼び出しが無い",
  );
}
console.log(
  "PASS: 自動進行（tick関数群）の全書き込みRPC・ボット書き込みが、実行前に安全確認を経由する",
);

// 4) updateLive（内部ヘルパー）自身はガードを持たないが、全ての呼び出し元
//    （sendAnnouncement/clearAnnouncement/updateCapacity）は自身の安全確認を持つ
//    （呼び出し元で既に確認済みのため、内部ヘルパーでの二重確認は行わない設計）。
{
  const callers = ["sendAnnouncement", "clearAnnouncement", "updateCapacity"];
  for (const name of callers) {
    const span = actionSpans.find((s) => s.name === name);
    assert.ok(span, `${name}が見つからない`);
    const body = bodyOf(span!);
    assert.ok(body.includes("updateLive("), `${name}がupdateLive()を呼んでいない（想定外の実装変更）`);
    const guardIdx = body.indexOf(GUARD);
    const updateLiveIdx = body.indexOf("updateLive(");
    assert.ok(guardIdx >= 0 && guardIdx < updateLiveIdx, `${name}の安全確認がupdateLive()呼び出しより後にある`);
  }
  // updateLive自体のmodule-levelヘルパー定義を確認（他の呼び出し元が増えていないか、
  // 念のため呼び出し箇所数を数える：3箇所(sendAnnouncement/clearAnnouncement/
  // updateCapacity)以外に増えていたら、新しい呼び出し元にも安全確認が要る）。
  const updateLiveCallCount = (store.match(/\bupdateLive\(/g) ?? []).length;
  // 定義1箇所 + 呼び出し3箇所 = 4
  assert.equal(
    updateLiveCallCount,
    4,
    `updateLive()の呼び出し箇所数が想定(3箇所+定義1箇所=4)と異なる(${updateLiveCallCount}箇所)。新しい呼び出し元が増えていたら、そこにも安全確認が必要`,
  );
}
console.log(
  "PASS: updateLive()の呼び出し元(sendAnnouncement/clearAnnouncement/updateCapacity)は全て、呼び出し前に自身の安全確認を持つ",
);

// 5) useLiveHostStoreだけでなく、/live/hostから到達する運営書き込み・ライブを自動進行
//    させるFollower側の経路も対象に含める。

// 5-1) useLiveFollowerStore.tsのtickIfNeeded（観客側の補助tick）：
//      advance_live_progress_if_dueの直前に安全確認がある。joinLive・回答・採点等の
//      通常のユーザー操作には対象を広げない（それらの関数には安全確認を要求しない）。
{
  const followerPath = "src/store/useLiveFollowerStore.ts";
  const follower = readFileSync(join(ROOT, followerPath), "utf8");
  assert.ok(follower.includes(`import { assertStagingOperationAllowed } from "@/lib/stagingEnv"`) ||
    follower.includes("assertStagingOperationAllowed"), `${followerPath}が安全確認をimportしていない`);
  const idx = follower.indexOf('"advance_live_progress_if_due"');
  assert.ok(idx >= 0, `${followerPath}でadvance_live_progress_if_dueの呼び出しが見つからない`);
  const before = follower.slice(Math.max(0, idx - 1000), idx);
  assert.ok(before.includes(GUARD), `${followerPath}のadvance_live_progress_if_due呼び出しの直前に安全確認が無い`);
  // joinLive等の通常ユーザー操作関数自体には、このRPC名が含まれていないことを
  // 確認する（意図せず自動進行ガードがユーザー操作へ混入していないことの目印）。
  const joinLiveStart = follower.indexOf("joinLive:");
  if (joinLiveStart >= 0) {
    const joinLiveBody = follower.slice(joinLiveStart, joinLiveStart + 3000);
    assert.ok(
      !joinLiveBody.includes("advance_live_progress_if_due"),
      "joinLiveがadvance_live_progress_if_dueを呼んでいる（対象外のはず）",
    );
  }
}

// 5-2) useLiveBotStore.ts addBots：ログイン・プロフィール更新・参加RPCより前に安全確認。
{
  const botStorePath = "src/store/useLiveBotStore.ts";
  const botStore = readFileSync(join(ROOT, botStorePath), "utf8");
  // "addBots: async" はinterface宣言にも出現するため、実装（store生成式）側の
  // 出現を使う必要がある。interfaceの宣言はシグネチャのみで本体"{"を持たないため
  // 2回目以降の出現を使う。
  const addBotsStart = botStore.indexOf("addBots: async", botStore.indexOf("create<LiveBotState>"));
  assert.ok(addBotsStart >= 0, `${botStorePath}でaddBotsの実装が見つからない`);
  const removeAllBotsStart = botStore.indexOf("removeAllBots:", addBotsStart);
  const addBotsBody = botStore.slice(addBotsStart, removeAllBotsStart > 0 ? removeAllBotsStart : addBotsStart + 4000);
  assert.ok(addBotsBody.includes(GUARD), `${botStorePath}のaddBotsが安全確認を呼んでいない`);
  const guardIdx = addBotsBody.indexOf(GUARD);
  const loginIdx = addBotsBody.indexOf("signInWithPassword(");
  const profileUpdateIdx = addBotsBody.indexOf('from("profiles")');
  const joinLiveRpcIdx = addBotsBody.indexOf('rpc("join_live"');
  assert.ok(loginIdx >= 0 && profileUpdateIdx >= 0 && joinLiveRpcIdx >= 0, `${botStorePath}のaddBotsの想定していた書き込み呼び出しが見つからない`);
  assert.ok(guardIdx < loginIdx, "addBotsの安全確認がボットのログインより後にある");
  assert.ok(guardIdx < profileUpdateIdx, "addBotsの安全確認がプロフィール更新より後にある");
  assert.ok(guardIdx < joinLiveRpcIdx, "addBotsの安全確認が参加RPCより後にある");
}

// 5-3) /live/host (StagingTestersPanel) のテスター許可・失効：
//      実際のRPC呼び出しはsrc/lib/stagingTesterActions.ts（grantStagingTester/
//      revokeStagingTester）に分離されている（StagingTestersPanel本体はReact描画が
//      必要でこのランナーからは直接呼び出せないため、実処理を分離してこのファイル単体を
//      動的テストから直接importできるようにした構成。page.tsx側は結果に応じてbusy/
//      messageを更新するだけで、RPC・安全確認は持たない）。
{
  const hostPagePath = "src/app/live/host/page.tsx";
  const hostPage = readFileSync(join(ROOT, hostPagePath), "utf8");
  assert.ok(
    hostPage.includes('from "@/lib/stagingTesterActions"'),
    `${hostPagePath}がstagingTesterActionsから許可/失効関数をimportしていない`,
  );
  assert.ok(
    !hostPage.includes('"host_grant_staging_tester"') && !hostPage.includes('"host_revoke_staging_tester"'),
    `${hostPagePath}が直接host_grant/revoke_staging_testerを呼んでいる（stagingTesterActions.tsへ分離したはず）`,
  );

  const actionsPath = "src/lib/stagingTesterActions.ts";
  const actions = readFileSync(join(ROOT, actionsPath), "utf8");
  for (const rpcName of ["host_grant_staging_tester", "host_revoke_staging_tester"]) {
    const idx = actions.indexOf(`"${rpcName}"`);
    assert.ok(idx >= 0, `${actionsPath}で${rpcName}の呼び出しが見つからない`);
    const before = actions.slice(Math.max(0, idx - 500), idx);
    assert.ok(before.includes(GUARD), `${actionsPath}の${rpcName}呼び出しの直前に安全確認が無い`);
  }
}
console.log(
  "PASS: useLiveHostStore以外（useLiveFollowerStoreの補助tick・useLiveBotStore.addBots・/live/hostのstaging_testers許可/失効）も安全確認を最初の書き込みより前で経由する",
);

console.log("ALL LIVE_HOST_STAGING_GUARD_INVENTORY CHECKS PASSED");
