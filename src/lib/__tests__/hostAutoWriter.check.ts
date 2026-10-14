// 2026-10-15（2A.2b-W1）：司会の自動進行writerを同一originで1タブだけに絞る制御
// (src/lib/hostAutoWriter.ts) の検証。Web Locks・visibility・page lifecycle・timerは
// すべて偽物を注入する（fakeWebLocks.ts）。ストア本体を使った経路別の検証は
// store/useLiveHostStoreAutoWriter.check.ts。
import assert from "node:assert/strict";

import {
  attachHostProgressSession,
  createHostAutoWriter,
  HOST_AUTO_WRITER_LOCK_NAME,
  hostAutoWriterStatusLabel,
  hostIdentityMatches,
  type HostAutoWriter,
  type HostAutoWriterStatus,
} from "../hostAutoWriter";
import { deferred, FakeClock, FakeEventTarget, FakeWebLocks, flush } from "./fakeWebLocks";

// ---- 1タブぶんの偽環境 ----
interface Tab {
  id: string;
  doc: FakeEventTarget;
  win: FakeEventTarget;
  writer: HostAutoWriter;
  alive: boolean;
  autoTicket: number | null;
  isValid: (t: number) => boolean;
  autoTimerStarts: number;
  status: HostAutoWriterStatus;
  catchUpCalls: number;
  catchUpImpl: () => Promise<boolean>;
  verifyImpl: () => Promise<boolean>;
  writesInFlight: number;
  idleWaiters: (() => void)[];
  readStarts: number;
  stopAllCalls: number;
  detach: (() => void) | null;
}

let rpcLog: string[] = [];
let clock = new FakeClock();
let locks = new FakeWebLocks();
let tabs: Tab[] = [];

// assert.deepEqual(rpcLog, []) の型絞り込みの影響を受けないよう、送信記録は関数経由で追加する。
function recordRpc(tabId: string) {
  rpcLog.push(tabId);
}

function reset() {
  rpcLog = [];
  clock = new FakeClock();
  locks = new FakeWebLocks();
  tabs = [];
}

