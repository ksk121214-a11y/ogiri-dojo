// 観客参加の意図を、本番と同じ同意ゲートstore・意図store・駆動関数で通して検証する
// （同意ずみ/未同意、キャンセル、認証失敗、Xログイン、連打、参加済み、別ライブ、離脱）。
import assert from "node:assert/strict";

import { driveAudienceJoin } from "@/lib/audienceJoinDrive";
import { pressGuestAudienceButton } from "@/lib/audienceGuestButton";
import type { IntentContext } from "@/lib/audienceJoinIntent";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legalInfo";
import { supabase } from "@/lib/supabase";
import { resetTermsConsentRecorderForTests } from "@/lib/termsConsentRecorder";
import { useAudienceJoinIntentStore } from "@/store/useAudienceJoinIntentStore";
import { useAuthStore } from "@/store/useAuthStore";
import { CONSENT_ACK_STORAGE_KEY, useConsentGateStore } from "@/store/useConsentGateStore";

class FakeLocalStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const ls = new FakeLocalStorage();
(globalThis as unknown as { window: { localStorage: FakeLocalStorage } }).window = { localStorage: ls };

let recordCalls = 0;
let recordFails = false;
let recordThrows = false;
(supabase as unknown as { rpc: (n: string) => Promise<{ error: unknown }> }).rpc = async () => {
  recordCalls += 1;
  if (recordThrows) throw new TypeError("Failed to fetch");
  return { error: recordFails ? { message: "rpc failed" } : null };
};

const G = "guest-user-1";
let authCalls = 0;
let authResult: { ok: true; userId: string } | { ok: false; reason: string } = { ok: true, userId: G };
let joinCalls = 0;
let joinFails = false;
let pressLiveId: string | null = "live-1";
let authThrows = false;
let setUserOnAuth = true;

function reset(acked: boolean) {
  ls.clear();
  if (acked) ls.setItem(CONSENT_ACK_STORAGE_KEY, `${TERMS_VERSION}|${PRIVACY_VERSION}`);
  resetTermsConsentRecorderForTests();
  authCalls = 0;
  recordCalls = 0;
  joinCalls = 0;
  guestRequests = 0;
  xLoginCalls = 0;
  joinFails = false;
  pressLiveId = "live-1";
  authThrows = false;
  setUserOnAuth = true;
  recordFails = false;
  recordThrows = false;
  authResult = { ok: true, userId: G };
  useConsentGateStore.setState({ pendingModal: null, errorReason: null });
  useAudienceJoinIntentStore.getState().discard();
  useAuthStore.setState({
    user: null,
    guestSigningIn: false,
    signInAsGuest: async () => {
      authCalls += 1;
      await new Promise((r) => setTimeout(r, 5));
      if (authThrows) throw new Error("auth boom");
      if (authResult.ok && setUserOnAuth) {
        useAuthStore.setState({ user: { id: G, is_anonymous: true } as never });
      }
      return authResult;
    },
    xSigningIn: false,
    signInWithX: async () => {
      xLoginCalls += 1;
      return { ok: true };
    },
  });
}

const ctx = (o: Partial<IntentContext> = {}): IntentContext => ({
  authUserId: G,
  authIsAnonymous: true,
  liveLoading: false,
  live: { id: "live-1", phase: "answering" },
  alreadyParticipant: false,
  kicked: false,
  ...o,
});
let guestRequests = 0;
const pressWith = (resolveLiveId: () => Promise<string | null>) => {
  const s = useAudienceJoinIntentStore.getState();
  return pressGuestAudienceButton({
    begin: s.begin,
    isCurrent: s.isCurrent,
    bindLive: s.bindLive,
    resolveLiveId,
    settle: s.settle,
    requestGuestStart: (o) => {
      guestRequests += 1;
      return useConsentGateStore.getState().requestGuestStart(o);
    },
  });
};
const press = () => pressWith(async () => pressLiveId);
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
let xLoginCalls = 0;
const tick = (c: IntentContext = ctx()) => {
  const s = useAudienceJoinIntentStore.getState();
  return driveAudienceJoin(c, {
    evaluate: s.evaluate,
    finishJoin: s.finishJoin,
    joinAudience: async () => {
      joinCalls += 1;
      if (joinFails) throw new Error("net");
    },
  });
};
const status = () => useAudienceJoinIntentStore.getState().state.status;

