// 検証用：同一originの複数タブで共有されるWeb Locks API（exclusiveのみ）の偽物。
// - タブごとに forTab(tabId) で LockManagerLike を払い出す（同じlock名を共有する）。
// - exclusiveの要求は到着順に1件ずつ付与し、callbackのPromiseが解決するまで次へ渡さない
//   （sharedは同時に複数付与する。exclusive指定が外れた場合に検出するため）。
// - signal.abort() された待機中の要求は AbortError で reject する（付与済みには影響しない）。
// - closeTab(tabId)：タブを閉じた時のブラウザ挙動を模し、そのタブの待機要求を捨て、
//   保持中のlockをcallbackの完了を待たずに解放する。
import type { LockManagerLike } from "../hostAutoWriter";

interface Entry {
  tabId: string;
  name: string;
  mode: string;
  callback: (lock: unknown) => Promise<void>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  signal: AbortSignal;
}

export class FakeWebLocks {
  private queue: Entry[] = [];
  private held: Entry[] = [];
  // 同時保持数の最大値（exclusiveなら常に1以下のはず）。
  maxConcurrentHolders = 0;
  grants: string[] = [];

  forTab(tabId: string): LockManagerLike {
    return {
      request: (name, options, callback) =>
        new Promise((resolve, reject) => {
          const entry: Entry = { tabId, name, mode: options.mode, callback, resolve, reject, signal: options.signal };
          if (options.signal.aborted) {
            reject(abortError());
            return;
          }
          options.signal.addEventListener("abort", () => {
            const idx = this.queue.indexOf(entry);
            if (idx >= 0) {
              this.queue.splice(idx, 1);
              reject(abortError());
            }
          });
          this.queue.push(entry);
          queueMicrotask(() => this.pump());
        }),
      query: () =>
        Promise.resolve({
          held: this.held.map((e) => ({ name: e.name })),
        }),
    };
  }

  holderTab(): string | null {
    return this.held.length > 0 ? this.held[0].tabId : null;
  }

  holderCount(): number {
    return this.held.length;
  }

  pendingCount(tabId?: string): number {
    return this.queue.filter((e) => tabId === undefined || e.tabId === tabId).length;
  }

  closeTab(tabId: string) {
    this.queue = this.queue.filter((e) => e.tabId !== tabId);
    const mine = this.held.filter((e) => e.tabId === tabId);
    this.held = this.held.filter((e) => e.tabId !== tabId);
    for (const e of mine) e.resolve(undefined);
    queueMicrotask(() => this.pump());
  }

  private canGrant(entry: Entry): boolean {
    if (this.held.length === 0) return true;
    return entry.mode === "shared" && this.held.every((h) => h.mode === "shared");
  }

  private pump() {
    while (this.queue.length > 0 && this.canGrant(this.queue[0])) {
      const entry = this.queue.shift()!;
      this.held.push(entry);
      this.grants.push(entry.tabId);
      this.maxConcurrentHolders = Math.max(this.maxConcurrentHolders, this.held.length);
      const done = () => {
        this.held = this.held.filter((h) => h !== entry);
      };
      Promise.resolve()
        .then(() => entry.callback({ name: entry.name, mode: entry.mode }))
        .then(
          (v) => {
            done();
            entry.resolve(v);
            this.pump();
          },
          (e) => {
            done();
            entry.reject(e);
            this.pump();
          },
        );
    }
  }
}

function abortError(): Error {
  const e = new Error("The request was aborted.");
  e.name = "AbortError";
  return e;
}

// 手動で進める偽タイマー（setTimer/clearTimer注入用）。
export class FakeClock {
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now = 0;

  setTimer = (fn: () => void, ms: number): unknown => {
    this.seq += 1;
    this.timers.set(this.seq, { at: this.now + ms, fn });
    return this.seq;
  };

  clearTimer = (handle: unknown) => {
    this.timers.delete(handle as number);
  };

  pendingCount(): number {
    return this.timers.size;
  }

  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < nextAt) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const t = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.now = t.at;
      t.fn();
    }
    this.now = target;
  }
}

// 偽のdocument/window（イベント登録数を数えられる）。
export class FakeEventTarget {
  private listeners = new Map<string, Set<() => void>>();
  visibilityState = "visible";

  addEventListener = (type: string, fn: () => void) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  };

  removeEventListener = (type: string, fn: () => void) => {
    this.listeners.get(type)?.delete(fn);
  };

  dispatch(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

export async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
