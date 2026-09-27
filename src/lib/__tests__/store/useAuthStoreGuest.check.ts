// useAuthStore.ts の signInAsGuest（0070・ゲスト参加、2026-09-27にゲスト番号増殖
// バグ修正で既存匿名セッション再利用を追加、同日の再レビュー対応で非匿名
// セッション保護とgetSession失敗時の防御を追加）を「本番と同じ実装のまま」呼び出して
// 以下を検証するスクリプト。実行方法はsrc/lib/__tests__/run.sh参照
// （useSnsStoreDelete.check.tsと同様、専用tsconfig＋requireフック経由）。
//   - single-flightガード（連打で複数回signInAnonymously()を呼ばない）。
//   - guestSigningInの状態遷移（すべてのケースで最後にfalseへ戻る）。
//   - 失敗時に生のエラーを出さない。
//   - 有効な匿名セッションが既にある場合はsignInAnonymously()を呼ばず、
//     同じユーザーIDを再利用する（Xログインをキャンセルしてもゲスト番号が増えない対策）。
//   - Xログイン済み（非匿名）のセッションがある場合は、signInAnonymously()を呼ばず
//     現在のXセッションを維持したまま失敗を返す（誤呼び出しでXセッションを
//     上書きしない対策）。
//   - getSession()自体が失敗（error）・例外（throw）の場合も、既存セッションの
//     有無を判断できないため新規匿名認証へは進まない（未処理Promiseエラーも出さない）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

// ---- supabase.auth.signInAnonymously(...) / getSession(...) の最小限のモック ----
let callCount = 0;
let getSessionCallCount = 0;
let deferred: { promise: Promise<void>; resolve: () => void } | null = null;
let nextError: { message: string } | null = null;
let nextUserId: string | null = null;
let sessionAnonymousUser: { id: string; is_anonymous: boolean } | null = null;
let nextGetSessionError: { message: string } | null = null;
let nextGetSessionThrows = false;

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

(
  supabase.auth as unknown as { signInAnonymously: () => Promise<{ data?: { user?: { id: string } | null }; error: unknown }> }
).signInAnonymously = async () => {
  callCount += 1;
  if (deferred) await deferred.promise;
  return { data: nextUserId ? { user: { id: nextUserId } } : undefined, error: nextError };
};

(
  supabase.auth as unknown as {
    getSession: () => Promise<{
      data: { session: { user: { id: string; is_anonymous: boolean } } | null };
      error: unknown;
    }>;
  }
).getSession = async () => {
  getSessionCallCount += 1;
  if (nextGetSessionThrows) {
    throw new Error("network error detail (raw)");
  }
  if (nextGetSessionError) {
    return { data: { session: null }, error: nextGetSessionError };
  }
  return { data: { session: sessionAnonymousUser ? { user: sessionAnonymousUser } : null }, error: null };
};

function reset() {
  callCount = 0;
  getSessionCallCount = 0;
  nextError = null;
  nextUserId = null;
  sessionAnonymousUser = null;
  nextGetSessionError = null;
  nextGetSessionThrows = false;
  deferred = null;
  useAuthStore.setState({ user: null });
}

