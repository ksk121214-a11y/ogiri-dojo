"use client";

import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";

// 客席：画面下部に固定表示する観客シルエット。
// 舞台土台（StageCharacters内の丸い舞台、-z-10）より手前に見せたいが、
// LiveStageBackdrop（画面全体の背景、-z-10のコンテナ）の中に置くと、その
// コンテナ自体がスタッキング上ずっと背面に固定されるため、中でz-indexを
// いくら上げても舞台には勝てない。そのため観客だけを独立コンポーネントに切り出し、
// 呼び出し側でキャラ列（舞台含む）の直後・操作ゾーンの直前にDOM配置することで、
// 同じスタッキング文脈の中でDOM順により「舞台より前・操作ボタンより後ろ」を実現する。
//
// bottom位置はvh基準の計算式で、舞台(3行目グリッドセル内でcenter配置)の
// 画面高さに対する非線形な動きに追従させている。ただし舞台の位置は、
// 4行目（操作ゾーン）の高さにも左右される。舞台視点は「テキストエリア+送信ボタン」、
// 客席視点は「ツッコミ/爆笑/拍手ボタン」で4行目の高さが異なるため、舞台の絶対位置が
// 画面によって微妙にズレる。舞台自体には触れず、呼び出し側からその差分(px)を
// extraOffsetPxとして受け取り、観客側のbottom位置だけで吸収する。
//
// design-preview側では舞台自体を画面下端からの絶対px固定に変更したため、
// 同じ考え方に合わせられるようfixedBottomPxを追加。指定時はvh計算式を使わず、
// 単純な絶対px固定になる（本番のStageAnsweringView/AudienceAnsweringViewは
// 何も渡さないため、従来のvh計算式のまま挙動は変わらない）。
//
// design-preview側は舞台(土台)とキャラ列を別々のfixedレイヤーに分離しており
// (舞台z-0 < 観客 < キャラ列z-10)、観客をその間に挟むためzIndexで明示的に
// 上書きできるようにしている（本番は何も渡さないためz-0のまま変わらない）。
export default function AudienceLayer({
  extraOffsetPx = 0,
  fixedBottomPx,
  zIndex,
  imageSrc = "/images/live/audience-silhouette.png",
  heightClassName = "h-44",
  maxWidthClassName = "max-w-[500px]",
  fit = "cover",
  fixedRenderWidthPx,
  fixedRenderHeightPx,
  imageClassName = "",
}: {
  extraOffsetPx?: number;
  fixedBottomPx?: number;
  zIndex?: number;
  // 別デザイン確認(live-design-preview-2)で別素材のシルエットに差し替えるためのオプション。
  // 本番・1個目のdesign-previewは何も渡さないため、従来の画像のまま変わらない。
  imageSrc?: string;
  // シルエットを大きくしたい場合に高さ・最大幅を上書きするためのオプション。
  // 本番・1個目は何も渡さないため、従来のサイズのまま変わらない。
  heightClassName?: string;
  maxWidthClassName?: string;
  // "contain"にすると左右が切れず画像全体を収める。本番・1個目は何も渡さない
  // ため、従来通りboxいっぱいに拡大表示するcoverのまま変わらない。
  fit?: "cover" | "contain";
  // 両方指定すると、heightClassName/maxWidthClassName/fitを無視して常にこの
  // pxサイズで描画する。object-fitはboxの幅(=画面幅)を基準に拡大率が決まる
  // ため、maxWidthClassNameがw-fullを含む可変幅だとスマホとPCで画面幅が違う
  // 分だけ見た目の大きさも変わってしまう(ユーザー指摘: 「パソコンサイズも
  // スマホサイズもシルエットの大きさは一緒で」)。pxサイズを直接固定することで、
  // 画面幅に関係なく常に同じ大きさで描画する(中央寄せはleft-1/2+
  // -translate-x-1/2の確実な方式)。本番・1個目は何も渡さないため影響しない。
  fixedRenderWidthPx?: number;
  fixedRenderHeightPx?: number;
  // シルエット画像自体は不透明(alpha 255)だが、暗い紺色の塗りが舞台背景の紺〜青紫と
  // 近い色のため、コントラストが低く「透過しているように」見えてしまう場合がある。
  // 本番・1個目は何も渡さないため影響しない。
  imageClassName?: string;
}) {
  if (fixedRenderWidthPx !== undefined && fixedRenderHeightPx !== undefined) {
    return (
      <div
        className="pointer-events-none fixed left-1/2 z-0 -translate-x-1/2 opacity-100"
        style={{
          width: fixedRenderWidthPx,
          height: fixedRenderHeightPx,
          bottom: fixedBottomPx !== undefined ? `${fixedBottomPx}px` : undefined,
          ...(zIndex === undefined ? {} : { zIndex }),
        }}
      >
        <Image
          src={`${BASE_PATH}${imageSrc}`}
          alt=""
          fill
          sizes={`${fixedRenderWidthPx}px`}
          loading="eager"
          fetchPriority="high"
          className={`object-contain ${imageClassName}`}
        />
      </div>
    );
  }

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-0 mx-auto ${heightClassName} ${maxWidthClassName} overflow-hidden opacity-100 ${
        fixedBottomPx === undefined
          ? "bottom-[calc(35vh_-_290.5px_-_var(--audience-extra-offset,0px))] sm:bottom-[calc(33vh_-_314.5px_-_var(--audience-extra-offset,0px))]"
          : ""
      }`}
      style={{
        "--audience-extra-offset": `${extraOffsetPx}px`,
        ...(fixedBottomPx === undefined ? {} : { bottom: `${fixedBottomPx}px` }),
        ...(zIndex === undefined ? {} : { zIndex }),
      } as React.CSSProperties}
    >
      <Image
        src={`${BASE_PATH}${imageSrc}`}
        alt=""
        fill
        sizes="100vw"
        loading="eager"
        fetchPriority="high"
        className={fit === "contain" ? "object-contain" : "object-cover"}
        style={fit === "contain" ? undefined : { objectPosition: "50% 53%" }}
      />
    </div>
  );
}
