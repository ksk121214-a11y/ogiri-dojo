// サーバー同期時計の再同期スケジューラ（4回目レビュー対応）。
// 初回・定期・失敗後の再試行(バックオフ)・オンライン復帰・タブ再表示・bfcache復帰で
// 同期する。タイマー・イベント購読先は注入できる（テスト用）。
import type { ServerClock } from "./serverClock";

export interface AutoSyncEnv {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  onOnline: (fn: () => void) => () => void;
  onVisible: (fn: () => void) => () => void;
}

export const SERVER_CLOCK_RESYNC_INTERVAL_MS = 5 * 60 * 1000;
export const SERVER_CLOCK_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

export function startServerClockAutoSync(
  clock: ServerClock,
  env: AutoSyncEnv,
  opts: { intervalMs?: number; retryDelaysMs?: number[] } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? SERVER_CLOCK_RESYNC_INTERVAL_MS;
  const retry = opts.retryDelaysMs ?? SERVER_CLOCK_RETRY_DELAYS_MS;
  let stopped = false;
  let timer: unknown = null;
  let failures = 0;

  const schedule = (ms: number) => {
    if (timer !== null) env.clearTimeout(timer);
    timer = env.setTimeout(() => void run(false), ms);
  };
  const run = async (force: boolean) => {
    if (stopped) return;
    const ok = await clock.sync({ force });
    if (stopped) return;
    if (ok) {
      failures = 0;
      schedule(intervalMs);
    } else {
      schedule(retry[Math.min(failures, retry.length - 1)]);
      failures += 1;
    }
  };

  // スリープ・復帰等の可能性があるイベントでは、再同期を始める前に必ずstale化する
  // （古いアンカーを表示・音声予約へ使わせない）。既にfreshでなければmarkStaleは
  // 何もせず、同期はsingle-flightで合流するため、連続イベントでも通信は増えない。
  const onLifecycleEvent = () => {
    if (stopped) return;
    clock.markStale();
    void run(false);
  };
  // 時計を使う画面への（再）入場時も、残っている古いアンカーをfreshのまま使わない。
  clock.markStale();
  void run(false);
  const offOnline = env.onOnline(onLifecycleEvent);
  const offVisible = env.onVisible(onLifecycleEvent);
  return () => {
    stopped = true;
    if (timer !== null) env.clearTimeout(timer);
    offOnline();
    offVisible();
  };
}
