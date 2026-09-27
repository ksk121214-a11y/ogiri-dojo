// useAuthStore.ts の signInWithX（2026-09-27、ゲスト番号増殖バグ修正後）を
// 「本番と同じ実装のまま」呼び出して、以下を検証するスクリプト。
// 実行方法はsrc/lib/__tests__/run.sh参照（useAuthStoreGuest.check.tsと同様、
// 専用tsconfig＋requireフック経由）。
//   - isGuestSwitch:trueの場合だけ確認ダイアログ(window.confirm)を出す。
//   - OAuth開始前にsupabase.auth.signOut()を一切呼ばない
//     （ゲスト01でキャンセルしてもゲスト01のセッションが残る＝ゲスト番号が増えない）。
//   - isGuestSwitch:trueでキャンセルされたらsignInWithOAuthを呼ばない。
//   - isGuestSwitch省略（通常のXログイン・未ログインからの呼び出し）では
//     確認ダイアログを出さず、signInWithOAuthだけを呼ぶ。
//   - xSigningInによるsingle-flightガード（連打防止）。
//   - signInWithOAuthの失敗時は生のエラーを含まない日本語の一般文言を返す。
//   - 失敗・例外時に未処理Promiseエラーを漏らさない。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

let signOutCallCount = 0;
let oauthCallCount = 0;
let nextOauthError: { message: string } | null = null;
let deferred: { promise: Promise<void>; resolve: () => void } | null = null;

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// signOutは呼ばれてはならない（呼ばれたらcallCountで検出する）。
(supabase.auth as unknown as { signOut: () => Promise<{ error: unknown }> }).signOut = async () => {
  signOutCallCount += 1;
  return { error: null };
};

(
  supabase.auth as unknown as {
    signInWithOAuth: (args: unknown) => Promise<{ data: unknown; error: unknown }>;
  }
).signInWithOAuth = async () => {
  oauthCallCount += 1;
  if (deferred) await deferred.promise;
  return { data: {}, error: nextOauthError };
};

// signInWithXは呼び出し内でwindow.confirm / window.location.origin を参照するため、
// このテストの間だけ最小限のwindowをグローバルに用意する（jsdom等の追加依存を増やさない）。
let confirmCallCount = 0;
let confirmResult = true;
let lastConfirmMessage = "";
(global as unknown as { window: unknown }).window = {
  confirm: (message: string) => {
    confirmCallCount += 1;
    lastConfirmMessage = message;
    return confirmResult;
  },
  location: { origin: "http://localhost:3000" },
};

