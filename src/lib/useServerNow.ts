"use client";

import { useEffect, useState } from "react";

import { serverClock } from "./serverClockInstance";
import type { ServerClockStatus } from "./serverClock";
import { createServerClockSyncManager } from "./serverClockAutoSync";
import { useAuthStore } from "@/store/useAuthStore";

// 自動再同期は画面が何枚マウントされていても1本だけ動かし、認証済みの間だけ動かす
// （serverClockAutoSync.tsのcreateServerClockSyncManager参照）。
const syncManager = createServerClockSyncManager(serverClock, {
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
// 認証状態（useAuthStoreのuser）はこのフック内で購読し、未認証の間は時計RPCを一切呼ばない
// （各画面に認証判定を重複実装しない。フックの呼び出し自体は常に無条件）。
export function useServerClockState(intervalMs = 500): ServerClockState {
  const [state, setState] = useState<ServerClockState>(readState);
  const authenticated = useAuthStore((s) => s.user !== null);
  useEffect(() => {
    syncManager.setAuthenticated(authenticated);
  }, [authenticated]);
  useEffect(() => {
    let cancelled = false;
    const release = syncManager.acquire();
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
