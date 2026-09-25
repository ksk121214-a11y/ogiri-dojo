// useConsentGateStore.ts（Xログイン・ゲスト参加の直前に表示する明示同意ゲート）を
// 「本番と同じ実装のまま」呼び出して、状態遷移を検証するスクリプト。
// 実行方法はsrc/lib/__tests__/run.sh参照（useAuthStoreGuest.check.ts等と同様、
// 専用tsconfig＋pathAliasHook経由）。
//
// このリポジトリのテスト実行環境（node直接実行）にはwindow/localStorageが
// 存在しない。useConsentGateStore.ts自体はwindow参照をすべて関数本体の中に
// 閉じ込めており（モジュール読み込み時点では参照しない）、main()実行前に
// globalThis.windowへ最小限のlocalStorageスタブを仕込んでおけば、実際の
// signInWithX/signInAsGuestと同じく本番コードをそのまま検証できる
// （jsdom等の追加依存を増やさない、他のcheck.tsと同じ最小限のグローバル注入）。
import assert from "node:assert/strict";

import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/legalInfo";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import {
  CONSENT_ACK_STORAGE_KEY,
  PENDING_CONSENT_STORAGE_KEY,
  useConsentGateStore,
  type PendingConsentFlag,
} from "@/store/useConsentGateStore";

class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const fakeLocalStorage = new FakeLocalStorage();
(globalThis as unknown as { window: { localStorage: FakeLocalStorage } }).window = {
  localStorage: fakeLocalStorage,
};

// ---- supabase.rpc(...) の最小限のモック（ゲスト参加成功時の
// record_terms_consent即時呼び出しを検証するために必要）。----
let rpcCalls: { name: string }[] = [];
let rpcResponse: { error: unknown } = { error: null };
(supabase as unknown as { rpc: (name: string) => Promise<{ error: unknown }> }).rpc = async (name) => {
  rpcCalls.push({ name });
  return rpcResponse;
};

function readPendingFlagFromStorage(): PendingConsentFlag | null {
  const raw = fakeLocalStorage.getItem(PENDING_CONSENT_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as PendingConsentFlag) : null;
}

function resetAuthMocks() {
  const xLoginCalls: unknown[] = [];
  let guestStartCalls: number = 0;
  useAuthStore.setState({
    signInWithX: async (options?: unknown) => {
      xLoginCalls.push(options);
      return { ok: true };
    },
    signInAsGuest: async () => {
      guestStartCalls += 1;
      return { ok: true };
    },
  });
  return {
    getXLoginCalls: () => xLoginCalls,
    getGuestStartCalls: () => guestStartCalls,
  };
}

