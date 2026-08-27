"use client";

import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";
import { useElementSize } from "@/lib/useElementSize";

// src/components/live-demo/LiveStageBackdrop.tsxのデザイン確認用コピー。
// 本番側はScreenShell（max-w-4xlで中央寄せ）の内側にabsolute配置されているため、
// 広いPC画面ではScreenShellの横幅までしか背景が広がらず、左右が黒く欠けて見える問題があった。
// ここではposition: fixedにしてScreenShellの幅制約から独立させ、常にビューポート全体を覆う。
//
const SHOW_CURTAINS = true;
const SHOW_BACKGROUND = true;

// スマホ(高さ844px想定)で現在のサイズ感がちょうど良いと確認済みのため、
// その高さを「伸ばさない基準」とする。画面がそれより高い場合だけ、はみ出た分に
// 応じて縦に伸ばす。
const CURTAIN_BASE_VIEWPORT_HEIGHT = 844;
const CURTAIN_MAX_SCALE_Y = 2.2;

// 横幅は画面が広がっても一切拡大しない(=左右カーテンの内側の端を常に同じ位置に
// 固定し、幅が広い画面でカーテン同士が中央に迫らないようにする)。
// 縦方向だけ画面の高さに合わせて伸ばし、「上端は画面の上端に届く」「下端は
// 舞台(演壇)の裏に隠れるくらいまで届く」を満たす。scale(1, y)で縦だけ
// 非等倍に伸ばすため画像は縦に伸びるが、カーテンの縦ヒダ模様なので違和感は小さい。
export default function LiveStageBackdropPreview() {
  const [rootRef, rootSize] = useElementSize<HTMLDivElement>();
  const curtainScaleY = rootSize
    ? Math.min(CURTAIN_MAX_SCALE_Y, Math.max(1, rootSize.height / CURTAIN_BASE_VIEWPORT_HEIGHT))
    : 1;

  return (
    <div ref={rootRef} className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {SHOW_BACKGROUND && (
        <Image
          src={`${BASE_PATH}/images/live/stage-bg.png`}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-80"
        />
      )}
      <div className="absolute inset-0 bg-dojo-stage-dark/60" />
      {SHOW_CURTAINS && (
        <>
          <div
            className="absolute -left-[249px] -top-4 aspect-[1048/699] h-[37rem] origin-top-left"
            style={{ transform: `scale(1, ${curtainScaleY})` }}
          >
            <Image
              src={`${BASE_PATH}/images/live/curtain-left.png`}
              alt=""
              fill
              sizes="1200px"
              className="object-contain object-left-top"
            />
          </div>
          <div
            className="absolute -right-[249px] -top-4 aspect-[1048/699] h-[37rem] origin-top-right"
            style={{ transform: `scale(1, ${curtainScaleY})` }}
          >
            <Image
              src={`${BASE_PATH}/images/live/curtain-right.png`}
              alt=""
              fill
              sizes="1200px"
              className="object-contain object-right-top"
            />
          </div>
        </>
      )}
    </div>
  );
}