async function main() {
  // 4) 同意済み：匿名認証後にjoin_liveが1回だけ
  reset(true);
  await press();
  assert.equal(authCalls, 1);
  assert.equal(status(), "armed");
  await tick();
  await tick();
  assert.equal(joinCalls, 1, "同意済みでjoinが1回でない");
  assert.equal(status(), "idle");
  console.log("PASS: 同意済みのゲスト観客ボタンは、匿名認証後にjoin_liveを1回だけ呼ぶ");

  // 5) 未同意：モーダル→同意で1回だけ登録。同意前はjoinしない
  reset(false);
  const p = await press();
  assert.equal(p.pressed, true);
  assert.equal(authCalls, 0, "同意前に匿名認証した");
  assert.equal(useConsentGateStore.getState().pendingModal?.kind, "guest");
  assert.equal(status(), "starting");
  await tick();
  assert.equal(joinCalls, 0, "同意前にjoinした");
  await useConsentGateStore.getState().confirm();
  assert.equal(authCalls, 1);
  assert.equal(recordCalls, 1, "同意記録が1回でない");
  assert.equal(status(), "armed");
  await tick();
  await tick();
  assert.equal(joinCalls, 1, "同意後にjoinが1回でない");
  console.log("PASS: 同意モーダルを挟んでも、同意後に1回だけ観客登録される");

  // 6) 同意キャンセル：登録しない・意図を破棄
  reset(false);
  await press();
  useConsentGateStore.getState().cancel();
  assert.equal(status(), "idle");
  await tick();
  assert.equal(authCalls, 0);
  assert.equal(joinCalls, 0, "キャンセル後に登録された");
  console.log("PASS: 同意をキャンセルすると観客登録されない");

  // 7) 匿名認証失敗：登録しない（同意画面は再試行できる。閉じれば破棄）
  reset(true);
  authResult = { ok: false, reason: "失敗" };
  await press();
  assert.equal(status(), "idle", "認証失敗後に意図が残った");
  await tick();
  assert.equal(joinCalls, 0, "認証失敗なのに登録された");
  reset(false);
  authResult = { ok: false, reason: "失敗" };
  await press();
  await useConsentGateStore.getState().confirm();
  assert.equal(status(), "starting", "同意画面の再試行中は意図を保つ");
  assert.ok(useConsentGateStore.getState().errorReason);
  await tick();
  assert.equal(joinCalls, 0);
  useConsentGateStore.getState().cancel();
  assert.equal(status(), "idle");
  console.log("PASS: 匿名認証が失敗した場合は観客登録されない（再試行中は保留、閉じれば破棄）");

  // 8) Xログイン：ゲスト観客の意図を消費しない
  reset(false);
  await press(); // モーダル（ゲスト）
  await useConsentGateStore.getState().requestXLogin(); // Xログインの同意に置き換わる
  assert.equal(status(), "idle", "Xログイン要求後も古いゲスト意図が残った");
  await tick(ctx({ authUserId: "x-user", authIsAnonymous: false }));
  assert.equal(joinCalls, 0);
  reset(true);
  await press();
  await tick(ctx({ authUserId: "x-user", authIsAnonymous: false })); // 意図成立後にXログインへ切替
  assert.equal(joinCalls, 0, "Xログインで古い意図が実行された");
  assert.equal(status(), "idle");
  // 意図なしでゲストがいるだけ（/liveを開いただけ）では登録しない
  reset(true);
  await tick();
  assert.equal(joinCalls, 0, "/liveを開いただけで登録された");
  console.log("PASS: Xログイン・/liveを開いただけでは観客登録されない");

  // 9) 連打：認証・同意記録・joinがそれぞれ1回
  reset(true);
  await Promise.all([press(), press(), press()]);
  assert.equal(authCalls, 1, "連打で匿名認証が複数回");
  await Promise.all([tick(), tick(), tick()]);
  assert.equal(joinCalls, 1, "連打でjoinが複数回");
  reset(false);
  await Promise.all([press(), press()]);
  await Promise.all([
    useConsentGateStore.getState().confirm(),
    useConsentGateStore.getState().confirm(),
    useConsentGateStore.getState().confirm(),
  ]);
  assert.equal(authCalls, 1, "同意連打で匿名認証が複数回");
  assert.equal(recordCalls, 1, "同意連打で同意記録が複数回");
  await Promise.all([tick(), tick()]);
  assert.equal(joinCalls, 1, "同意連打でjoinが複数回");
  console.log("PASS: 連打しても匿名認証・同意記録・join_liveはそれぞれ1回だけ");

  // 10) 参加済みならjoin_liveを呼ばない
  reset(true);
  await press();
  await tick(ctx({ alreadyParticipant: true }));
  assert.equal(joinCalls, 0, "参加済みなのにjoin_liveを呼んだ");

  // 11) 別ライブ・終了ライブ・離脱後は発火しない
  reset(true);
  await press();
  await tick(ctx({ live: { id: "live-1", phase: "scheduled" } })); // ライブ1に束縛して待機
  await tick(ctx({ live: { id: "live-2", phase: "answering" } }));
  assert.equal(joinCalls, 0, "別ライブで発火した");
  reset(true);
  await press();
  await tick(ctx({ live: { id: "live-1", phase: "closed" } }));
  assert.equal(joinCalls, 0, "終了ライブで発火した");
  reset(true);
  await press();
  useAudienceJoinIntentStore.getState().discard(); // ページ離脱
  await tick();
  assert.equal(joinCalls, 0, "ページ離脱後に発火した");
  console.log("PASS: 参加済み・別ライブ・終了ライブ・ページ離脱では観客登録されない");

  // 15) 参加失敗でもロック解除→手動再試行（次のpress→join）ができる
  reset(true);
  joinFails = true;
  await press();
  await tick();
  assert.equal(joinCalls, 1);
  assert.equal(status(), "idle", "失敗後に意図/ロックが残った");
  await tick();
  assert.equal(joinCalls, 1, "失敗後に自動で再試行し続けた");
  joinFails = false;
  await press();
  await tick();
  assert.equal(joinCalls, 2, "再試行が実行できない");
  console.log("PASS: 参加失敗後もロックが解除され、再試行できる");

  // ===== 修正1：同意記録に成功するまで観客登録しない =====
  // 同意RPC失敗：匿名認証1回・join_live0回・モーダル保持・端末の同意済みフラグなし。再試行は同じユーザーで記録だけ。
  reset(false);
  recordFails = true;
  await press();
  await useConsentGateStore.getState().confirm();
  assert.equal(authCalls, 1);
  assert.equal(recordCalls, 1);
  assert.equal(status(), "starting", "同意記録失敗で意図が成立した");
  assert.ok(useConsentGateStore.getState().pendingModal, "同意モーダルが閉じた");
  assert.match(useConsentGateStore.getState().errorReason ?? "", /同意の記録に失敗/);
  assert.equal(ls.getItem(CONSENT_ACK_STORAGE_KEY), null, "DB記録前に端末の同意済みフラグが付いた");
  await tick();
  assert.equal(joinCalls, 0, "同意記録失敗なのにjoin_liveを呼んだ");
  recordFails = false;
  await useConsentGateStore.getState().confirm();
  assert.equal(authCalls, 1, "再試行で新しい匿名アカウントを作った");
  assert.equal(recordCalls, 2, "再試行で同意記録が実行されていない");
  assert.equal(status(), "armed");
  assert.equal(useConsentGateStore.getState().pendingModal, null);
  assert.equal(ls.getItem(CONSENT_ACK_STORAGE_KEY), `${TERMS_VERSION}|${PRIVACY_VERSION}`, "記録成功後に同意済みフラグが付かない");
  await tick();
  await tick();
  assert.equal(joinCalls, 1, "再試行成功後にjoin_liveが1回でない");
  console.log("PASS: 同意記録に失敗した間はjoin_liveせず（認証1回）、再試行は同じユーザーで記録のみ、成功後に1回だけ観客登録");

  // 同意RPCが例外：失敗扱い・未処理エラーなし・再試行可能
  reset(false);
  recordThrows = true;
  await press();
  await useConsentGateStore.getState().confirm();
  assert.equal(status(), "starting");
  assert.equal(joinCalls, 0);
  recordThrows = false;
  await useConsentGateStore.getState().confirm();
  assert.equal(authCalls, 1);
  assert.equal(status(), "armed");

  // userIdを確定できない場合も成功扱いにしない（認証済みユーザーが確定してから同じユーザーで記録）
  reset(false);
  authResult = { ok: true, userId: null } as never;
  setUserOnAuth = false;
  await press();
  await useConsentGateStore.getState().confirm(); // 3秒待ってもuserId不明
  assert.equal(status(), "starting", "userId不明で意図が成立した");
  assert.equal(recordCalls, 0, "userId不明でRPCを呼んだ");
  assert.equal(joinCalls, 0);
  assert.equal(ls.getItem(CONSENT_ACK_STORAGE_KEY), null);
  useAuthStore.setState({ user: { id: G, is_anonymous: true } as never }); // 認証状態の反映が追いついた
  await useConsentGateStore.getState().confirm();
  assert.equal(authCalls, 1, "userId確定後の再試行で新しい匿名アカウントを作った");
  assert.equal(recordCalls, 1);
  assert.equal(status(), "armed");
  console.log("PASS: 同意RPCの例外・userId不明でも観客登録せず、再試行で同じユーザーの記録に成功する");

  // 同意済みの端末でも、記録に失敗したら観客登録せず、同意画面で再試行できる（新しい匿名アカウントなし）
  reset(true);
  recordFails = true;
  await press();
  assert.equal(status(), "starting");
  assert.equal(useConsentGateStore.getState().pendingModal?.kind, "guest");
  assert.ok(useConsentGateStore.getState().errorReason);
  await tick();
  assert.equal(joinCalls, 0);
  recordFails = false;
  await useConsentGateStore.getState().confirm();
  assert.equal(authCalls, 1);
  await tick();
  assert.equal(joinCalls, 1);
  // 記録失敗のままキャンセルすれば意図は破棄
  reset(true);
  recordFails = true;
  await press();
  useConsentGateStore.getState().cancel();
  assert.equal(status(), "idle");
  await tick();
  assert.equal(joinCalls, 0);
  console.log("PASS: 同意済み端末でも記録失敗時は観客登録せず、同意画面で再試行／キャンセルで破棄");

  // ===== 修正2：ボタンを押した時点のライブIDに固定 =====
  reset(true);
  pressLiveId = "live-A";
  await press();
  await tick(ctx({ live: { id: "live-B", phase: "answering" } })); // 認証中にライブBへ切り替わった
  assert.equal(joinCalls, 0, "ライブAで押した意図がライブBへ参加した");
  assert.equal(status(), "idle");
  reset(true);
  pressLiveId = "live-A";
  await press();
  await tick(ctx({ live: { id: "live-A", phase: "answering" } }));
  assert.equal(joinCalls, 1);
  // 押した時点でライブIDを取得できない：認証は完了しても自動参加意図は成立しない
  reset(true);
  pressLiveId = null;
  await press();
  assert.equal(authCalls, 1);
  assert.equal(status(), "idle", "ライブID不明で意図が成立した");
  await tick(ctx({ live: { id: "live-later", phase: "answering" } }));
  assert.equal(joinCalls, 0, "あとから開始したライブへ自動参加した");
  // 押した時点のライブが終了（現在のライブなし）
  reset(true);
  await press();
  await tick(ctx({ live: null }));
  assert.equal(joinCalls, 0);
  assert.equal(status(), "idle");
  console.log("PASS: 押した時点のライブIDに固定され、別ライブ・ID不明・終了では自動参加しない");

  // ===== 修正3：例外でも未処理エラー・ロックを残さない =====
  reset(true);
  authThrows = true;
  const thrown = await press(); // rejectしない
  assert.ok(thrown.pressed && !thrown.result.ok, "例外が失敗結果になっていない");
  assert.equal(status(), "idle", "認証例外後に意図が残った");
  await tick();
  assert.equal(joinCalls, 0);
  authThrows = false;
  await press(); // 再度押せる（ロックが残っていない）
  assert.equal(status(), "armed");
  await tick();
  assert.equal(joinCalls, 1);
  // 同意モーダル経由の認証例外：モーダルは保持し、日本語エラー、再試行可能
  reset(false);
  authThrows = true;
  await press();
  await useConsentGateStore.getState().confirm();
  assert.ok(useConsentGateStore.getState().errorReason, "日本語エラーが出ていない");
  assert.equal(status(), "starting");
  authThrows = false;
  await useConsentGateStore.getState().confirm();
  assert.equal(status(), "armed");
  // join_liveが例外：意図は終了しロック解除、手動の再試行で参加でき二重登録にならない
  reset(true);
  joinFails = true;
  await press();
  await tick();
  assert.equal(status(), "idle");
  joinFails = false;
  await press();
  await tick();
  assert.equal(joinCalls, 2);
  console.log("PASS: 認証・join_liveが例外でも未処理エラーなし・日本語エラー・ロック解除・再試行で正常参加");

  // ===== 競合：ライブID取得（非同期）の待機中に意図が無効になる =====
  const expectNothingHappened = (label: string) => {
    assert.equal(guestRequests, 0, `${label}: requestGuestStartが呼ばれた`);
    assert.equal(authCalls, 0, `${label}: 匿名認証が始まった`);
    assert.equal(recordCalls, 0, `${label}: 同意記録RPCが呼ばれた`);
    assert.equal(joinCalls, 0, `${label}: join_liveが呼ばれた`);
    assert.equal(status(), "idle", `${label}: 意図が残った`);
  };
  for (const acked of [true, false]) {
    // ページ離脱：ライブID取得を止めたまま離脱→取得完了
    reset(acked);
    let d = deferred<string | null>();
    let pending = pressWith(() => d.promise);
    assert.equal(status(), "starting");
    useAudienceJoinIntentStore.getState().discard(); // ページ離脱相当
    d.resolve("live-1");
    await pending;
    await tick();
    expectNothingHappened(`ページ離脱(acked=${acked})`);
    assert.equal(useConsentGateStore.getState().pendingModal, null, "離脱後に同意モーダルが開いた");

    // ライブID取得が離脱後に例外：未処理エラーなし・状態不変
    reset(acked);
    d = deferred<string | null>();
    pending = pressWith(() => d.promise);
    useAudienceJoinIntentStore.getState().discard();
    d.reject(new Error("late net error"));
    await pending; // rejectしない
    expectNothingHappened(`離脱後の取得例外(acked=${acked})`);
  }
  console.log("PASS: ライブID取得の待機中にページ離脱しても、ゲスト開始・認証・同意記録・join_liveは0回で意図はidle");

  // Xログイン（同意済み端末）：ライブID取得を止めたままXログイン→取得完了
  reset(true);
  {
    const d = deferred<string | null>();
    const pending = pressWith(() => d.promise);
    const xr = await useConsentGateStore.getState().requestXLogin();
    assert.deepEqual(xr, { ok: true });
    assert.equal(xLoginCalls, 1, "Xログインが1回実行されていない");
    assert.equal(status(), "idle", "Xログイン開始でゲスト意図が無効化されていない");
    d.resolve("live-1");
    await pending;
    await tick();
    expectNothingHappened("Xログイン(同意済み)");
    assert.equal(xLoginCalls, 1, "Xログインが複数回実行された");
  }
  // Xログイン（未同意端末）：Xログイン用モーダルを古いゲスト処理が消さない
  reset(false);
  {
    const d = deferred<string | null>();
    const pending = pressWith(() => d.promise);
    await useConsentGateStore.getState().requestXLogin();
    const xModal = useConsentGateStore.getState().pendingModal;
    assert.equal(xModal?.kind, "x-login");
    d.resolve("live-1");
    await pending;
    expectNothingHappened("Xログイン(未同意)");
    assert.equal(useConsentGateStore.getState().pendingModal, xModal, "古いゲスト処理がXログイン用モーダルを消した/置き換えた");
    assert.equal(useConsentGateStore.getState().errorReason, null);
    await useConsentGateStore.getState().confirm();
    assert.equal(xLoginCalls, 1, "Xログインが1回だけ実行されていない");
    assert.equal(authCalls, 0);
  }
  console.log("PASS: ライブID取得の待機中にXログインを始めると、ゲスト処理は一切進まず、Xログイン（とそのモーダル）だけが1回実行される");

  // 新しい意図（別の押下）を、古い処理の遅れた完了が変更しない
  reset(true);
  {
    const dA = deferred<string | null>();
    const pendingA = pressWith(() => dA.promise);
    useAudienceJoinIntentStore.getState().discard(); // A破棄（離脱→戻る）
    const pendingB = pressWith(async () => "live-1"); // 新しい意図B
    await pendingB;
    assert.equal(status(), "armed");
    assert.equal(guestRequests, 1);
    dA.resolve("live-9"); // Aの遅れた完了
    await pendingA;
    assert.equal(guestRequests, 1, "古い処理が2回目のゲスト開始をした");
    assert.equal(authCalls, 1);
    assert.equal((useAudienceJoinIntentStore.getState().state as { liveId: string }).liveId, "live-1", "古い処理が新しい意図のライブIDを書き換えた");
    await tick();
    assert.equal(joinCalls, 1);
  }
  console.log("PASS: 古い処理の遅れた完了は、新しい意図の状態を変更しない");

  // 認証・同意処理の実行中に無効になった場合：結果を反映せず、他のモーダルも消さない
  reset(true);
  {
    const pending = press(); // 同意済み：匿名認証が走る（5ms）
    await new Promise((r) => setTimeout(r, 1));
    useAudienceJoinIntentStore.getState().discard(); // 認証中にページ離脱
    useConsentGateStore.setState({ pendingModal: { kind: "x-login" } }); // 別のモーダルが開いている状態
    await pending;
    assert.equal(status(), "idle");
    assert.equal(useConsentGateStore.getState().pendingModal?.kind, "x-login", "古い完了が別のモーダルを消した");
    await tick();
    assert.equal(joinCalls, 0, "無効化後にjoin_liveが呼ばれた");
  }
  // ゲスト認証の実行中はXログインを開始しない／Xログイン処理中はゲスト認証を開始しない（ストア側で防ぐ）
  reset(true);
  {
    const pending = press();
    await new Promise((r) => setTimeout(r, 1));
    const xr = await useConsentGateStore.getState().requestXLogin();
    assert.equal(xr.ok, false);
    assert.match((xr as { reason?: string }).reason ?? "", /ゲスト参加の処理中/);
    assert.equal(xLoginCalls, 0, "ゲスト認証中にXログインが開始された");
    await pending;
  }
  reset(true);
  useAuthStore.setState({ xSigningIn: true });
  {
    const r = await press();
    assert.equal(authCalls, 0, "Xログイン処理中に匿名認証が始まった");
    assert.ok(r.pressed && !r.result.ok);
    assert.equal(status(), "idle");
  }
  useAuthStore.setState({ xSigningIn: false });
  console.log("PASS: 認証中の無効化は結果・他のモーダルに影響せず、ゲスト認証とXログインはストア側で互いに排他される");

  // 正常系：ライブID取得後も同じtokenが有効なら従来どおり同意・認証へ進み、join_liveは1回
  reset(false);
  {
    const d = deferred<string | null>();
    const pending = pressWith(() => d.promise);
    d.resolve("live-1");
    await pending;
    assert.equal(useConsentGateStore.getState().pendingModal?.kind, "guest");
    await useConsentGateStore.getState().confirm();
    await Promise.all([tick(), tick()]);
    assert.equal(authCalls, 1);
    assert.equal(recordCalls, 1);
    assert.equal(joinCalls, 1);
  }
  console.log("PASS: ライブID取得後も同じtokenが有効なら、従来どおり同意・匿名認証を経てjoin_liveが1回だけ呼ばれる");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