async function main() {
  // ---- テスト1: isGuestSwitch省略（通常のXログイン・未ログインからの呼び出し）は
  //      確認ダイアログを出さず、signOutも呼ばず、signInWithOAuthだけを呼ぶ。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  confirmCallCount = 0;
  nextOauthError = null;
  deferred = null;
  const r1 = await useAuthStore.getState().signInWithX();
  assert.deepEqual(r1, { ok: true });
  assert.equal(confirmCallCount, 0, "isGuestSwitch省略時に確認ダイアログを出してしまっている");
  assert.equal(signOutCallCount, 0, "isGuestSwitch省略時にsignOut()を呼んでしまっている");
  assert.equal(oauthCallCount, 1, "isGuestSwitch省略時にsignInWithOAuthが1回呼ばれていない");
  console.log("PASS: isGuestSwitch省略時はsignOutを呼ばずsignInWithOAuthだけを呼ぶ");

  // ---- テスト2: isGuestSwitch:trueの場合、確認ダイアログを出し、確認されたら
  //      signOutを呼ばずにsignInWithOAuthを呼ぶ（＝OAuth成功時だけセッション交換で
  //      自然にゲスト状態が終わる設計。事前のsignOut()は行わない）。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  confirmCallCount = 0;
  confirmResult = true;
  const r2 = await useAuthStore.getState().signInWithX({ isGuestSwitch: true });
  assert.deepEqual(r2, { ok: true });
  assert.equal(confirmCallCount, 1, "isGuestSwitch:true時に確認ダイアログを出していない");
  assert.ok(
    /成功した場合、ゲスト参加状態は終了し/.test(lastConfirmMessage),
    "確認ダイアログの文言が処理の実態（成功した場合にだけ終了する）を反映していない",
  );
  assert.equal(signOutCallCount, 0, "isGuestSwitch:true時にsignOut()を呼んでしまっている（ゲスト番号増殖の原因）");
  assert.equal(oauthCallCount, 1, "isGuestSwitch:true時にsignInWithOAuthを呼んでいない");
  console.log("PASS: isGuestSwitch:true時は確認ダイアログ→signInWithOAuthの順で呼び、signOutは呼ばない");

  // ---- テスト3: isGuestSwitch:trueで確認ダイアログをキャンセルすると、
  //      signOut/signInWithOAuthのどちらも呼ばれない（元の匿名セッションは無傷）。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  confirmCallCount = 0;
  confirmResult = false;
  const r3 = await useAuthStore.getState().signInWithX({ isGuestSwitch: true });
  assert.equal(r3.ok, false, "確認ダイアログをキャンセルしたのにok:trueになっている");
  assert.equal(confirmCallCount, 1, "確認ダイアログが表示されていない");
  assert.equal(signOutCallCount, 0, "キャンセルしたのにsignOut()が呼ばれてしまっている");
  assert.equal(oauthCallCount, 0, "キャンセルしたのにsignInWithOAuthが呼ばれてしまっている");
  console.log("PASS: 確認ダイアログをキャンセルするとsignOut/signInWithOAuthのどちらも呼ばれない");
  confirmResult = true;

  // ---- テスト4: 連打（並行呼び出し）してもsignInWithOAuthは1回しか呼ばれない
  //      （xSigningInによるsingle-flightガード）。2回目以降はok:falseで即座に弾かれる。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  deferred = makeDeferred();
  const p1 = useAuthStore.getState().signInWithX();
  assert.equal(useAuthStore.getState().xSigningIn, true, "呼び出し中にxSigningInがtrueになっていない");
  const p2 = useAuthStore.getState().signInWithX();
  const p3 = useAuthStore.getState().signInWithX();
  deferred.resolve();
  const [res1, res2, res3] = await Promise.all([p1, p2, p3]);
  assert.equal(oauthCallCount, 1, `連打してもsignInWithOAuthは1回だけのはずが${oauthCallCount}回呼ばれた`);
  assert.equal(res1.ok, true, "1回目（実際に処理された呼び出し）がok:trueを返さなかった");
  assert.equal(res2.ok, false, "2回目（連打分）がok:falseを返さなかった");
  assert.equal(res3.ok, false, "3回目（連打分）がok:falseを返さなかった");
  assert.equal(useAuthStore.getState().xSigningIn, false, "完了後もxSigningInがfalseに戻っていない");
  deferred = null;
  console.log("PASS: signInWithXの連打はxSigningInによるsingle-flightガードにより1回しかOAuthを呼ばない");

  // ---- テスト5: signInWithOAuth失敗時は生のエラーを含まない日本語の一般文言を返す。
  //      OAuth開始が失敗しても、signOut()は一切呼ばれていない（元のセッションは無傷）。 ----
  oauthCallCount = 0;
  signOutCallCount = 0;
  nextOauthError = { message: "some raw oauth error detail" };
  const r5 = await useAuthStore.getState().signInWithX();
  assert.equal(r5.ok, false);
  if (!r5.ok) {
    assert.ok(
      r5.reason && !r5.reason.includes("some raw oauth error detail"),
      "signInWithOAuth失敗時の理由に生のエラー文言が含まれている",
    );
    assert.ok(/Xログイン/.test(r5.reason ?? ""), "失敗時の理由がXログイン向けの案内になっていない");
  }
  assert.equal(signOutCallCount, 0, "OAuth開始失敗時にsignOut()が呼ばれている");
  assert.equal(useAuthStore.getState().xSigningIn, false, "失敗後もxSigningInがfalseに戻っていない");
  nextOauthError = null;
  console.log("PASS: signInWithOAuth失敗時は生のエラーを含まない日本語の一般文言を返し、signOutも呼ばない");

  // ---- テスト6（再レビュー対応）：ストアに匿名ユーザー（user.is_anonymous=true）が
  //      入っている状態で、isGuestSwitchを渡さずにsignInWithX()を呼んでも、
  //      呼び出し元のオプションだけを信用せず確認ダイアログを出す（signOutは呼ばない）。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  confirmCallCount = 0;
  confirmResult = true;
  useAuthStore.setState({
    user: { id: "guest-uid", is_anonymous: true } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
  });
  const r6 = await useAuthStore.getState().signInWithX();
  assert.deepEqual(r6, { ok: true });
  assert.equal(confirmCallCount, 1, "user.is_anonymous=true時にisGuestSwitch未指定でも確認ダイアログを出していない");
  assert.equal(signOutCallCount, 0, "user.is_anonymous=true時にsignOut()を呼んでしまっている");
  assert.equal(oauthCallCount, 1, "user.is_anonymous=true時にsignInWithOAuthを呼んでいない");
  useAuthStore.setState({ user: null });
  console.log(
    "PASS: ストアのuser.is_anonymous=trueなら、isGuestSwitch未指定でも確認ダイアログを出す（signOutは呼ばない）",
  );

  console.log("ALL USE_AUTH_STORE_X_SWITCH CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
