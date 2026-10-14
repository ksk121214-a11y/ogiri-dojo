// 司会の自動進行(advanceIfDue)を「同一originで1タブだけ」に絞るための単一writer制御。
//
// 【背景（2026-10-15、フェーズ2A.2b-W1）】HostProgressControllerはRootLayoutに常駐するため、
// 管理者が複数タブを開くとタブごとに自動進行のtickが動き、同じ自動進行RPCをタブの数だけ
// 送っていた（initInFlight/tickTimerは同じJS実行環境の中でしか重複を防げない）。DB側の
// 冪等性は最後の防壁として残すが、「DBが二重更新しないから複数タブで送ってよい」とはしない。
//
// 【方式】Web Locks API の exclusive lock を取得したタブだけを自動進行writerにする。
// - lock名はアプリ固定（利用者ID・ライブID等は含めない）。
// - visibleなタブだけがlockを要求し、hidden・pagehide・停止（logout/isHost剥奪/unmount）で解放する。
// - lock取得のたびに世代(ticket)を発行する。tickは開始時のticketを持ち回り、各自動進行の
//   DB書き込み直前に isValid(ticket) を再確認する（tick開始時の1回だけの確認にしない）。
// - 解放時はticketを「先に」無効化して自動timerを止め（新しい自動書き込みは始まらない）、
//   既に送信済みの自動書き込みの物理Promiseが全て決着（成功・失敗・例外のいずれも）するまで
//   lockを保持し続け、決着後にだけ返す。決着しなければlockも返さない（その間は自動進行が
//   止まるが、別タブとの多重送信を防ぐことを優先する。handoff中のwriter 0件は許容、2件は禁止）。
// - 新leaderは最新状態を取り直し(catchUp)てから自動進行timerを開始する。
// - Web Locks非対応なら自動進行writerは起動しない（fail-closed。localStorage等での
//   代替排他は行わない）。読み取り・表示・手動操作はこの制御の対象外。
//
// DOM・Supabase・ストアには依存せず、全て注入する（src/lib/__tests__で偽物に差し替えて検証する）。

// lock名：アプリ固定のnamespace。利用者・ライブ・タブを識別できる値は含めない。
export const HOST_AUTO_WRITER_LOCK_NAME = "bakusho-stadium:host-auto-progress-writer:v1";

// 新leaderの最新状態取得に失敗した場合の再試行間隔。
const CATCH_UP_RETRY_MS = 2_000;
// lock待機中に「別タブが担当中」か「引き継ぎ中」かを確認し直す間隔（表示専用）。
const STATUS_PROBE_MS = 1_000;

// 画面表示用の状態（ID・lock名・タブ識別子は含めない）。
// - inactive：自動進行の対象外（非表示中・司会でない・停止済み）
// - leader：このタブが自動進行を担当中
// - standby：別タブが自動進行を担当中
// - handoff：自動進行の引き継ぎ中（lock取得待ち・最新状態の取得中）
// - unsupported：このブラウザでは安全な自動進行を利用できない
export type HostAutoWriterStatus = "inactive" | "leader" | "standby" | "handoff" | "unsupported";

// 管理画面に出す固定文言（ID・lock名・タブ識別子・エラー本文は含めない）。
export function hostAutoWriterStatusLabel(status: HostAutoWriterStatus): string | null {
  switch (status) {
    case "leader":
      return "このタブが自動進行を担当中";
    case "standby":
      return "別タブが自動進行を担当中";
    case "handoff":
      return "自動進行の引き継ぎ中";
    case "unsupported":
      return "このブラウザでは安全な自動進行を利用できません。最新のChrome・Edge・Safari・Firefoxで開いてください（手動の司会操作は利用できます）。";
    default:
      return null;
  }
}

// Web Locks API（navigator.locks）のうち、ここで使う最小限の形。
export interface LockManagerLike {
  request(
    name: string,
    options: { mode: "exclusive"; signal: AbortSignal },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
  query?: () => Promise<{ held?: { name?: string }[] }>;
}

export type TimerHandle = unknown;

export interface HostAutoWriterDeps {
  locks: LockManagerLike | null;
  lockName?: string;
  isVisible: () => boolean;
  // lock取得直後の認証・権限の再確認。false・例外はfail-closed（自動進行しない）。
  verifyHost: () => Promise<boolean>;
  // 新leaderが自動進行を始める前の最新状態の取得。trueのときだけ開始する。
  catchUp: () => Promise<boolean>;
  startAutoTimer: (ticket: number, isValid: (ticket: number) => boolean) => void;
  stopAutoTimer: () => void;
  // 送信済みの自動書き込みの物理Promiseが全て決着したら解決する（時間で打ち切らない）。
  waitWritesIdle: () => Promise<void>;
  onStatus: (status: HostAutoWriterStatus) => void;
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
  catchUpRetryMs?: number;
}

export interface HostAutoWriter {
  start: () => void;
  stop: () => void;
  // visible・focus・pageshow・online：visibleならlock取得を（重複なく）試みる。
  resume: () => void;
  // hidden・pagehide：自動進行を止めてlockを解放する。
  suspend: () => void;
  isValid: (ticket: number) => boolean;
  status: () => HostAutoWriterStatus;
}

interface PendingRequest {
  controller: AbortController;
  probeTimer: TimerHandle | null;
}

interface HeldLock {
  ticket: number;
  release: () => void;
}

// leader ticketの採番。writerを作り直しても（Strict Mode・利用者切替・再ログイン）同じJS環境の
// 中で番号が重ならないよう、writerごとではなくモジュール全体で単調増加させる（作り直し前の
// 古いtickが持つticketが、新しいwriterのticketと偶然一致して有効扱いになるのを防ぐ）。
let ticketSeq = 0;

export function getBrowserLockManager(): LockManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  if (!locks || typeof locks.request !== "function") return null;
  return locks;
}