async function main() {
  // ---- テスト1: 未同意（localStorageに同意記録が無い）の場合、requestXLoginは
  //      実際のsignInWithXを呼ばず、モーダル表示状態(pendingModal)だけをセットする。 ----
  fakeLocalStorage.clear();
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  let mocks = resetAuthMocks();
  const r1 = await useConsentGateStore.getState().requestXLogin({ isGuestSwitch: true });
  assert.deepEqual(r1, { ok: false });
  assert.equal(mocks.getXLoginCalls().length, 0, "未同意なのに実際のsignInWithXが呼ばれてしまった");
  assert.deepEqual(useConsentGateStore.getState().pendingModal, { kind: "x-login", options: { isGuestSwitch: true } });
  console.log("PASS: 未同意の状態でrequestXLoginを呼ぶと、実処理は呼ばずモーダル表示状態になる");

  // ---- テスト2: モーダルの「同意して続ける」（confirm）で、Xログインの場合は
  //      種別(kind:"x-login")・作成日時付きの保留フラグが書き込まれ（DB記録は
  //      ページ遷移後にConsentRequiredGateが行うため、ここでは直接記録しない）、
  //      端末の「同意済み」フラグが記録され、保留していたsignInWithXが元の
  //      options付きで呼ばれ、モーダルが閉じる。 ----
  const beforeConfirm = Date.now();
  await useConsentGateStore.getState().confirm();
  assert.equal(mocks.getXLoginCalls().length, 1, "confirm後に実際のsignInWithXが1回呼ばれていない");
  assert.deepEqual(mocks.getXLoginCalls()[0], { isGuestSwitch: true }, "confirmが元のoptionsをsignInWithXへ引き継いでいない");
  assert.equal(useConsentGateStore.getState().pendingModal, null, "confirm後もモーダルが閉じていない");
  assert.equal(
    fakeLocalStorage.getItem(CONSENT_ACK_STORAGE_KEY),
    `${TERMS_VERSION}|${PRIVACY_VERSION}`,
    "confirm後に同意済みバージョンがlocalStorageへ記録されていない",
  );
  const pendingAfterXLogin = readPendingFlagFromStorage();
  assert.ok(pendingAfterXLogin, "Xログイン成功後に種別付きの保留フラグが書き込まれていない");
  assert.equal(pendingAfterXLogin!.kind, "x-login", "保留フラグの種別がx-loginになっていない");
  assert.equal(pendingAfterXLogin!.termsVersion, TERMS_VERSION);
  assert.equal(pendingAfterXLogin!.privacyVersion, PRIVACY_VERSION);
  assert.ok(
    pendingAfterXLogin!.createdAt >= beforeConfirm && pendingAfterXLogin!.createdAt <= Date.now(),
    "保留フラグの作成日時(createdAt)がconfirm実行時刻の範囲外になっている",
  );
  assert.equal(rpcCalls.length, 0, "Xログインのconfirmで、この場でrecord_terms_consentが呼ばれてしまった（ページ遷移後に行うべき）");
  console.log("PASS: Xログインで同意すると、種別・作成日時付きの保留フラグが書き込まれ、端末の同意済みフラグも記録され、保留していたXログインが実行される");

  // ---- テスト3: 同意済みバージョンが一致する端末では、requestXLoginが
  //      モーダルを出さず、即座に実際のsignInWithXを呼ぶ。 ----
  mocks = resetAuthMocks();
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  const r3 = await useConsentGateStore.getState().requestXLogin();
  assert.deepEqual(r3, { ok: true });
  assert.equal(mocks.getXLoginCalls().length, 1, "同意済みなのに実際のsignInWithXが呼ばれていない");
  assert.equal(useConsentGateStore.getState().pendingModal, null, "同意済みなのにモーダルが表示されてしまった");
  console.log("PASS: 同意済みバージョンが一致する端末では、モーダルを出さず即座にXログイン処理を呼ぶ");

  // ---- テスト4: 同意記録はあるが版が古い（TERMS_VERSION/PRIVACY_VERSIONが変わった
  //      後）場合は、未同意と同じ扱いでモーダルを再表示する。 ----
  fakeLocalStorage.setItem(CONSENT_ACK_STORAGE_KEY, "2020-01-01-v0|2020-01-01-v0");
  mocks = resetAuthMocks();
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  const r4 = await useConsentGateStore.getState().requestGuestStart();
  assert.deepEqual(r4, { ok: false });
  assert.equal(mocks.getGuestStartCalls(), 0, "旧バージョンの同意記録なのに実際のsignInAsGuestが呼ばれてしまった");
  assert.deepEqual(useConsentGateStore.getState().pendingModal, { kind: "guest" });
  console.log("PASS: 同意記録が古いバージョンのものである場合、未同意と同じ扱いでモーダルを再表示する（ゲスト参加も同様）");

  // ---- テスト5: モーダルの「キャンセル」（cancel）は、localStorageへの記録も
  //      実処理の呼び出しも行わずモーダルだけを閉じる。 ----
  useConsentGateStore.getState().cancel();
  assert.equal(useConsentGateStore.getState().pendingModal, null, "cancel後もモーダルが残っている");
  assert.equal(
    fakeLocalStorage.getItem(CONSENT_ACK_STORAGE_KEY),
    "2020-01-01-v0|2020-01-01-v0",
    "cancelしたのに同意済みバージョンが更新されてしまった",
  );
  assert.equal(mocks.getGuestStartCalls(), 0, "cancelしたのに実際のsignInAsGuestが呼ばれてしまった");
  console.log("PASS: モーダルのキャンセルは、同意記録・実処理のどちらも行わずモーダルを閉じるだけ");

  // ---- テスト6（再監査対応）：Xログインの実処理が失敗した場合、confirmは
  //      モーダルを閉じず、localStorageへの記録も行わず、errorReasonへ
  //      日本語の失敗理由をセットする。 ----
  fakeLocalStorage.clear();
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  mocks = resetAuthMocks();
  await useConsentGateStore.getState().requestXLogin({ isGuestSwitch: false });
  useAuthStore.setState({
    signInWithX: async () => ({ ok: false, reason: "Xログインを開始できませんでした。時間をおいて再度お試しください。" }),
  });
  await useConsentGateStore.getState().confirm();
  assert.deepEqual(
    useConsentGateStore.getState().pendingModal,
    { kind: "x-login", options: { isGuestSwitch: false } },
    "Xログイン失敗時にモーダルが閉じてしまった",
  );
  assert.equal(
    useConsentGateStore.getState().errorReason,
    "Xログインを開始できませんでした。時間をおいて再度お試しください。",
    "Xログイン失敗時にerrorReasonへ失敗理由が反映されていない",
  );
  assert.equal(fakeLocalStorage.getItem(CONSENT_ACK_STORAGE_KEY), null, "Xログイン失敗なのに同意済みバージョンが記録されてしまった");
  console.log("PASS: Xログインの実処理が失敗した場合、モーダルは閉じずerrorReasonへ失敗理由が表示される（同意記録もされない）");

  // ---- テスト7（再監査対応）：signInWithXはreasonを省略して失敗すること
  //      （{ok:false}のみ）が型上あり得る。その場合もerrorReasonが空文字や
  //      undefinedのままにならず、safeな日本語の一般文言にフォールバックする。 ----
  fakeLocalStorage.clear();
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  await useConsentGateStore.getState().requestXLogin();
  useAuthStore.setState({
    signInWithX: async () => ({ ok: false }),
  });
  await useConsentGateStore.getState().confirm();
  assert.ok(
    !!useConsentGateStore.getState().errorReason,
    "reason省略時にerrorReasonが空のままになっている（safeな日本語文言へフォールバックしていない）",
  );
  console.log("PASS: 失敗理由(reason)が省略された場合も、safeな日本語の一般文言へフォールバックする");

  // ---- テスト8（再監査対応）：ゲスト開始の実処理が失敗した場合も同様に、
  //      モーダルを維持しerrorReasonへ理由を表示する。 ----
  fakeLocalStorage.clear();
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  await useConsentGateStore.getState().requestGuestStart();
  useAuthStore.setState({
    signInAsGuest: async () => ({ ok: false, reason: "ゲスト参加に失敗しました。時間をおいて再度お試しください。" }),
  });
  await useConsentGateStore.getState().confirm();
  assert.deepEqual(useConsentGateStore.getState().pendingModal, { kind: "guest" }, "ゲスト開始失敗時にモーダルが閉じてしまった");
  assert.equal(
    useConsentGateStore.getState().errorReason,
    "ゲスト参加に失敗しました。時間をおいて再度お試しください。",
    "ゲスト開始失敗時にerrorReasonへ失敗理由が反映されていない",
  );
  assert.equal(fakeLocalStorage.getItem(CONSENT_ACK_STORAGE_KEY), null, "ゲスト開始失敗なのに同意済みバージョンが記録されてしまった");
  console.log("PASS: ゲスト開始の実処理が失敗した場合も、モーダルは閉じずerrorReasonへ日本語の失敗理由が表示される");

  // ---- テスト9（共有端末での取り違え対策）：ゲスト参加が成功した場合、
  //      保留フラグを経由せずこの場で直接record_terms_consentが呼ばれ、成功
  //      すれば端末の同意済みフラグが記録される。保留フラグは残らない
  //      （＝別の利用者のXログイン試行に取り違えられる余地が無い）。 ----
  fakeLocalStorage.clear();
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  rpcCalls = [];
  rpcResponse = { error: null };
  mocks = resetAuthMocks();
  await useConsentGateStore.getState().requestGuestStart();
  await useConsentGateStore.getState().confirm();
  assert.equal(mocks.getGuestStartCalls(), 1, "ゲスト参加のconfirmで実際のsignInAsGuestが呼ばれていない");
  assert.equal(rpcCalls.length, 1, "ゲスト参加成功後にrecord_terms_consentがこの場で呼ばれていない");
  assert.equal(rpcCalls[0].name, "record_terms_consent");
  assert.equal(
    fakeLocalStorage.getItem(CONSENT_ACK_STORAGE_KEY),
    `${TERMS_VERSION}|${PRIVACY_VERSION}`,
    "ゲスト参加・同意記録の成功後に端末の同意済みフラグが記録されていない",
  );
  assert.equal(
    readPendingFlagFromStorage(),
    null,
    "ゲスト参加は保留フラグを経由しないはずなのに、保留フラグが残ってしまった（取り違えの余地が生じる）",
  );
  assert.equal(useConsentGateStore.getState().pendingModal, null, "ゲスト参加成功後もモーダルが閉じていない");
  console.log("PASS: ゲスト参加が成功すると、保留フラグを経由せずこの場でrecord_terms_consentが呼ばれ、端末の同意済みフラグが記録され、保留フラグは残らない");

  // ---- テスト10（同意保存が失敗した場合は同意済みとして利用可能にしない）：
  //      ゲスト参加自体は成功したが、直後のrecord_terms_consentが失敗した
  //      場合、端末の同意済みフラグは記録されない（この後ConsentRequiredGate
  //      が未同意状態を検知し、あらためて同意画面を表示する）。 ----
  fakeLocalStorage.clear();
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  rpcCalls = [];
  rpcResponse = { error: { message: "network error" } };
  mocks = resetAuthMocks();
  await useConsentGateStore.getState().requestGuestStart();
  await useConsentGateStore.getState().confirm();
  assert.equal(mocks.getGuestStartCalls(), 1, "ゲスト参加のconfirmで実際のsignInAsGuestが呼ばれていない");
  assert.equal(rpcCalls.length, 1, "record_terms_consentが呼ばれていない");
  assert.equal(
    fakeLocalStorage.getItem(CONSENT_ACK_STORAGE_KEY),
    null,
    "同意の記録に失敗したのに、端末の同意済みフラグが記録されてしまった（同意済み扱いになってしまう）",
  );
  assert.equal(useConsentGateStore.getState().pendingModal, null, "ゲスト参加自体は成功しているのにモーダルが閉じていない");
  rpcResponse = { error: null };
  console.log("PASS: ゲスト参加自体は成功しても、同意の記録(record_terms_consent)に失敗した場合は端末の同意済みフラグを記録しない（同意済み扱いにしない）");

  console.log("ALL USE_CONSENT_GATE_STORE CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
