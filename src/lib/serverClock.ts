// サーバー(DB)時刻と同期した共通時計（4〜6回目レビュー対応）。
//
// ライブ進行の締切(phase_deadline/judging_ends_at等)はDBのnow()から作られた絶対時刻
// なので、端末のDate.now()と直接引き算すると、端末時計のずれがそのまま残り時間のずれに
// なる。この時計は「同期した瞬間のサーバー時刻」と「その瞬間のperformance.now()」の組
// （アンカー）だけを保存し、以後の経過はperformance.now()の差分だけで進める。同期時は
// 往復の中間点をアンカーにして通信遅延の半分を補正する。
//
// 6回目レビュー対応（鮮度）：PCスリープ中にperformance.now()が止まる環境では、復帰後の
// アンカーが古くなる。「一度同期したことがある」だけでは表示・音声予約に使ってはいけない
// ため、状態を unsynced（アンカー無し）/ syncing（アンカー無しで同期中）/ fresh（現在
// 利用してよい）/ stale（アンカーはあるが古い可能性がある。同期中を含む）で管理する。
// 表示・音声用のAPI(nowIfFresh)はfreshの時だけ時刻を返す。スリープ・復帰の可能性がある
// ライフサイクルイベントでは、再同期を始める前にmarkStale()でstale化して購読者へ通知する。
// ライブ進行RPCはこの状態に一切依存しない（時計の状態と無関係に動く）。
//
// 純粋なロジック（Supabase・DOM非依存）にして、performance.now()と取得関数を
// 注入できるようにしている（src/lib/__tests__/serverClock.check.tsで検証）。

export interface ServerClockDeps {
  perfNow: () => number;
  fetchServerEpochMs: () => Promise<number>;
  // 同期前の暫定値。実運用ではDate.now()。表示・音声予約には使わないこと。
  fallbackNow: () => number;
}

export type ServerClockStatus = "unsynced" | "syncing" | "fresh" | "stale";

export interface ServerClock {
  // アンカーが無ければ暫定値(端末時計)。表示・音声予約には使わない（nowIfFreshを使う）。
  now(): number;
  // freshな時だけサーバー基準の現在時刻を返す。unsynced/syncing/stale中はnull。
  nowIfFresh(): number | null;
  isFresh(): boolean;
  // 一度でも同期に成功したか（アンカーの有無。鮮度とは別）。
  hasAnchor(): boolean;
  getStatus(): ServerClockStatus;
  // 同期に成功して結果を反映するたびに増える番号（失敗・古い/破棄された応答では増えない）。
  getRevision(): number;
  // スリープ・復帰等でアンカーが古い可能性がある時に呼ぶ。既にfreshでなければ何もしない。
  // freshだった場合はstaleへ落とし、購読者へ通知する。進行中の同期があれば、
  // それはstale化より前に始まった応答なので破棄対象にする。
  markStale(): void;
  // 同期する。進行中の（破棄対象でない）同期があれば、force未指定ならそれに合流する。
  // 成功して結果を反映したらtrue。失敗・破棄ならfalse（throwしない。既存アンカーは保持）。
  sync(opts?: { force?: boolean }): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}

export function createServerClock(deps: ServerClockDeps): ServerClock {
  let anchor: { serverEpochMs: number; perfMs: number } | null = null;
  let fresh = false;
  let startedSeq = 0;
  let appliedSeq = 0;
  let staleEpoch = 0;
  let inFlight: { promise: Promise<boolean>; epoch: number } | null = null;
  let inFlightCount = 0;
  let revision = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const runSync = async (epochAtStart: number): Promise<boolean> => {
    const mySeq = ++startedSeq;
    inFlightCount += 1;
    notify(); // unsynced→syncing / stale→syncing の変化を通知
    const started = deps.perfNow();
    let serverEpochMs: number;
    try {
      serverEpochMs = await deps.fetchServerEpochMs();
    } catch {
      inFlightCount -= 1;
      notify();
      return false;
    }
    const finished = deps.perfNow();
    inFlightCount -= 1;
    // stale化より前に始めた応答は、スリープ跨ぎ等でperformance.nowの前提が崩れている
    // 可能性があるため破棄する。より新しく開始した同期が既に反映済みなら古い応答も捨てる。
    if (!Number.isFinite(serverEpochMs) || epochAtStart !== staleEpoch || mySeq < appliedSeq) {
      notify();
      return false;
    }
    appliedSeq = mySeq;
    anchor = { serverEpochMs, perfMs: (started + finished) / 2 };
    fresh = true;
    revision += 1;
    notify();
    return true;
  };

  return {
    now() {
      if (!anchor) return deps.fallbackNow();
      return anchor.serverEpochMs + (deps.perfNow() - anchor.perfMs);
    },
    nowIfFresh() {
      return anchor && fresh ? anchor.serverEpochMs + (deps.perfNow() - anchor.perfMs) : null;
    },
    isFresh() {
      return fresh;
    },
    hasAnchor() {
      return anchor !== null;
    },
    getStatus() {
      if (fresh) return "fresh";
      if (inFlightCount > 0) return "syncing";
      return anchor ? "stale" : "unsynced";
    },
    getRevision() {
      return revision;
    },
    markStale() {
      if (!fresh) return; // 既にfreshでない：何もしない（連続イベントで世代を増やさない）
      fresh = false;
      staleEpoch += 1;
      notify();
    },
    sync(opts) {
      if (inFlight && !opts?.force && inFlight.epoch === staleEpoch) return inFlight.promise;
      const epoch = staleEpoch;
      const p = runSync(epoch).finally(() => {
        if (inFlight && inFlight.promise === p) inFlight = null;
      });
      inFlight = { promise: p, epoch };
      return p;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