export function createHostAutoWriter(deps: HostAutoWriterDeps): HostAutoWriter {
  const lockName = deps.lockName ?? HOST_AUTO_WRITER_LOCK_NAME;
  const catchUpRetryMs = deps.catchUpRetryMs ?? CATCH_UP_RETRY_MS;

  let enabled = false;
  let unsupported = false;
  // 認証確認に失敗した後は、次のresume（visible復帰等）まで再要求しない。
  let blockedUntilResume = false;
  // 現在有効なleader ticket。nullなら自動書き込みは一切許可しない。
  let currentTicket: number | null = null;
  let pending: PendingRequest | null = null;
  let held: HeldLock | null = null;
  let catchUpTimer: TimerHandle | null = null;
  let currentStatus: HostAutoWriterStatus = "inactive";

  const setStatus = (s: HostAutoWriterStatus) => {
    if (currentStatus === s) return;
    currentStatus = s;
    deps.onStatus(s);
  };

  const isValid = (ticket: number) => enabled && currentTicket !== null && ticket === currentTicket;

  const clearCatchUpTimer = () => {
    if (catchUpTimer !== null) {
      deps.clearTimer(catchUpTimer);
      catchUpTimer = null;
    }
  };

  // ticketを先に無効化し、自動timerを止めてからlockの返却を始める
  // （返却は実行中の自動書き込みの完了を待ってから。lockCallback参照）。
  const releaseHeld = () => {
    currentTicket = null;
    clearCatchUpTimer();
    deps.stopAutoTimer();
    if (held) held.release();
  };

  const clearProbe = (p: PendingRequest) => {
    if (p.probeTimer !== null) {
      deps.clearTimer(p.probeTimer);
      p.probeTimer = null;
    }
  };

  const abortPending = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearProbe(p);
    p.controller.abort();
  };

  const activate = async (ticket: number) => {
    let hostOk = false;
    try {
      hostOk = await deps.verifyHost();
    } catch {
      hostOk = false;
    }
    if (!isValid(ticket)) return;
    if (!hostOk) {
      // fail-closed：自動進行は始めず、lockも手放す（次のresumeまで再要求しない）。
      blockedUntilResume = true;
      releaseHeld();
      setStatus("inactive");
      return;
    }
    let fresh = false;
    try {
      fresh = await deps.catchUp();
    } catch {
      fresh = false;
    }
    if (!isValid(ticket)) return;
    if (!fresh) {
      // 最新状態を確認できるまで自動進行を始めない（古いローカルstateだけで進めない）。
      catchUpTimer = deps.setTimer(() => {
        catchUpTimer = null;
        if (isValid(ticket)) void activate(ticket);
      }, catchUpRetryMs);
      return;
    }
    deps.startAutoTimer(ticket, isValid);
    if (isValid(ticket)) setStatus("leader");
  };

  // 送信済みの自動書き込みが全て決着するまで待つ。時間では打ち切らない（決着前にlockを
  // 返すと、旧タブの書き込みが届く前に別タブが2本目を送れてしまうため）。
  // waitWritesIdle自体が失敗した場合は決着を確認できないので、lockを返さず保持し続ける。
  const waitDrained = async () => {
    try {
      await deps.waitWritesIdle();
    } catch {
      await new Promise<never>(() => {});
    }
  };

  const request = () => {
    if (!enabled || unsupported || blockedUntilResume) return;
    if (pending || held) return;
    if (!deps.isVisible()) return;
    const locks = deps.locks;
    if (!locks) return;

    const me: PendingRequest = { controller: new AbortController(), probeTimer: null };
    pending = me;
    setStatus("handoff");

    const lockCallback = async () => {
      // 待機中に中止・停止・hiddenになっていたら、何もせずすぐ返す。
      clearProbe(me);
      if (pending !== me || !enabled || !deps.isVisible()) {
        if (pending === me) pending = null;
        return;
      }
      pending = null;
      ticketSeq += 1;
      const ticket = ticketSeq;
      let releaseLock: () => void = () => {};
      const released = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const mine: HeldLock = { ticket, release: releaseLock };
      held = mine;
      currentTicket = ticket;
      setStatus("handoff");
      void activate(ticket);
      await released;
      await waitDrained();
      if (held === mine) held = null;
      // hidden等で解放した場合はrequest()側の条件で再要求しない。
      request();
    };

    let requestPromise: Promise<unknown>;
    try {
      requestPromise = locks.request(lockName, { mode: "exclusive", signal: me.controller.signal }, lockCallback);
    } catch {
      // 同期的な例外（安全でないコンテキスト等）：fail-closed。
      if (pending === me) pending = null;
      unsupported = true;
      setStatus("unsupported");
      return;
    }
    const settle = () => {
      clearProbe(me);
      if (pending === me) pending = null;
    };
    // AbortError（待機の中止）等で reject しても、生の例外は表示・出力しない。
    requestPromise.then(settle, settle);

    // 待機中は「別タブが担当中」か「引き継ぎ中」かを定期的に確認する（表示専用）。
    const query = locks.query;
    if (query) {
      const probe = () => {
        me.probeTimer = null;
        if (pending !== me) return;
        query.call(locks).then(
          (snapshot) => {
            if (pending !== me) return;
            const heldByOther = (snapshot.held ?? []).some((l) => l.name === lockName);
            setStatus(heldByOther ? "standby" : "handoff");
          },
          () => {},
        );
        me.probeTimer = deps.setTimer(probe, STATUS_PROBE_MS);
      };
      probe();
    }
  };

  return {
    start: () => {
      if (enabled) return;
      enabled = true;
      blockedUntilResume = false;
      if (!deps.locks) {
        unsupported = true;
        setStatus("unsupported");
        return;
      }
      if (!deps.isVisible()) {
        setStatus("inactive");
        return;
      }
      request();
    },
    stop: () => {
      enabled = false;
      abortPending();
      releaseHeld();
      setStatus(unsupported ? "unsupported" : "inactive");
    },
    resume: () => {
      if (!enabled || unsupported) return;
      if (!deps.isVisible()) return;
      blockedUntilResume = false;
      request();
    },
    suspend: () => {
      if (!enabled || unsupported) return;
      abortPending();
      releaseHeld();
      setStatus("inactive");
    },
    isValid,
    status: () => currentStatus,
  };
}

