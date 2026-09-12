// useAuthStore.ts の signInAsGuest（0070・ゲスト参加）を「本番と同じ実装のまま」
// 呼び出して、single-flightガード（連打で複数回signInAnonymously()を呼ばない）・
// guestSigningInの状態遷移・失敗時に生のエラーを出さないことを検証するスクリプト。
// 実行方法はsrc/lib/__tests__/run.sh参照（useSnsStoreDelete.check.tsと同様、
// 専用tsconfig＋requireフック経由）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

// ---- supabase.auth.signInAnonymously(...) の最小限のモック ----
let callCount = 0;
let deferred: { promise: Promise<void>; resolve: () => void } | null = null;
let nextError: { message: string } | null = null;

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

(
  supabase.auth as unknown as { signInAnonymously: () => Promise<{ error: unknown }> }
).signInAnonymously = async () => {
  callCount += 1;
  if (deferred) await deferred.promise;
  return { error: nextError };
};

async function main() {
  // ---- テスト1: 成功時はok:trueを返し、signInAnonymouslyをちょうど1回呼ぶ。 ----
  callCount = 0;
  nextError = null;
  deferred = null;
  const r1 = await useAuthStore.getState().signInAsGuest();
  assert.deepEqual(r1, { ok: true });
  assert.equal(callCount, 1, "成功時にsignInAnonymouslyが1回呼ばれていない");
  assert.equal(useAuthStore.getState().guestSigningIn, false, "成功後もguestSigningInがfalseに戻っていない");
  console.log("PASS: signInAsGuestは成功時にok:trueを返し、signInAnonymouslyを1回だけ呼ぶ");

  // ---- テスト2: 連打（並行呼び出し）してもsignInAnonymouslyは1回しか呼ばれない
  //      （single-flightガード）。2回目以降はok:falseで即座に弾かれる。 ----
  callCount = 0;
  nextError = null;
  deferred = makeDeferred();
  const p1 = useAuthStore.getState().signInAsGuest();
  // p1がsignInAnonymously呼び出し内で待機中（guestSigningIn=true）の間に連打する。
  assert.equal(useAuthStore.getState().guestSigningIn, true, "呼び出し中にguestSigningInがtrueになっていない");
  const p2 = useAuthStore.getState().signInAsGuest();
  const p3 = useAuthStore.getState().signInAsGuest();
  deferred.resolve();
  const [res1, res2, res3] = await Promise.all([p1, p2, p3]);
  assert.equal(callCount, 1, `連打してもsignInAnonymouslyは1回だけのはずが${callCount}回呼ばれた`);
  assert.equal(res1.ok, true, "1回目（実際に処理された呼び出し）がok:trueを返さなかった");
  assert.equal(res2.ok, false, "2回目（連打分）がok:falseを返さなかった");
  assert.equal(res3.ok, false, "3回目（連打分）がok:falseを返さなかった");
  assert.equal(useAuthStore.getState().guestSigningIn, false, "完了後もguestSigningInがfalseに戻っていない");
  console.log("PASS: signInAsGuestの連打はsingle-flightガードにより1回しかsignInAnonymouslyを呼ばない");

  // ---- テスト3: 失敗時は生のerror.messageを含まない日本語の一般文言を返す。 ----
  callCount = 0;
  nextError = { message: "PGRST301: some raw postgres/auth error detail" };
  deferred = null;
  const r4 = await useAuthStore.getState().signInAsGuest();
  assert.equal(r4.ok, false);
  if (!r4.ok) {
    assert.ok(!r4.reason.includes("PGRST301"), "失敗時の理由に生のエラー文言が含まれている");
    assert.ok(/ゲスト/.test(r4.reason), "失敗時の理由が日本語のゲスト向け案内になっていない");
  }
  assert.equal(useAuthStore.getState().guestSigningIn, false, "失敗後もguestSigningInがfalseに戻っていない");
  console.log("PASS: signInAsGuestは失敗時、生のエラーを含まない日本語の一般文言を返す");

  console.log("ALL USE_AUTH_STORE_GUEST CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
