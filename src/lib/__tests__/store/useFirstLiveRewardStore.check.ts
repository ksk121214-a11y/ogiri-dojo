// useFirstLiveRewardStore.ts（本番ライブ#0001〜#0005の最終結果到達記録・限定特典付与、
// supabase/migrations/0081）を「本番と同じ実装のまま」呼び出して、以下を検証する
// スクリプト。実行方法はsrc/lib/__tests__/run.sh参照。
//   - キー単位のsingle-flight（liveId×userIdの組ごとに独立管理。A開始→B開始→A再呼び出し
//     でもAのRPCは1本だけ。異なるキーは互いに独立して並行実行できる。finallyで
//     対象キーだけが解除される）。
//   - 成功後は完全に冪等（RPCを一切呼ばず即座にno-opを返す）。
//   - mark_final_result_presenceがエラー・例外になっても、grant_first_live_rewardは
//     必ず試す（到達記録がDB上では成功していたがレスポンスだけ失われた場合や、
//     その後ライブがclosedになった場合の復旧のため）。
//   - grant_first_live_rewardが失敗・例外の場合だけ完了扱いにせず、再試行できる。
//   - grant_first_live_rewardの戻り値(newly_granted・title_display_name)を
//     そのままnewlyGranted・titleDisplayNameとして返す。
//   - 2026-09-28（レビュー対応）：grant応答が不正な形式（null・空オブジェクト・
//     型不正）の場合は完了扱いにせず再試行できる。
//   - 2026-09-28（レビュー対応・世代ガード）：mark前・mark後grant前・grant後
//     completedKeys更新前の3時点でアカウント切替を検知し、別アカウントへの
//     誤ったRPC実行・completedKeys更新を行わない。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useFirstLiveRewardStore } from "@/store/useFirstLiveRewardStore";

let markCallCount = 0;
let grantCallCount = 0;
let nextMarkError: { message: string } | null = null;
let nextMarkThrows = false;
let nextGrantError: { message: string } | null = null;
let nextGrantThrows = false;
let nextGrantData: unknown = { newly_granted: true, title_display_name: "最初の目撃者" };
let markDeferred: { promise: Promise<void>; resolve: () => void } | null = null;
let grantDeferred: { promise: Promise<void>; resolve: () => void } | null = null;

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

(supabase as unknown as { rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }> }).rpc = async (
  fn: string,
) => {
  if (fn === "mark_final_result_presence") {
    markCallCount += 1;
    if (markDeferred) await markDeferred.promise;
    if (nextMarkThrows) throw new Error("network error (mark)");
    return { data: null, error: nextMarkError };
  }
  if (fn === "grant_first_live_reward") {
    grantCallCount += 1;
    if (grantDeferred) await grantDeferred.promise;
    if (nextGrantThrows) throw new Error("network error (grant)");
    return { data: nextGrantError ? null : nextGrantData, error: nextGrantError };
  }
  throw new Error(`unexpected rpc: ${fn}`);
};

// 2026-09-28追加：attempt()はmark前にuseAuthStore.getState().user?.id===userIdを
// 確認するようになったため、テストごとに「現在の認証ユーザー」を明示的に設定する。
function reset(currentUserId: string) {
  markCallCount = 0;
  grantCallCount = 0;
  nextMarkError = null;
  nextMarkThrows = false;
  nextGrantError = null;
  nextGrantThrows = false;
  nextGrantData = { newly_granted: true, title_display_name: "最初の目撃者" };
  markDeferred = null;
  grantDeferred = null;
  useFirstLiveRewardStore.setState({ completedKeys: {}, inFlightKeys: {} });
  useAuthStore.setState({ user: { id: currentUserId } as never });
}