// lock取得直後の認証・権限の再確認：開始時と同じ利用者で、今もisHostであること。
// 利用者が切り替わった・ログアウトした・isHostを剥奪された場合はfalse（fail-closed）。
export function hostIdentityMatches(
  expectedUserId: string,
  current: { authUserId: string | null; profileId: string | null; isHost: boolean },
): boolean {
  if (!expectedUserId) return false;
  if (current.authUserId !== expectedUserId) return false;
  if (current.profileId !== expectedUserId) return false;
  return current.isHost === true;
}

// HostProgressControllerが使うイベント配線。document/windowは注入する。
export interface HostLifecycleTargets {
  doc: {
    visibilityState: string;
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
  };
  win: {
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
  };
}

// 読み取り側(init)と自動writer(lock)を同じイベントで扱うが、責務は分ける。
// - startRead：全adminタブで、表示・Realtime・読み取りを開始／再確認する（init()）。
// - stopAll：読み取り側も含めて全て止める（stopHostProgress()）。
// 戻り値のcleanupは listener を外し、writerを停止してから stopAll を呼ぶ。
export function attachHostProgressSession(p: {
  targets: HostLifecycleTargets;
  writer: HostAutoWriter;
  startRead: () => void;
  stopAll: () => void;
}): () => void {
  const { targets, writer, startRead, stopAll } = p;
  const isVisible = () => targets.doc.visibilityState === "visible";
  let active = true;

  startRead();
  writer.start();

  const resume = () => {
    if (!active || !isVisible()) return;
    startRead();
    writer.resume();
  };
  const onVisibility = () => {
    if (!active) return;
    if (isVisible()) resume();
    else writer.suspend();
  };
  const onPageHide = () => {
    if (!active) return;
    writer.suspend();
  };

  targets.doc.addEventListener("visibilitychange", onVisibility);
  targets.win.addEventListener("focus", resume);
  targets.win.addEventListener("pageshow", resume);
  targets.win.addEventListener("online", resume);
  targets.win.addEventListener("pagehide", onPageHide);

  return () => {
    active = false;
    targets.doc.removeEventListener("visibilitychange", onVisibility);
    targets.win.removeEventListener("focus", resume);
    targets.win.removeEventListener("pageshow", resume);
    targets.win.removeEventListener("online", resume);
    targets.win.removeEventListener("pagehide", onPageHide);
    writer.stop();
    stopAll();
  };
}
