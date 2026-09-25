"use client";

import { useEffect, useState } from "react";

import { serverClock } from "./serverClockInstance";
import type { ServerClockStatus } from "./serverClock";
import { startServerClockAutoSync } from "./serverClockAutoSync";

// 自動再同期は画面が何枚マウントされていても1本だけ動かす（参照カウント）。
let refCount = 0;
let stopAutoSync: (() => void) | null = null;

function acquireAutoSync() {
  refCount += 1;
  if (refCount === 1) {
    stopAutoSync = startServerClockAutoSync(serverClock, {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      onOnline: (fn) => {
        window.addEventListener("online", fn);
        window.addEventListener("pageshow", fn);
        return () => {
          window.removeEventListener("online", fn);
          window.removeEventListener("pageshow", fn);
        };
      },
      onVisible: (fn) => {
        const h = () => {
          if (document.visibilityState === "visible") fn();
        };
        document.addEventListener("visibilitychange", h);
        return () => document.removeEventListener("visibilitychange", h);
      },
    });
  }
  return () => {
    refCount -= 1;
    if (refCount === 0 && stopAutoSync) {
      stopAutoSync();
      stopAutoSync = null;
    }
  };
}

export interface ServerClockState {
  now: number; // freshでない間は暫定値。表示・音声予約にはfreshを確認して使うこと
  fresh: boolean; // 現在利用してよい新鮮な時計か
  status: ServerClockStatus;
  revision: number;
}

const readState = (): ServerClockState => ({
  now: serverClock.now(),
  fresh: serverClock.isFresh(),
  status: serverClock.getStatus(),
  revision: serverClock.getRevision(),
});

// サーバー(DB)時刻と同期した時計の状態（現在時刻・鮮度・状態・同期世代）を一定間隔と
// 同期成功のたびに返す共通フック。ライブ画面のカウントダウン・音声予約は全てこれを使う
// （端末のDate.now()を直接使わない）。fresh=falseの間のnowは暫定値なので、
// 残り時間の表示・音声の予約には使わないこと（liveRemaining.tsはfresh=falseならsyncingを返す）。
export function useServerClockState(intervalMs = 500): ServerClockState {
  const [state, setState] = useState<ServerClockState>(readState);
  useEffect(() => {
    let cancelled = false;
    const release = acquireAutoSync();
    const update = () => {
      if (!cancelled) setState(readState());
    };
    const unsubscribe = serverClock.subscribe(update);
    const id = setInterval(update, intervalMs);
    update();
    return () => {
      cancelled = true;
      clearInterval(id);
      unsubscribe();
      release();
    };
  }, [intervalMs]);
  return state;
}
