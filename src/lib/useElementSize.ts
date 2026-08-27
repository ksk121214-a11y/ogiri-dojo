"use client";

import { useCallback, useEffect, useState } from "react";

// CSSのaspect-ratioプロパティ＋height:100%/width:autoの組み合わせは、
// ネストしたflex/grid/minmaxの中でSafariとChromeで解釈が食い違うことがあり、
// 実機Safariで幅が0近くまで潰れて文字が縦一列に折り返す不具合が起きた。
// aspect-ratioに頼らず、JSで実測したコンテナの幅・高さから素材のアスペクト比に
// 収まる実ピクセルサイズを計算し、インラインstyleで直接指定することで
// ブラウザ間の解釈差を避ける。
//
// 呼び出し元コンポーネントは「storeが未初期化ならnullを返す」early returnを
// hooksの後に持つことが多く、その最初のnullレンダー時にはref先のDOM要素が
// まだ存在しない。plain useRef+useEffect(deps:[])だとその1回きりのeffectで
// el===nullのまま何もせず終わり、後で実際にDOMが現れても二度と測定されない。
// コールバックref（DOM要素の付け外しのたびに毎回呼ばれる）を使うことで、
// 実際に要素がマウントされたタイミングを確実に捕まえる。
export function useElementSize<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const ref = useCallback((el: T | null) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  return [ref, size] as const;
}

// 実測した箱(containerWidth×containerHeight)の中に、指定アスペクト比(ratio=幅/高さ)の
// 素材が収まる実ピクセルサイズ(width/height)を計算する。
export function fitAspect(
  containerWidth: number,
  containerHeight: number,
  ratio: number,
): { width: number; height: number } {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { width: 0, height: 0 };
  }
  if (containerWidth / containerHeight > ratio) {
    // 横に余裕がある = 高さ基準
    return { width: containerHeight * ratio, height: containerHeight };
  }
  return { width: containerWidth, height: containerWidth / ratio };
}