async function main() {
  // ---- テスト1: 正常系。mark→grantの順に1回ずつ呼ばれ、newlyGranted=true・
  //      titleDisplayNameが返る。 ----
  reset("user-1");
  const r1 = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-1", userId: "user-1" });
  assert.deepEqual(r1, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.equal(markCallCount, 1, "mark_final_result_presenceが1回呼ばれていない");
  assert.equal(grantCallCount, 1, "grant_first_live_rewardが1回呼ばれていない");
  console.log("PASS: 正常系でmark→grantが1回ずつ呼ばれ、newlyGranted=true・titleDisplayNameが返る");

  // ---- テスト2: 成功後は完全に冪等。同じkeyへ再度attemptしてもRPCは一切呼ばれない。 ----
  markCallCount = 0;
  grantCallCount = 0;
  const r2 = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-1", userId: "user-1" });
  assert.equal(r2, null, "成功済みのkeyへの再attemptがnull以外を返した");
  assert.equal(markCallCount, 0, "成功済みなのにmark_final_result_presenceを再度呼んだ");
  assert.equal(grantCallCount, 0, "成功済みなのにgrant_first_live_rewardを再度呼んだ");
  console.log("PASS: 成功済みのkeyは以後、RPCを一切呼ばず即座にno-opを返す（完全に冪等）");

  // ---- テスト3: mark失敗（エラー）でもgrantは必ず試される。既存の到達記録から
  //      grantが成功すれば、通常どおり完了扱いになる（closed後の復旧を模す）。 ----
  reset("user-2");
  nextMarkError = { message: "NOT_FINAL_RESULT_PHASE" };
  const r3 = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-2", userId: "user-2" });
  assert.deepEqual(r3, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.equal(markCallCount, 1, "markが呼ばれていない");
  assert.equal(grantCallCount, 1, "mark失敗時にgrantが呼ばれなかった（1番の要件違反）");
  assert.ok(
    useFirstLiveRewardStore.getState().completedKeys["live-2|user-2"],
    "mark失敗でもgrantが成功したのに完了扱いになっていない",
  );
  console.log("PASS: markがエラーでも、既存の到達記録からgrantが成功すれば通常どおり完了扱いになる（closed後の復旧）");

  // ---- テスト4: mark自体が例外（通信断）でも、grantは必ず試される。 ----
  reset("user-3");
  nextMarkThrows = true;
  const r4 = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-3", userId: "user-3" });
  assert.deepEqual(r4, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.equal(grantCallCount, 1, "mark例外時にgrantが呼ばれなかった");
  console.log("PASS: markの呼び出し自体が例外（通信断）でも、grantは必ず試される");

  // ---- テスト5: mark失敗＋到達記録も無い（grantがNO_PRESENCE_RECORD）場合は、
  //      完了扱いにならず再試行できる。 ----
  reset("user-4");
  nextMarkError = { message: "GUEST_NOT_ELIGIBLE" };
  nextGrantError = { message: "NO_PRESENCE_RECORD" };
  const r5 = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-4", userId: "user-4" });
  assert.equal(r5, null);
  assert.equal(
    useFirstLiveRewardStore.getState().completedKeys["live-4|user-4"],
    undefined,
    "mark失敗+NO_PRESENCE_RECORDなのに完了扱いになっている",
  );
  console.log("PASS: mark失敗かつ到達記録も無い場合（grant=NO_PRESENCE_RECORD）は完了扱いにならず再試行できる");

  // ---- テスト6: markは成功したが、grantだけ失敗（通信断等）した場合も、
  //      完了扱いにせず再試行で復旧できる。 ----
  reset("user-5");
  nextGrantError = { message: "network error" };
  const r6 = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-5", userId: "user-5" });
  assert.equal(r6, null);
  assert.equal(markCallCount, 1);
  assert.equal(grantCallCount, 1);
  assert.equal(
    useFirstLiveRewardStore.getState().completedKeys["live-5|user-5"],
    undefined,
    "grant失敗なのに完了扱いになっている",
  );
  nextGrantError = null;
  const r6b = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-5", userId: "user-5" });
  assert.deepEqual(r6b, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.equal(markCallCount, 2, "再試行でmarkが再送されていない（冪等なDB側に委ねる設計）");
  assert.equal(grantCallCount, 2, "再試行でgrantが再送されていない");
  console.log("PASS: 到達記録後にgrantだけ失敗しても、再試行で復旧できる（通信復旧後のシナリオ）");

  // ---- テスト7: grantがDBでは成功したがレスポンスだけ失われ（例外）、再試行で
  //      newlyGranted=falseとなっても完了扱いになる。 ----
  reset("user-6");
  nextGrantThrows = true;
  const r7 = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-6", userId: "user-6" });
  assert.equal(r7, null);
  assert.equal(
    useFirstLiveRewardStore.getState().completedKeys["live-6|user-6"],
    undefined,
    "grant例外なのに完了扱いになっている",
  );
  nextGrantThrows = false;
  nextGrantData = { newly_granted: false, title_display_name: "最初の目撃者" };
  const r7b = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-6", userId: "user-6" });
  assert.deepEqual(r7b, { newlyGranted: false, titleDisplayName: "最初の目撃者" });
  assert.ok(
    useFirstLiveRewardStore.getState().completedKeys["live-6|user-6"],
    "newlyGranted=falseでも完了扱いになっていない",
  );
  console.log("PASS: grantの応答喪失（例外）後、再試行でnewlyGranted=falseとなっても完了扱いになる（モーダルは出ない判定）");

  // ---- テスト8: A開始→B開始→A再呼び出しでも、Aのmark RPCは1本だけ
  //      （キー単位のsingle-flight。以前は単一のinFlightKeyだったため、この
  //      順序でAが二重実行されるバグがあった）。同一の認証ユーザーのまま、
  //      異なるliveId（＝異なるkey）で検証する。 ----
  reset("user-X");
  const deferredA = makeDeferred();
  markDeferred = deferredA;
  const pA1 = useFirstLiveRewardStore.getState().attempt({ liveId: "live-7", userId: "user-X" });
  await Promise.resolve(); // pA1のmark呼び出しが発火するのを待つ
  markDeferred = null; // Bはブロックしない
  const pB = useFirstLiveRewardStore.getState().attempt({ liveId: "live-8", userId: "user-X" });
  await pB; // Bを完了させ、内部のinFlightKeysからBを解除させる
  const pA2 = useFirstLiveRewardStore.getState().attempt({ liveId: "live-7", userId: "user-X" }); // Aはまだ進行中のはず
  deferredA.resolve();
  const [resA1, resA2] = await Promise.all([pA1, pA2]);
  assert.equal(markCallCount, 2, `A(1回)+B(1回)=2回のはずが${markCallCount}回呼ばれた（Aが二重実行されていないか）`);
  assert.deepEqual(resA1, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.equal(resA2, null, "進行中のAへの再呼び出しがnull以外を返した");
  console.log("PASS: A開始→B開始→A再呼び出しでも、Aのmark RPCは1本だけ（キー単位のsingle-flight）");

  // ---- テスト9: 異なるkey同士は互いに独立して並行実行できる
  //      （同一の認証ユーザーのまま、異なるliveIdで検証する）。 ----
  reset("user-Y");
  markDeferred = makeDeferred();
  const pC = useFirstLiveRewardStore.getState().attempt({ liveId: "live-9", userId: "user-Y" });
  const pD = useFirstLiveRewardStore.getState().attempt({ liveId: "live-10", userId: "user-Y" });
  markDeferred.resolve();
  const [resC, resD] = await Promise.all([pC, pD]);
  assert.deepEqual(resC, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.deepEqual(resD, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.equal(markCallCount, 2, "異なるkey同士が互いにブロックしてしまっている");
  console.log("PASS: 異なるlive×userの組は互いに独立して並行実行できる");

  // ---- テスト10: 同じkeyへの並行attemptは、進行中のものだけが処理され、
  //      それ以外は即座にno-opを返す（single-flight）。 ----
  reset("user-E");
  markDeferred = makeDeferred();
  const p1 = useFirstLiveRewardStore.getState().attempt({ liveId: "live-11", userId: "user-E" });
  const p2 = useFirstLiveRewardStore.getState().attempt({ liveId: "live-11", userId: "user-E" });
  const p3 = useFirstLiveRewardStore.getState().attempt({ liveId: "live-11", userId: "user-E" });
  markDeferred.resolve();
  const [res1, res2, res3] = await Promise.all([p1, p2, p3]);
  assert.equal(markCallCount, 1, `並行attemptしてもmarkは1回だけのはずが${markCallCount}回呼ばれた`);
  assert.equal(grantCallCount, 1, `並行attemptしてもgrantは1回だけのはずが${grantCallCount}回呼ばれた`);
  assert.deepEqual(res1, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.equal(res2, null, "2回目（並行分）がnull以外を返した");
  assert.equal(res3, null, "3回目（並行分）がnull以外を返した");
  console.log("PASS: 同じlive×userの組への並行attemptはsingle-flightにより1回しかRPCを呼ばない");

  // ---- テスト11: finallyで対象キーだけが解除される（同じキーへの再attemptが
  //      完了後にちゃんと新規実行できる＝inFlightKeysが residual で残っていない）。 ----
  reset("user-F");
  const first = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-12", userId: "user-F" });
  assert.deepEqual(first, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  assert.deepEqual(useFirstLiveRewardStore.getState().inFlightKeys, {}, "完了後もinFlightKeysにキーが残っている");
  console.log("PASS: finallyで対象キーのinFlight状態が確実に解除される");

  // ---- テスト12〜14: grant応答が不正な形式（null・空オブジェクト・型不正）の
  //      場合は完了扱いにせず、正しい応答が返れば再試行で復旧できる。 ----
  for (const [label, badData] of [
    ["null", null],
    ["空オブジェクト", {}],
    ["型不正(newly_grantedが文字列・title_display_nameが数値)", { newly_granted: "true", title_display_name: 123 }],
  ] as const) {
    reset(`user-bad-${label}`);
    nextGrantData = badData;
    const rBad = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-bad", userId: `user-bad-${label}` });
    assert.equal(rBad, null, `不正な応答(${label})なのにnull以外を返した`);
    assert.equal(
      useFirstLiveRewardStore.getState().completedKeys[`live-bad|user-bad-${label}`],
      undefined,
      `不正な応答(${label})なのに完了扱いになっている`,
    );
    // 正しい応答が返れば再試行で復旧できる。
    nextGrantData = { newly_granted: true, title_display_name: "最初の目撃者" };
    const rBadRetry = await useFirstLiveRewardStore
      .getState()
      .attempt({ liveId: "live-bad", userId: `user-bad-${label}` });
    assert.deepEqual(rBadRetry, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
    console.log(`PASS: grant応答が不正な形式(${label})の場合は完了扱いにならず、正しい応答が返れば再試行で復旧できる`);
  }

  // ---- テスト15（世代ガード・チェックポイント1）：attempt開始時点で既にアカウントが
  //      切り替わっていれば、mark/grantのどちらも呼ばず即座にno-opを返す。 ----
  reset("user-orig-1");
  useAuthStore.setState({ user: { id: "user-switched-1" } as never }); // 開始前に切り替え
  const rSwitch1 = await useFirstLiveRewardStore.getState().attempt({ liveId: "live-switch-1", userId: "user-orig-1" });
  assert.equal(rSwitch1, null, "開始時点で既にアカウントが切り替わっているのにnull以外を返した");
  assert.equal(markCallCount, 0, "開始時点でアカウント切替済みなのにmarkが呼ばれた");
  assert.equal(grantCallCount, 0, "開始時点でアカウント切替済みなのにgrantが呼ばれた");
  console.log("PASS: attempt開始時点で既にアカウントが切り替わっていれば、mark/grantのどちらも呼ばれない");

  // ---- テスト16（世代ガード・チェックポイント2）：mark完了後・grant開始前に
  //      アカウントが切り替わっていたら、grantを呼ばない。 ----
  reset("user-orig-2");
  markDeferred = makeDeferred();
  const pSwitch2 = useFirstLiveRewardStore.getState().attempt({ liveId: "live-switch-2", userId: "user-orig-2" });
  await Promise.resolve(); // mark呼び出しが発火する（markDeferredで止まる）のを待つ
  useAuthStore.setState({ user: { id: "user-switched-2" } as never }); // markの最中に切り替え
  markDeferred.resolve();
  const rSwitch2 = await pSwitch2;
  assert.equal(rSwitch2, null, "mark完了後にアカウントが切り替わっているのにnull以外を返した");
  assert.equal(markCallCount, 1, "markが1回呼ばれていない");
  assert.equal(grantCallCount, 0, "mark完了後・grant開始前のアカウント切替を検知できず、grantが呼ばれてしまった");
  assert.equal(
    useFirstLiveRewardStore.getState().completedKeys["live-switch-2|user-orig-2"],
    undefined,
    "アカウント切替で打ち切られたのに完了扱いになっている（元の利用者が戻った時に再試行できない）",
  );
  console.log("PASS: mark完了後・grant開始前にアカウントが切り替わっていたら、grantを呼ばず打ち切る（元の利用者は再試行可能なまま）");

  // 元の利用者に戻れば、そのまま再試行して正常に完了できる（打ち切られた状態が
  // 恒久的に壊れていないことの確認）。
  useAuthStore.setState({ user: { id: "user-orig-2" } as never });
  const rSwitch2Retry = await useFirstLiveRewardStore
    .getState()
    .attempt({ liveId: "live-switch-2", userId: "user-orig-2" });
  assert.deepEqual(rSwitch2Retry, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  console.log("PASS: アカウントが元の利用者に戻れば、打ち切られていた処理を最初から再試行して正常に完了できる");

  // ---- テスト17（世代ガード・チェックポイント3）：grant完了後・completedKeys更新前に
  //      アカウントが切り替わっていたら、completedKeysを更新しない（別利用者の
  //      セッションへ結果を反映しない）。 ----
  reset("user-orig-3");
  grantDeferred = makeDeferred();
  const pSwitch3 = useFirstLiveRewardStore.getState().attempt({ liveId: "live-switch-3", userId: "user-orig-3" });
  // markは即座に完了し、grantが呼ばれてgrantDeferredで止まるまで待つ
  // （ハングを避けるため待機回数に上限を設ける）。
  for (let i = 0; i < 1000 && grantCallCount === 0; i += 1) {
    await Promise.resolve();
  }
  assert.equal(grantCallCount, 1, "grantが呼ばれるのを待っている間にタイムアウトした（実装が変わった可能性）");
  useAuthStore.setState({ user: { id: "user-switched-3" } as never }); // grantの最中に切り替え
  grantDeferred.resolve();
  const rSwitch3 = await pSwitch3;
  assert.equal(rSwitch3, null, "grant完了後にアカウントが切り替わっているのにnull以外を返した");
  assert.equal(grantCallCount, 1, "grantが1回呼ばれていない");
  assert.equal(
    useFirstLiveRewardStore.getState().completedKeys["live-switch-3|user-orig-3"],
    undefined,
    "grant完了後のアカウント切替を検知できず、completedKeysが更新されてしまった",
  );
  console.log("PASS: grant完了後・completedKeys更新前にアカウントが切り替わっていたら、completedKeysを更新しない");

  useAuthStore.setState({ user: { id: "user-orig-3" } as never });
  const rSwitch3Retry = await useFirstLiveRewardStore
    .getState()
    .attempt({ liveId: "live-switch-3", userId: "user-orig-3" });
  assert.deepEqual(rSwitch3Retry, { newlyGranted: true, titleDisplayName: "最初の目撃者" });
  console.log("PASS: チェックポイント3で打ち切られた場合も、元の利用者に戻れば再試行して正常に完了できる");

  console.log("ALL USE_FIRST_LIVE_REWARD_STORE CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
