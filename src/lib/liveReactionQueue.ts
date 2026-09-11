"use client";

// 0068追加：ツッコミ/拍手/爆笑の同時表示（キュー方式）対応の共通フック。
// src/components/live-room/TsukkomiDanmakuOverlay.tsx・LaughMarkOverlay.tsx・
// TsukkomiFloatOverlay.tsxが、useLiveFollowerStoreの待機キュー(tsukkomiQueue)から
// 自分が担当する種別のイベントを取り出して画面に表示するために使う。
//
// 設計上のポイント（過負荷対策）：
// - 待機中の全イベントに対して個別にsetTimeoutを大量生成しない。1つの
//   setInterval（tickMs、既定100ms＝80〜120ms程度の間隔）だけで、キューから
//   1件ずつ順番に取り出す「単一の安全な処理ループ」にする。
// - 画面上に実際に表示される件数は maxConcurrent（8〜12件程度）で頭打ちにする。
//   表示中の1件ぶんの「表示終了後に消す」タイマーだけは個別に持つ（この件数は
//   maxConcurrentで必ず小さく抑えられているため、大量生成の問題にはならない）。
// - コンポーネントのアンマウント時に、setInterval・表示中アイテムぶんの
//   setTimeoutを全て破棄し、表示中アイテムも空にする。
// - このフック内の処理は try/catch で囲み、リアクション表示側の例外が
//   ライブ進行（フェーズタイマー・回答受付・採点等）に一切影響しないようにする
//   （store側のclaimReactionEvent・tsukkomiQueueもライブ進行のstateとは
//   完全に別のフィールドであり、参照すらしていない）。
import { useEffect, useRef, useState } from "react";

import { useLiveFollowerStore, type TsukkomiEvent } from "@/store/useLiveFollowerStore";

const DEFAULT_TICK_MS = 100;

export interface UseTsukkomiReactionQueueOptions<T extends { id: string }> {
  // このオーバーレイが表示を担当するイベントかどうか（例：爆笑だけ、爆笑以外）。
  predicate: (event: TsukkomiEvent) => boolean;
  // 画面上の同時表示数の上限（8〜12件程度を推奨）。
  maxConcurrent: number;
  // 表示開始からこのミリ秒後に自動的にDOMから取り除く（アニメーション完了時の
  // onAnimationCompleteと合わせて、確実に消えるようにする保険）。
  removeFallbackMs: number;
  // キューから取り出したイベント＋表示用の通し番号(styleIndex)から、実際に画面へ
  // 積む表示アイテム（座標・軌道等、呼び出し元ごとの演出情報を含む）を組み立てる。
  mapToDisplay: (event: TsukkomiEvent, styleIndex: number) => T;
  // 取り出す間隔（ミリ秒）。既定は80〜120ms程度を狙った100ms。
  tickMs?: number;
}

export function useTsukkomiReactionQueue<T extends { id: string }>(
  options: UseTsukkomiReactionQueueOptions<T>,
): { items: T[]; remove: (id: string) => void } {
  const { predicate, maxConcurrent, removeFallbackMs, mapToDisplay, tickMs = DEFAULT_TICK_MS } = options;
  const [items, setItems] = useState<T[]>([]);
  const itemsCountRef = useRef(0);
  const styleIndexRef = useRef(0);
  // predicate/mapToDisplayは呼び出し側でインラインのアロー関数として渡されることが
  // 多く、毎レンダーで参照が変わる。intervalを毎回作り直さずに済むようrefで持つ
  // （refの更新自体はuseEffect内で行い、レンダー中に直接書き換えない）。
  const predicateRef = useRef(predicate);
  const mapRef = useRef(mapToDisplay);
  const fallbackTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    itemsCountRef.current = items.length;
  }, [items]);

  useEffect(() => {
    predicateRef.current = predicate;
  }, [predicate]);

  useEffect(() => {
    mapRef.current = mapToDisplay;
  }, [mapToDisplay]);

  const remove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  useEffect(() => {
    let disposed = false;
    const timers = fallbackTimersRef.current;

    const tick = () => {
      if (disposed) return;
      try {
        if (itemsCountRef.current >= maxConcurrent) return;
        const claimed = useLiveFollowerStore.getState().claimReactionEvent(predicateRef.current);
        if (!claimed) return;
        const displayItem = mapRef.current(claimed, styleIndexRef.current);
        styleIndexRef.current += 1;
        setItems((prev) => [...prev, displayItem]);
        const fallback = setTimeout(() => {
          timers.delete(fallback);
          if (disposed) return;
          setItems((prev) => prev.filter((it) => it.id !== displayItem.id));
        }, removeFallbackMs);
        timers.add(fallback);
      } catch (e) {
        // リアクション表示側の例外はここで握りつぶし、ライブ進行（フェーズ
        // タイマー・回答受付・採点等）には一切影響させない。
        console.warn("[tsukkomi] リアクション表示処理でエラーが発生しました", e);
      }
    };

    const interval = setInterval(tick, tickMs);
    return () => {
      // コンポーネントのアンマウント時：待機キューを処理するタイマー・表示中
      // アイテムぶんのタイマーを全て破棄し、表示中アイテムも空にする。
      disposed = true;
      clearInterval(interval);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      setItems([]);
    };
  }, [maxConcurrent, removeFallbackMs, tickMs]);

  return { items, remove };
}
