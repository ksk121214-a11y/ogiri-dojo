"use client";

import { useEffect, useState } from "react";

// 一定間隔で現在時刻を更新するだけの共通フック。カウントダウン表示のために
// 複数の画面（参加者ページ本体・舞台画面・客席画面）で同じロジックが必要になるため一本化する。
export function useTickingNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
