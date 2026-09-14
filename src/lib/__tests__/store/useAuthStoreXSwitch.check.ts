// useAuthStore.ts の signInWithX（2026-09-13、0070ゲスト参加レビュー対応）を
// 「本番と同じ実装のまま」呼び出して、以下を検証するスクリプト。
// 実行方法はsrc/lib/__tests__/run.sh参照（useAuthStoreGuest.check.tsと同様、
// 専用tsconfig＋requireフック経由）。
//   - isGuestSwitch:trueの場合だけ確認ダイアログ(window.confirm)を出し、
//     キャンセルされたらsignOut/signInWithOAuthのどちらも呼ばない。
//   - isGuestSwitch:trueかつ確認されたら、signOut→signInWithOAuthの順で呼ぶ。
//   - isGuestSwitch省略（通常のXログイン・未ログインからの呼び出し）では
//     signOutを一切呼ばず、signInWithOAuthだけを呼ぶ。
//   - xSigningInによるsingle-flightガード（連打防止）。
//   - signOut/signInWithOAuthの失敗時は生のエラーを含まない日本語の一般文言を返す。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

let signOutCallCount = 0;
let oauthCallCount = 0;
let nextSignOutError: { message: string } | null = null;
let nextOauthError: { message: string } | null = null;
let deferred: { promise: Promise<void>; resolve: () => void } | null = null;

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

(supabase.auth as unknown as { signOut: () => Promise<{ error: unknown }> }).signOut = async () => {
  signOutCallCount += 1;
  return { error: nextSignOutError };
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
(global as unknown as { window: unknown }).window = {
  confirm: () => {
    confirmCallCount += 1;
    return confirmResult;
  },
  location: { origin: "http://localhost:3000" },
};

async function main() {
  // ---- テスト1: isGuestSwitch省略（通常のXログイン・未ログインからの呼び出し）は
  //      確認ダイアログを出さず、signOutも一切呼ばず、signInWithOAuthだけを呼ぶ。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  confirmCallCount = 0;
  nextSignOutError = null;
  nextOauthError = null;
  deferred = null;
  const r1 = await useAuthStore.getState().signInWithX();
  assert.deepEqual(r1, { ok: true });
  assert.equal(confirmCallCount, 0, "isGuestSwitch省略時に確認ダイアログを出してしまっている");
  assert.equal(signOutCallCount, 0, "isGuestSwitch省略時に不要なsignOut()を呼んでしまっている");
  assert.equal(oauthCallCount, 1, "isGuestSwitch省略時にsignInWithOAuthが1回呼ばれていない");
  console.log("PASS: isGuestSwitch省略時はsignOutを呼ばずsignInWithOAuthだけを呼ぶ");

  // ---- テスト2: isGuestSwitch:trueの場合、確認ダイアログを出し、確認されたら
  //      signOut→signInWithOAuthの順で呼ぶ。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  confirmCallCount = 0;
  confirmResult = true;
  const r2 = await useAuthStore.getState().signInWithX({ isGuestSwitch: true });
  assert.deepEqual(r2, { ok: true });
  assert.equal(confirmCallCount, 1, "isGuestSwitch:true時に確認ダイアログを出していない");
  assert.equal(signOutCallCount, 1, "isGuestSwitch:true時にsignOut()を呼んでいない");
  assert.equal(oauthCallCount, 1, "isGuestSwitch:true時にsignInWithOAuthを呼んでいない");
  console.log("PASS: isGuestSwitch:true時は確認ダイアログ→signOut→signInWithOAuthの順で呼ぶ");

  // ---- テスト3: isGuestSwitch:trueで確認ダイアログをキャンセルすると、
  //      signOut/signInWithOAuthのどちらも呼ばれない。 ----
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

  // ---- テスト5: signOut失敗時（isGuestSwitch:true）は生のエラーを含まない
  //      日本語の一般文言を返し、signInWithOAuthは呼ばれない。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  nextSignOutError = { message: "PGRST301: some raw postgres/auth error detail" };
  const r5 = await useAuthStore.getState().signInWithX({ isGuestSwitch: true });
  assert.equal(r5.ok, false);
  if (!r5.ok) {
    assert.ok(r5.reason && !r5.reason.includes("PGRST301"), "signOut失敗時の理由に生のエラー文言が含まれている");
  }
  assert.equal(oauthCallCount, 0, "signOutが失敗したのにsignInWithOAuthが呼ばれてしまっている");
  assert.equal(useAuthStore.getState().xSigningIn, false, "失敗後もxSigningInがfalseに戻っていない");
  nextSignOutError = null;
  console.log("PASS: signOut失敗時は生のエラーを含まない日本語の一般文言を返し、OAuthを開始しない");

  // ---- テスト6: signInWithOAuth失敗時は生のエラーを含まない日本語の一般文言を返す。 ----
  oauthCallCount = 0;
  nextOauthError = { message: "some raw oauth error detail" };
  const r6 = await useAuthStore.getState().signInWithX();
  assert.equal(r6.ok, false);
  if (!r6.ok) {
    assert.ok(
      r6.reason && !r6.reason.includes("some raw oauth error detail"),
      "signInWithOAuth失敗時の理由に生のエラー文言が含まれている",
    );
    assert.ok(/Xログイン/.test(r6.reason ?? ""), "失敗時の理由がXログイン向けの案内になっていない");
  }
  nextOauthError = null;
  console.log("PASS: signInWithOAuth失敗時は生のエラーを含まない日本語の一般文言を返す");

  // ---- テスト7（再レビュー対応）：ストアに匿名ユーザー（user.is_anonymous=true）が
  //      入っている状態で、isGuestSwitchを渡さずにsignInWithX()を呼んでも、
  //      呼び出し元のオプションだけを信用せず、確認ダイアログ→signOutを行う。 ----
  signOutCallCount = 0;
  oauthCallCount = 0;
  confirmCallCount = 0;
  confirmResult = true;
  useAuthStore.setState({
    user: { id: "guest-uid", is_anonymous: true } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
  });
  const r7 = await useAuthStore.getState().signInWithX();
  assert.deepEqual(r7, { ok: true });
  assert.equal(confirmCallCount, 1, "user.is_anonymous=true時にisGuestSwitch未指定でも確認ダイアログを出していない");
  assert.equal(signOutCallCount, 1, "user.is_anonymous=true時にisGuestSwitch未指定でもsignOut()を呼んでいない");
  assert.equal(oauthCallCount, 1, "user.is_anonymous=true時にsignInWithOAuthを呼んでいない");
  useAuthStore.setState({ user: null });
  console.log(
    "PASS: ストアのuser.is_anonymous=trueなら、isGuestSwitch未指定でも確認ダイアログ→signOutを行う（呼び出し元の指定だけを信用しない）",
  );

  console.log("ALL USE_AUTH_STORE_X_SWITCH CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