async function main() {
  // ---- テスト1: 匿名セッションが無い場合だけ、signInAnonymouslyを1回実行する。 ----
  reset();
  const r1 = await useAuthStore.getState().signInAsGuest();
  assert.deepEqual(r1, { ok: true, userId: null });
  nextUserId = "guest-confirmed";
  const rWithId = await useAuthStore.getState().signInAsGuest();
  assert.deepEqual(rWithId, { ok: true, userId: "guest-confirmed" });
  assert.equal(callCount, 2, "匿名セッションが無い場合にsignInAnonymouslyが呼ばれていない");
  assert.equal(useAuthStore.getState().guestSigningIn, false, "成功後もguestSigningInがfalseに戻っていない");
  console.log("PASS: 匿名セッションが無い場合だけ、signInAnonymouslyを実行する");

  // ---- テスト2: 連打（並行呼び出し）してもsignInAnonymouslyは1回しか呼ばれない
  //      （single-flightガード）。2回目以降はok:falseで即座に弾かれる。 ----
  reset();
  deferred = makeDeferred();
  const p1 = useAuthStore.getState().signInAsGuest();
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

  // ---- テスト3: signInAnonymously失敗時は生のerror.messageを含まない日本語の一般文言を返す。 ----
  reset();
  nextError = { message: "PGRST301: some raw postgres/auth error detail" };
  const r4 = await useAuthStore.getState().signInAsGuest();
  assert.equal(r4.ok, false);
  if (!r4.ok) {
    assert.ok(!r4.reason.includes("PGRST301"), "失敗時の理由に生のエラー文言が含まれている");
    assert.ok(/ゲスト/.test(r4.reason), "失敗時の理由が日本語のゲスト向け案内になっていない");
  }
  assert.equal(useAuthStore.getState().guestSigningIn, false, "失敗後もguestSigningInがfalseに戻っていない");
  console.log("PASS: signInAsGuestは失敗時、生のエラーを含まない日本語の一般文言を返す");

  // ---- テスト4（必須テスト1・ゲスト番号増殖バグの修正）：ストアに有効な匿名ユーザーが
  //      キャッシュされていれば、getSessionにもsignInAnonymouslyにも触れず
  //      同じユーザーIDをそのまま返す。 ----
  reset();
  useAuthStore.setState({
    user: { id: "guest-01", is_anonymous: true } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
  });
  const r5 = await useAuthStore.getState().signInAsGuest();
  assert.deepEqual(r5, { ok: true, userId: "guest-01" });
  assert.equal(callCount, 0, "ストアに匿名ユーザーがあるのにsignInAnonymouslyを呼んだ");
  assert.equal(getSessionCallCount, 0, "ストアのキャッシュがあるのに不要なgetSessionを呼んだ");
  assert.equal(useAuthStore.getState().guestSigningIn, false, "成功後もguestSigningInがfalseに戻っていない");
  console.log("PASS: ストアに有効な匿名ユーザーがあれば、signInAnonymouslyを呼ばず同じユーザーIDを再利用する");

  // ---- テスト5（必須テスト2）：ストアのキャッシュが無くても、実際のセッション
  //      （getSession）に有効な匿名ユーザーがあれば、それを再利用しsignInAnonymouslyは
  //      呼ばない（Xログインをキャンセルした直後などでストアの反映が間に合っていない
  //      場合の防御）。 ----
  reset();
  sessionAnonymousUser = { id: "guest-01", is_anonymous: true };
  const r6 = await useAuthStore.getState().signInAsGuest();
  assert.deepEqual(r6, { ok: true, userId: "guest-01" });
  assert.equal(callCount, 0, "有効な匿名セッションがあるのにsignInAnonymouslyを呼んだ");
  assert.equal(getSessionCallCount, 1, "既存セッションの確認(getSession)をしていない");
  assert.equal(useAuthStore.getState().guestSigningIn, false, "成功後もguestSigningInがfalseに戻っていない");
  console.log("PASS: 有効な匿名セッションがgetSession経由でも確認できれば、それを再利用する");

  // ---- テスト6: 連打してもgetSession経由の再利用が効き、新規匿名認証は0回。 ----
  reset();
  sessionAnonymousUser = { id: "guest-01", is_anonymous: true };
  const [rr1, rr2, rr3] = await Promise.all([
    useAuthStore.getState().signInAsGuest(),
    useAuthStore.getState().signInAsGuest(),
    useAuthStore.getState().signInAsGuest(),
  ]);
  assert.equal(callCount, 0, "既存の匿名セッションがあるのに連打でsignInAnonymouslyが呼ばれた");
  // single-flightガードにより、2回目以降は{ok:false}（1回目だけが実処理される）。
  assert.equal([rr1, rr2, rr3].filter((r) => r.ok).length, 1, "連打時に複数回成功扱いになっている");
  assert.equal(useAuthStore.getState().guestSigningIn, false, "完了後もguestSigningInがfalseに戻っていない");
  console.log("PASS: 有効な匿名セッションがある状態でゲストボタンを連打しても、新規匿名認証は0回");

  // ---- テスト7（必須テスト3・再レビュー対応）：ストアに非匿名（Xログイン済み）の
  //      ユーザーがキャッシュされている場合、signInAnonymouslyを呼ばず、Xセッションを
  //      維持したまま失敗を返す（誤呼び出しから既存のXセッションを守る）。 ----
  reset();
  useAuthStore.setState({
    user: { id: "x-user", is_anonymous: false } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
  });
  const r7 = await useAuthStore.getState().signInAsGuest();
  assert.equal(r7.ok, false, "非匿名ユーザーがいるのに成功扱いになっている（Xセッションを上書きする恐れ）");
  assert.equal(callCount, 0, "非匿名ユーザーがいるのにsignInAnonymouslyを呼んだ");
  assert.equal(getSessionCallCount, 0, "ストアに非匿名ユーザーがあるのに不要なgetSessionを呼んだ");
  assert.equal(
    useAuthStore.getState().user?.id,
    "x-user",
    "signInAsGuestの呼び出しでXセッション（ストアのuser）が書き換えられている",
  );
  if (!r7.ok) assert.ok(/X/.test(r7.reason), "非匿名ユーザーがいる場合の失敗理由がXログイン中である旨を示していない");
  assert.equal(useAuthStore.getState().guestSigningIn, false, "失敗後もguestSigningInがfalseに戻っていない");
  console.log("PASS: ストアに非匿名（Xログイン済み）ユーザーがいる場合、signInAnonymouslyを呼ばずXセッションを維持したまま失敗を返す");

  // ---- テスト8（必須テスト4）：ストアのキャッシュが無くても、getSessionで
  //      非匿名ユーザーが見つかった場合も同様に、signInAnonymouslyを呼ばず失敗を返す。 ----
  reset();
  sessionAnonymousUser = { id: "x-user-2", is_anonymous: false };
  const r8 = await useAuthStore.getState().signInAsGuest();
  assert.equal(r8.ok, false, "getSessionが非匿名ユーザーを返しているのに成功扱いになっている");
  assert.equal(callCount, 0, "getSessionが非匿名ユーザーを返しているのにsignInAnonymouslyを呼んだ");
  assert.equal(getSessionCallCount, 1, "既存セッションの確認(getSession)をしていない");
  if (!r8.ok) assert.ok(/X/.test(r8.reason), "getSession経由で非匿名ユーザーが見つかった場合の失敗理由がXログイン中である旨を示していない");
  assert.equal(useAuthStore.getState().guestSigningIn, false, "失敗後もguestSigningInがfalseに戻っていない");
  console.log("PASS: getSession経由で非匿名（Xログイン済み）ユーザーが見つかった場合も、signInAnonymouslyを呼ばず失敗を返す");

  // ---- テスト9（必須テスト5）：getSession自体がエラーを返した場合、既存セッションの
  //      有無を判断できないため、新規匿名認証へは進まない。 ----
  reset();
  nextGetSessionError = { message: "PGRST000: raw getSession error detail" };
  const r9 = await useAuthStore.getState().signInAsGuest();
  assert.equal(r9.ok, false, "getSessionがエラーを返しているのに成功扱いになっている");
  assert.equal(callCount, 0, "getSessionがエラーを返しているのにsignInAnonymouslyを呼んだ（既存セッションを見失わせる恐れ）");
  if (!r9.ok) {
    assert.ok(!r9.reason.includes("PGRST000"), "getSessionエラー時の理由に生のエラー文言が含まれている");
    assert.ok(/ゲスト/.test(r9.reason), "getSessionエラー時の理由が日本語のゲスト向け案内になっていない");
  }
  assert.equal(useAuthStore.getState().guestSigningIn, false, "失敗後もguestSigningInがfalseに戻っていない");
  console.log("PASS: getSessionがエラーを返した場合、signInAnonymouslyを呼ばず一般的な日本語エラーを返す");

  // ---- テスト10（必須テスト6）：getSession自体が例外を投げた場合も同様に、
  //      新規匿名認証へは進まず、かつ未処理Promiseエラーを漏らさない。 ----
  reset();
  nextGetSessionThrows = true;
  let threw = false;
  let r10: Awaited<ReturnType<ReturnType<typeof useAuthStore.getState>["signInAsGuest"]>> | null = null;
  try {
    r10 = await useAuthStore.getState().signInAsGuest();
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "getSessionの例外がsignInAsGuestの外まで漏れている（未処理Promiseエラーの原因）");
  assert.ok(r10 && r10.ok === false, "getSessionが例外を投げているのに成功扱いになっている");
  assert.equal(callCount, 0, "getSessionが例外を投げているのにsignInAnonymouslyを呼んだ");
  if (r10 && !r10.ok) {
    assert.ok(!r10.reason.includes("network error detail"), "getSession例外時の理由に生のエラー文言が含まれている");
    assert.ok(/ゲスト/.test(r10.reason), "getSession例外時の理由が日本語のゲスト向け案内になっていない");
  }
  assert.equal(useAuthStore.getState().guestSigningIn, false, "失敗後もguestSigningInがfalseに戻っていない");
  console.log("PASS: getSessionが例外を投げた場合も、signInAnonymouslyを呼ばず未処理Promiseエラーも出さない");

  console.log("ALL USE_AUTH_STORE_GUEST CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
