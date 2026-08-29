"use client";

import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";
import { useElementSize } from "@/lib/useElementSize";

// 回答・採点画面（StageScreen/AudienceScreenとそのlive-room版）に共通の舞台背景。
// このファイルはlive-demo専用ではなく、本番のlive-room（StageAnsweringView/
// AudienceAnsweringView）からも直接importされている共有コンポーネントのため、
// 既存呼び出し箇所（variant省略＝"dojo"）の見た目は一切変えない。
//
// variant="neon2"：design-preview-2（隠しURL /live/design-preview-2）で作り込んだ
// ネオン系デザインに合わせ、緞帳ではなく「舞台袖」素材を使う構成。袖の高さは画面の
// 実測高さに応じて変える必要がある（iPhone SEのような縦が短い画面では袖が画面の
// ほとんどを覆ってしまう一方、PC等の縦長・横広画面では小さすぎるため）。aspect-ratio
// CSSに頼るとSafariで解釈がブレるため、useElementSizeで実測した高さからJSで直接pxを
// 計算してインラインstyleに渡す（design-preview-2で確認済みの手法をそのまま踏襲）。
// このpropを渡すのはlive-demoの再スキン済み画面だけ（本番・design-preview-2自身は
// 何も渡さないため影響しない）。
const SIDE_HEIGHT_RATIO = 400 / 844;
const SIDE_ASPECT = 265 / 1020; // 幅 / 高さ
const SIDE_MIN_HEIGHT_PX = 220;
const SIDE_MAX_HEIGHT_PX = 460;
const STAGE_VISIBLE_HALF_WIDTH = 410;

export default function LiveStageBackdrop({
  variant = "dojo",
}: {
  variant?: "dojo" | "neon2";
}) {
  // variant="dojo"の時は使わないが、Hooksは条件分岐なしで常に呼ぶ必要があるため
  // 無条件に呼び出しておく（測定結果はneon2の時だけ利用する）。
  const [rootRef, rootSize] = useElementSize<HTMLDivElement>();

  if (variant === "neon2") {
    const sideHeightPx = rootSize
      ? Math.min(SIDE_MAX_HEIGHT_PX, Math.max(SIDE_MIN_HEIGHT_PX, rootSize.height * SIDE_HEIGHT_RATIO))
      : SIDE_MIN_HEIGHT_PX;
    const sideWidthPx = sideHeightPx * SIDE_ASPECT;
    const sideEdgeGap = `max(0px, calc(50% - ${STAGE_VISIBLE_HALF_WIDTH}px - ${sideWidthPx}px))`;

    return (
      <div ref={rootRef} className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0d0a1a]">
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[28px] h-[933px] w-[1400px]">
          <Image
            src={`${BASE_PATH}/images/live2/stage-bg-2.png`}
            alt=""
            fill
            priority
            sizes="800px"
            className="object-contain"
          />
        </div>
        <div
          className="absolute bottom-[252px] sm:bottom-[242px]"
          style={{ width: sideWidthPx, height: sideHeightPx, left: sideEdgeGap }}
        >
          <Image
            src={`${BASE_PATH}/images/live2/side-left-crop.png`}
            alt=""
            fill
            priority
            sizes="300px"
            className="object-contain object-left-top"
          />
        </div>
        <div
          className="absolute bottom-[252px] sm:bottom-[242px]"
          style={{ width: sideWidthPx, height: sideHeightPx, right: sideEdgeGap }}
        >
          <Image
            src={`${BASE_PATH}/images/live2/side-left-crop.png`}
            alt=""
            fill
            priority
            sizes="300px"
            className="-scale-x-100 object-contain object-left-top"
          />
        </div>
      </div>
    );
  }

  // 舞台写真を敷き、両端に緞帳（カーテン）を重ねて舞台袖らしさを出す。
  // カーテン素材は横長比率（約1048:699）のため、コンテナ側もaspect-[]で同じ比率に
  // 合わせている（比率がズレるとcontain時に上下または左右へ不要な余白ができるため）。
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <Image
        src={`${BASE_PATH}/images/live/stage-bg.png`}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-80"
      />
      <div className="absolute inset-0 bg-dojo-stage-dark/60" />
      <div className="absolute -left-56 top-0 aspect-[1048/699] h-[40rem] sm:-left-80 sm:h-[52rem]">
        <Image
          src={`${BASE_PATH}/images/live/curtain-left.png`}
          alt=""
          fill
          sizes="1200px"
          className="object-contain object-left-top"
        />
      </div>
      <div className="absolute -right-56 top-0 aspect-[1048/699] h-[40rem] sm:-right-80 sm:h-[52rem]">
        <Image
          src={`${BASE_PATH}/images/live/curtain-right.png`}
          alt=""
          fill
          sizes="1200px"
          className="object-contain object-right-top"
        />
      </div>
    </div>
  );
}