function makeTab(id: string, opts: { locks?: "fake" | "none"; visible?: boolean } = {}): Tab {
  const tab = {
    id,
    doc: new FakeEventTarget(),
    win: new FakeEventTarget(),
    alive: true,
    autoTicket: null,
    isValid: () => false,
    autoTimerStarts: 0,
    status: "inactive",
    catchUpCalls: 0,
    catchUpImpl: () => Promise.resolve(true),
    verifyImpl: () => Promise.resolve(true),
    writesInFlight: 0,
    idleWaiters: [],
    readStarts: 0,
    stopAllCalls: 0,
    detach: null,
  } as unknown as Tab;
  tab.doc.visibilityState = opts.visible === false ? "hidden" : "visible";
  tab.writer = createHostAutoWriter({
    locks: opts.locks === "none" ? null : locks.forTab(id),
    isVisible: () => tab.doc.visibilityState === "visible",
    verifyHost: () => tab.verifyImpl(),
    catchUp: () => {
      tab.catchUpCalls += 1;
      return tab.catchUpImpl();
    },
    startAutoTimer: (ticket, isValid) => {
      if (tab.autoTicket === ticket) return;
      tab.autoTicket = ticket;
      tab.isValid = isValid;
      tab.autoTimerStarts += 1;
    },
    stopAutoTimer: () => {
      tab.autoTicket = null;
    },
    waitWritesIdle: () =>
      tab.writesInFlight === 0
        ? Promise.resolve()
        : new Promise<void>((r) => {
            tab.idleWaiters.push(r);
          }),
    onStatus: (s) => {
      tab.status = s;
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  tabs.push(tab);
  return tab;
}

function attach(tab: Tab) {
  tab.detach = attachHostProgressSession({
    targets: { doc: tab.doc, win: tab.win },
    writer: tab.writer,
    startRead: () => {
      tab.readStarts += 1;
    },
    stopAll: () => {
      tab.stopAllCalls += 1;
    },
  });
}

// 自動timerが動いていて、そのticketが今も有効なタブ＝writer。
function writers(): string[] {
  return tabs.filter((t) => t.alive && t.autoTicket !== null && t.isValid(t.autoTicket)).map((t) => t.id);
}

function assertAtMostOneWriter(ctx: string) {
  const w = writers();
  assert.ok(w.length <= 1, `${ctx}: writerが2件以上: ${w.join(",")}`);
}

// 自動進行tickの模擬：開始時ticketを持ち、読み取り(pause)の後、RPC直前に再照合する。
async function tick(tab: Tab, pause?: Promise<void>) {
  if (!tab.alive || tab.autoTicket === null) return;
  const ticket = tab.autoTicket;
  if (!tab.isValid(ticket)) return;
  if (pause) await pause;
  // タブが閉じられていればJS自体が止まっている（alive=false）。RPC直前の再照合。
  if (!tab.alive || !tab.isValid(ticket)) return;
  tab.writesInFlight += 1;
  rpcLog.push(tab.id);
  tab.writesInFlight -= 1;
}

function hide(tab: Tab) {
  tab.doc.visibilityState = "hidden";
  tab.doc.dispatch("visibilitychange");
}

function show(tab: Tab) {
  tab.doc.visibilityState = "visible";
  tab.doc.dispatch("visibilitychange");
}

async function main() {
  // ===== 単一leader =====
  {
    reset();
    const a = makeTab("A");
    const b = makeTab("B");
    attach(a);
    attach(b); // 同時に要求
    await flush();
    clock.advance(1_000); // 待機中の表示確認（定期）
    await flush();
    assert.deepEqual(writers().length, 1, "leaderが1件でない");
    const leader = writers()[0] === "A" ? a : b;
    const follower = leader === a ? b : a;
    assert.equal(leader.autoTimerStarts, 1, "leaderの自動timerが1本でない");
    assert.equal(follower.autoTimerStarts, 0, "非leaderで自動timerが作られた");
    assert.equal(leader.status, "leader");
    assert.equal(follower.status, "standby", "非leaderが『別タブが担当中』になっていない");
    assert.equal(follower.readStarts, 1, "非leaderの読み取り(init)が開始されていない");
    await tick(a);
    await tick(b);
    assert.deepEqual(rpcLog, [leader.id], "自動進行RPCが1回でない");
    // 同じタブでinit・focus・pageshow・onlineが重なってもtimerは1本
    leader.win.dispatch("focus");
    leader.win.dispatch("pageshow");
    leader.win.dispatch("online");
    leader.doc.dispatch("visibilitychange");
    follower.win.dispatch("focus");
    follower.win.dispatch("pageshow");
    follower.win.dispatch("online");
    await flush();
    assert.equal(leader.autoTimerStarts, 1, "復帰イベントの重複で自動timerが増えた");
    assert.equal(follower.autoTimerStarts, 0);
    assert.ok(follower.readStarts >= 4, "非leaderでも復帰イベントで読み取り再確認(init)が行われていない");
    assert.equal(locks.pendingCount(follower.id), 1, "非leaderのlock待機要求が重複した");
    assert.equal(locks.maxConcurrentHolders, 1, "exclusive lockが同時に複数付与された");
    console.log("PASS: 単一leader（同時開始でもleader1件・自動timer1本・RPC1回、非leaderは読み取り継続、復帰イベント重複でも1本）");
  }

  // ===== タブの増減 =====
  {
    reset();
    const a = makeTab("A");
    attach(a);
    await flush();
    assert.deepEqual(writers(), ["A"]);
    const b = makeTab("B");
    const c = makeTab("C");
    attach(b);
    attach(c);
    await flush();
    assert.deepEqual(writers(), ["A"], "B・Cを開いたらwriterがAでなくなった");
    // 非leaderタブを閉じてもAに影響なし
    c.alive = false;
    locks.closeTab("C");
    await flush();
    assert.deepEqual(writers(), ["A"], "非leaderを閉じたらAが影響を受けた");
    // Aの古い非同期処理（読み取り待ち）を用意してからAを閉じる
    const slow = deferred();
    const aTick = tick(a, slow.promise);
    a.alive = false;
    locks.closeTab("A");
    await flush();
    assert.deepEqual(writers(), ["B"], "leader A を閉じた後、Bが1件だけ引き継いでいない");
    assert.equal(b.catchUpCalls, 1, "新leaderが最新状態を取り直していない");
    slow.resolve();
    await aTick;
    // closeTab はJS実行停止の模擬なので、Aのtick再開自体をalive=falseで止める（tick内で確認）
    assert.deepEqual(rpcLog, [], "閉じたAの古い処理がRPCを送った");
    await tick(b);
    assert.deepEqual(rpcLog, ["B"]);
    console.log("PASS: タブの増減（追加・非leader閉鎖で影響なし、leader閉鎖でBのみ引き継ぎ、最新状態取得後に開始）");

    // reload：Bを閉じて同じタブを開き直す（新しいwriter）→ Cは閉じ済みなので新タブだけ
    b.alive = false;
    locks.closeTab("B");
    const b2 = makeTab("B-reload");
    attach(b2);
    await flush();
    assert.deepEqual(writers(), ["B-reload"], "reload後のwriterが1件でない");
    console.log("PASS: reload後もwriterは最大1件");
  }

  // ===== leaderが生きたままの古いtick（leadership喪失競合）=====
  {
    reset();
    const a = makeTab("A");
    const b = makeTab("B");
    attach(a);
    await flush();
    attach(b);
    await flush();
    assert.deepEqual(writers(), ["A"]);
    const slow = deferred();
    const aTick = tick(a, slow.promise); // 1. leaderとしてtick開始 2. 読み取り途中で停止
    hide(a); // 3. leadershipを別タブへ
    await flush();
    assert.deepEqual(writers(), ["B"], "hidden化でBへ移っていない");
    slow.resolve(); // 4. 古い読み取りを完了
    await aTick;
    assert.deepEqual(rpcLog, [], "5. 旧leaderのRPCが0件でない");
    await tick(b);
    assert.deepEqual(rpcLog, ["B"], "6. 新leaderだけが1回送っていない");
    assert.equal(a.autoTicket, null, "hidden化した旧leaderの自動timerが止まっていない");
    console.log("PASS: leadership喪失競合（旧leaderの遅延処理はRPC 0件、新leaderだけ1回）");

    // 同じタブがleadershipを失って再取得した場合：旧世代のticketを持つtickは送らない
    rpcLog = [];
    const slow2 = deferred();
    const bTick = tick(b, slow2.promise); // Bの世代1のtickが読み取り途中
    const bOldTicket = b.autoTicket!;
    hide(b);
    await flush();
    show(a);
    await flush();
    assert.deepEqual(writers(), ["A"]);
    hide(a);
    show(b);
    await flush();
    assert.deepEqual(writers(), ["B"], "Bが再取得していない");
    assert.notEqual(b.autoTicket, bOldTicket, "再取得でticketの世代が変わっていない");
    assert.equal(b.isValid(bOldTicket), false, "旧世代のticketが有効扱いになっている");
    slow2.resolve();
    await bTick;
    assert.deepEqual(rpcLog, [], "再取得後に旧世代のtickがRPCを送った");
    console.log("PASS: 同じタブが再取得しても、旧世代ticketのtickはRPCを送らない");
  }

  // ===== visibility =====
  {
    reset();
    const a = makeTab("A");
    const b = makeTab("B");
    const c = makeTab("C");
    attach(a);
    await flush();
    attach(b);
    attach(c);
    await flush();
    hide(a);
    await flush();
    assert.equal(a.autoTicket, null, "hiddenで自動timerが止まっていない");
    assert.equal(writers().length, 1, "visibleな別タブが1件だけ引き継いでいない");
    const newLeader = writers()[0];
    assert.notEqual(newLeader, "A");
    show(a);
    await flush();
    assert.deepEqual(writers(), [newLeader], "再visible化したAが現在のleaderを奪った");
    assert.notEqual(a.status, "leader");
    // 全タブhidden
    hide(a);
    hide(b);
    hide(c);
    await flush();
    assert.deepEqual(writers(), [], "全タブhiddenなのにwriterがいる");
    for (const t of [a, b, c]) await tick(t);
    assert.deepEqual(rpcLog, [], "全タブhidden中に自動進行RPCが送られた");
    assert.equal(locks.pendingCount(), 0, "hiddenタブがlockを待機している");
    // 1タブをvisibleへ戻す → 最新状態を取り直してから再開
    const before = b.catchUpCalls;
    const gate = deferred<boolean>();
    b.catchUpImpl = () => gate.promise;
    show(b);
    await flush();
    assert.equal(b.catchUpCalls, before + 1, "visible復帰で最新状態の取得が行われていない");
    assert.equal(b.autoTicket, null, "最新状態の取得前に自動timerが動いた");
    assert.equal(b.status, "handoff", "取得中は『引き継ぎ中』表示でない");
    gate.resolve(true);
    await flush();
    assert.deepEqual(writers(), ["B"]);
    assert.equal(b.status, "leader");
    console.log("PASS: visibility（hiddenで停止・解放、別タブ1件が引き継ぎ、復帰しても奪わない、全hiddenでRPC 0、復帰時は最新取得後に再開）");
  }

  // ===== bfcache（pagehide → pageshow）=====
  {
    reset();
    const a = makeTab("A");
    const b = makeTab("B");
    attach(a);
    await flush();
    attach(b);
    await flush();
    a.win.dispatch("pagehide");
    await flush();
    assert.deepEqual(writers(), ["B"], "pagehideで解放・引き継ぎされていない");
    a.win.dispatch("pageshow");
    await flush();
    assert.deepEqual(writers(), ["B"], "bfcache復帰でwriterが2件になった／奪った");
    console.log("PASS: bfcache復帰でもwriterは最大1件");
  }

  // ===== 最新状態の取得失敗 =====
  {
    reset();
    const a = makeTab("A");
    a.catchUpImpl = () => Promise.resolve(false);
    attach(a);
    await flush();
    assert.equal(a.autoTicket, null, "最新状態を取得できないのに自動進行を始めた");
    assert.equal(a.status, "handoff");
    a.catchUpImpl = () => Promise.reject(new Error("network"));
    clock.advance(2_000);
    await flush();
    assert.equal(a.autoTicket, null, "取得例外でも自動進行を始めた");
    a.catchUpImpl = () => Promise.resolve(true);
    clock.advance(2_000);
    await flush();
    assert.deepEqual(writers(), ["A"], "再試行で取得できたのに開始しない");
    console.log("PASS: 新leaderは最新状態を確認できるまで自動進行を始めない（再試行で回復）");
  }

  // ===== 認証・権限 =====
  {
    // logout：effect cleanup（detach）でlock解放・timer停止・自動RPC 0件
    reset();
    const a = makeTab("A");
    const b = makeTab("B");
    attach(a);
    await flush();
    attach(b);
    await flush();
    const slow = deferred();
    const aTick = tick(a, slow.promise);
    a.detach!(); // ログアウト・isHost剥奪・unmountはいずれもこのcleanup
    await flush();
    assert.equal(a.autoTicket, null);
    assert.equal(a.stopAllCalls, 1, "cleanupで読み取り側(stopHostProgress)を止めていない");
    assert.equal(a.doc.listenerCount() + a.win.listenerCount(), 0, "listenerが残っている");
    slow.resolve();
    await aTick;
    assert.deepEqual(rpcLog, [], "logout後に古い処理がRPCを送った");
    assert.deepEqual(writers(), ["B"]);
    a.win.dispatch("focus");
    a.doc.dispatch("visibilitychange");
    await flush();
    assert.equal(locks.pendingCount("A"), 0, "停止後のイベントでlockを再要求した");
    console.log("PASS: logout/isHost剥奪/unmount（cleanup）でlock解放・timer停止・listener除去・古い処理RPC 0件");

    // leader判定中に認証確認が失敗 → fail-closed
    reset();
    const c = makeTab("C");
    c.verifyImpl = () => Promise.resolve(false);
    attach(c);
    await flush();
    assert.deepEqual(writers(), [], "認証確認に失敗したのにwriterになった");
    assert.equal(c.catchUpCalls, 0, "認証確認に失敗したのに取得へ進んだ");
    assert.equal(locks.holderCount(), 0, "認証確認に失敗したのにlockを握り続けている");
    c.verifyImpl = () => Promise.reject(new Error("auth"));
    c.win.dispatch("focus");
    await flush();
    assert.deepEqual(writers(), [], "認証確認の例外でwriterになった");
    console.log("PASS: leader判定中の認証確認失敗・例外はfail-closed（自動進行しない・lockを手放す）");

    // 確認待ちの間に停止（別ユーザーへ切替）→ 古い処理は反映しない
    reset();
    const d = makeTab("D");
    const verifyGate = deferred<boolean>();
    d.verifyImpl = () => verifyGate.promise;
    attach(d);
    await flush();
    d.detach!();
    verifyGate.resolve(true);
    await flush();
    assert.equal(d.autoTimerStarts, 0, "停止後に古い認証確認の結果で自動timerを開始した");
    assert.equal(d.catchUpCalls, 0);
    console.log("PASS: 利用者切替（停止）後に古い確認結果が完了しても自動進行を始めない");

    // isHostでない利用者
    assert.equal(hostIdentityMatches("u1", { authUserId: "u1", profileId: "u1", isHost: false }), false);
    assert.equal(hostIdentityMatches("u1", { authUserId: "u2", profileId: "u2", isHost: true }), false);
    assert.equal(hostIdentityMatches("u1", { authUserId: null, profileId: null, isHost: false }), false);
    assert.equal(hostIdentityMatches("u1", { authUserId: "u1", profileId: "u2", isHost: true }), false);
    assert.equal(hostIdentityMatches("", { authUserId: "", profileId: "", isHost: true }), false);
    assert.equal(hostIdentityMatches("u1", { authUserId: "u1", profileId: "u1", isHost: true }), true);
    console.log("PASS: 認証確認（非host・別ユーザー・ログアウト・不一致はfalse）");
  }

  // ===== Web Locks非対応 =====
  {
    reset();
    const errors: unknown[] = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...a: unknown[]) => errors.push(a);
    console.warn = (...a: unknown[]) => errors.push(a);
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const u = makeTab("U", { locks: "none" });
      attach(u);
      u.win.dispatch("focus");
      u.doc.dispatch("visibilitychange");
      u.win.dispatch("pageshow");
      await flush();
      assert.equal(u.autoTimerStarts, 0, "非対応なのに自動timerが作られた");
      await tick(u);
      assert.deepEqual(rpcLog, [], "非対応なのに自動進行RPCが送られた");
      assert.equal(u.status, "unsupported");
      assert.ok(u.readStarts >= 1, "非対応で読み取り側まで止まった");
      const label = hostAutoWriterStatusLabel(u.status);
      assert.ok(label && label.includes("このブラウザでは安全な自動進行を利用できません"), "固定の案内文言でない");
      u.detach!();
      assert.equal(u.status, "unsupported");

      // locks.requestが同期例外（安全でないコンテキスト等）でもfail-closed
      const throwing = createHostAutoWriter({
        locks: {
          request: () => {
            throw new Error("SecurityError");
          },
        },
        isVisible: () => true,
        verifyHost: () => Promise.resolve(true),
        catchUp: () => Promise.resolve(true),
        startAutoTimer: () => {
          throw new Error("must not start");
        },
        stopAutoTimer: () => {},
        waitWritesIdle: () => Promise.resolve(),
        onStatus: () => {},
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      });
      throwing.start();
      throwing.resume();
      await flush();
      assert.equal(throwing.status(), "unsupported");
      await flush();
    } finally {
      console.error = origError;
      console.warn = origWarn;
      process.off("unhandledRejection", onUnhandled);
    }
    assert.equal(errors.length, 0, "非対応時にconsole出力があった");
    assert.equal(unhandled, 0, "未処理Promiseがあった");
    console.log("PASS: Web Locks非対応（自動timer 0・RPC 0・読み取り継続・固定案内・console/未処理Promise 0）");
  }

  // ===== stopと後片付け =====
  {
    reset();
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    process.on("unhandledRejection", onUnhandled);
    const a = makeTab("A");
    const b = makeTab("B");
    attach(a);
    await flush();
    attach(b);
    await flush();
    assert.equal(locks.pendingCount("B"), 1);
    b.detach!(); // 待機中のlock要求をabort
    await flush();
    assert.equal(locks.pendingCount("B"), 0, "待機中のlock要求がabortされていない");
    assert.equal(b.doc.listenerCount() + b.win.listenerCount(), 0);
    a.detach!();
    await flush();
    assert.equal(locks.holderCount(), 0, "停止後もlockが残っている");
    assert.equal(clock.pendingCount(), 0, "停止後も予約(timer)が残っている");
    assert.deepEqual(writers(), []);
    process.off("unhandledRejection", onUnhandled);
    assert.equal(unhandled, 0, "abortで未処理Promiseが出た");
    console.log("PASS: stop（待機要求abort・lock解放・listener/予約0・未処理Promise 0）");

    // stop後に古いlock callbackが届いても自動進行しない（abortを無視する実装でも安全）
    reset();
    let captured: ((lock: unknown) => Promise<void>) | null = null;
    let lateStarts = 0;
    const late = createHostAutoWriter({
      locks: {
        request: (_name, _opts, cb) => {
          captured = cb;
          return new Promise(() => {});
        },
      },
      isVisible: () => true,
      verifyHost: () => Promise.resolve(true),
      catchUp: () => Promise.resolve(true),
      startAutoTimer: () => {
        lateStarts += 1;
      },
      stopAutoTimer: () => {},
      waitWritesIdle: () => Promise.resolve(),
      onStatus: () => {},
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    late.start();
    late.stop();
    // captured はコールバック内で代入されるため、TSの制御フロー解析では null のままに見える。
    const lateCallback = captured as ((lock: unknown) => Promise<void>) | null;
    assert.ok(lateCallback, "lock要求が行われていない");
    await lateCallback({});
    await flush();
    assert.equal(lateStarts, 0, "停止後のlock callbackで自動進行を始めた");
    assert.equal(late.isValid(1), false);
    console.log("PASS: stop後の古いlock callbackでは自動進行しない");

    // Strict Mode相当：mount→cleanup→mount（同じタブで2つ目のwriter）
    reset();
    const s1 = makeTab("S");
    attach(s1);
    s1.detach!();
    const s2 = makeTab("S");
    attach(s2);
    await flush();
    assertAtMostOneWriter("StrictMode");
    assert.equal(s1.autoTimerStarts, 0, "cleanup済みのwriterが自動timerを開始した");
    assert.deepEqual(writers().length, 1);
    console.log("PASS: Strict Mode相当（mount→cleanup→mount）でもwriterは最大1件");
  }

  // ===== handoff中にwriterが2件にならない：送信済みの自動書き込みが決着するまでlockを返さない =====
  // 交代のきっかけ（hidden・pagehide・logout・isHost剥奪・unmount）× 決着の仕方（成功・reject）。
  // 10秒を大きく超えて未決着でも lock は旧タブが保持し続け、決着後にだけ次のタブが引き継ぐ。
  {
    const errors: unknown[] = [];
    const origError = console.error;
    const origWarn = console.warn;
    const origLog = console.log;
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    const triggers: [string, (t: Tab) => void][] = [
      ["hidden", (t) => hide(t)],
      ["pagehide", (t) => t.win.dispatch("pagehide")],
      [
        "logout",
        (t) => {
          t.verifyImpl = () => Promise.resolve(false);
          t.detach!();
        },
      ],
      [
        "isHost剥奪",
        (t) => {
          t.verifyImpl = () => Promise.resolve(false);
          t.detach!();
        },
      ],
      ["unmount", (t) => t.detach!()],
    ];
    const passed: string[] = [];
    console.error = (...x: unknown[]) => errors.push(x);
    console.warn = (...x: unknown[]) => errors.push(x);
    process.on("unhandledRejection", onUnhandled);
    try {
      for (const [triggerLabel, trigger] of triggers) {
        for (const outcome of ["成功", "reject"] as const) {
          const ctx = `${triggerLabel}/${outcome}`;
          reset();
          const a = makeTab("A");
          attach(a);
          await flush();
          const b = makeTab("B");
          attach(b);
          await flush();
          clock.advance(1_000);
          await flush();
          assert.deepEqual(writers(), ["A"], `${ctx}: 前提のleaderがAでない`);
          assert.equal(b.status, "standby", `${ctx}: Bが待機していない`);

          // 1. Aが自動書き込みを送信し、物理Promiseを未決着にする
          const physical = deferred<void>();
          let rejectPhysical!: (e: unknown) => void;
          const physicalPromise = new Promise<void>((resolve, reject) => {
            physical.promise.then(resolve);
            rejectPhysical = reject;
          });
          a.writesInFlight += 1;
          recordRpc("A");
          const settle = () => {
            a.writesInFlight -= 1;
            if (a.writesInFlight === 0) for (const r of a.idleWaiters.splice(0)) r();
          };
          physicalPromise.then(settle, settle);

          // 3. Aを交代させる（ticketと自動timerを無効化）
          trigger(a);
          await flush();
          assert.equal(a.autoTicket, null, `${ctx}: Aの自動timerが止まっていない`);
          const bCatchUps = b.catchUpCalls;

          // 4〜5. 偽タイマーを10秒より大幅に長く進めても、lockはAのまま・writer 0件・B開始なし・RPC 1本
          for (let i = 0; i < 6; i++) {
            clock.advance(60_000);
            await flush();
            await tick(a);
            await tick(b);
            assert.equal(locks.holderTab(), "A", `${ctx}: 未決着なのにAがlockを返した（${(i + 1) * 60}秒後）`);
            assert.deepEqual(writers(), [], `${ctx}: 未決着なのにwriterがいる`);
            assert.equal(b.autoTimerStarts, 0, `${ctx}: 未決着なのにBが自動進行を開始した`);
            assert.equal(b.catchUpCalls, bCatchUps, `${ctx}: 未決着なのにBが引き継ぎ処理を始めた`);
            assert.deepEqual(rpcLog, ["A"], `${ctx}: 自動書き込みRPCが1本から増えた`);
          }

          // 6. Aの物理Promiseを決着させる
          if (outcome === "成功") physical.resolve();
          else rejectPhysical(new Error("network"));
          await flush();

          // 7〜8. その後にだけBがlockを取得し、最新状態を1回取得してからwriterになる
          assert.equal(locks.holderTab(), "B", `${ctx}: 決着後にBがlockを取得していない`);
          assert.equal(b.catchUpCalls, bCatchUps + 1, `${ctx}: Bが最新状態をちょうど1回取得していない`);
          assert.deepEqual(writers(), ["B"], `${ctx}: 決着後にBがwriterになっていない`);

          // 9. Bの新しい自動書き込みが、その後にちょうど1回だけ送られる（旧Aからは送られない）
          await tick(a);
          await tick(b);
          assert.deepEqual(rpcLog, ["A", "B"], `${ctx}: 決着後の送信がBから1回だけでない`);

          // 12. 最終停止後、listener・予約タイマー・lock待機要求が残らない
          if (a.detach) a.detach();
          b.detach!();
          await flush();
          for (const t of [a, b]) {
            assert.equal(t.doc.listenerCount() + t.win.listenerCount(), 0, `${ctx}: listenerが残っている`);
          }
          assert.equal(clock.pendingCount(), 0, `${ctx}: 予約タイマーが残っている`);
          assert.equal(locks.pendingCount(), 0, `${ctx}: lock待機要求が残っている`);
          assert.equal(locks.holderCount(), 0, `${ctx}: lockが残っている`);
          passed.push(ctx);
        }
      }

      // 永久に決着しない場合：lockを保持し続け、他タブは引き継がない（多重送信の防止を優先）
      reset();
      const a = makeTab("A");
      attach(a);
      await flush();
      const b = makeTab("B");
      attach(b);
      await flush();
      a.writesInFlight = 1; // 決着しない
      hide(a);
      await flush();
      clock.advance(24 * 60 * 60 * 1_000);
      await flush();
      assert.equal(locks.holderTab(), "A", "永久未決着でlockを返した");
      assert.deepEqual(writers(), [], "永久未決着なのにwriterがいる");
      assert.equal(b.autoTimerStarts, 0);
      passed.push("永久未決着（24時間）");
    } finally {
      console.error = origError;
      console.warn = origWarn;
      console.log = origLog;
    }
    await flush();
    process.off("unhandledRejection", onUnhandled);
    assert.equal(errors.length, 0, `console出力があった: ${JSON.stringify(errors)}`);
    assert.equal(unhandled, 0, "未処理Promiseがあった");
    console.log(
      `PASS: 未決着の自動書き込みがある間はlockを保持（10秒を大きく超えても返さない）、決着後にだけ次タブが最新取得→1回送信: ${passed.join("・")}`,
    );
  }

  // ===== 表示 =====
  {
    assert.equal(hostAutoWriterStatusLabel("leader"), "このタブが自動進行を担当中");
    assert.equal(hostAutoWriterStatusLabel("standby"), "別タブが自動進行を担当中");
    assert.equal(hostAutoWriterStatusLabel("handoff"), "自動進行の引き継ぎ中");
    assert.equal(hostAutoWriterStatusLabel("inactive"), null);
    for (const s of ["leader", "standby", "handoff", "unsupported"] as const) {
      const label = hostAutoWriterStatusLabel(s)!;
      assert.ok(!label.includes(HOST_AUTO_WRITER_LOCK_NAME), "表示にlock名が含まれる");
    }
    assert.ok(!/[0-9a-f]{8}-/.test(HOST_AUTO_WRITER_LOCK_NAME), "lock名に識別子が含まれる");
    console.log("PASS: 表示は固定文言のみ（lock名・識別子を含まない）");
  }

  console.log("ALL HOST_AUTO_WRITER CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
