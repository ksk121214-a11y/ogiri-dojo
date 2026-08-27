"use client";

import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";
import { useElementSize } from "@/lib/useElementSize";

// live-design-preview(1個目)のLiveStageBackdropPreview.tsxを、大喜利素材2の
// ネオン系アセットに差し替えたコピー。カーテンの代わりに「舞台袖」素材を使う。
// 元画像(side-left/right.png)は形の部分が中央寄りにあり周囲に余白(グローのにじみ)が
// 広いため、そのまま使うと画面端に寄せた時に半分近くが余白になってしまう。
// side-left-crop.png/side-right-crop.pngは形の部分だけをタイトに切り抜いた版
// （細長い比率になっている）で、それを画面端(左右とも0)にぴったり付ける。
//
// 完全な固定pxにすると、iPhone SEのような縦が短い画面では画面の高さに対して
// 袖が相対的に大きくなりすぎ、逆にiPad/PCのような縦長・横広画面では小さすぎる
// ("376×667で確認したら袖が画面のほとんどを覆ってしまった"という実機/DevTools
// 確認で発覚)。縦だけaspect-ratio CSSやtransform:scaleに頼ると実機Safariで
// 解釈がブレる懸念があるため(このセッション序盤のフリップカードの不具合と同じ
// パターン)、useElementSizeで実測した画面高さから、JSで直接ピクセル値を計算して
// インラインstyleのwidth/heightに指定する（1個目のボード実測方式と同じ手法）。
// SIDE_HEIGHT_RATIOはスマホ実機(高さ844px)で確認して良かった比率(565/844)。
//
// 袖はtop基準ではなくbottom基準(bottom-[242px])で置く。舞台box(下でbottom-[28px]・
// 高さ933px固定)は画面の高さに関わらず「画面下端からの距離」が常に一定なので、
// 袖側もbottom基準で揃えれば、画面の高さがどんなに変わっても袖の下端と舞台の
// 継ぎ目が常に同じ位置でくっつく（top基準だと画面が低いほど袖の下端が舞台の
// 継ぎ目より下にずれ、画面が高いほど上にずれてしまっていた）。
const SIDE_HEIGHT_RATIO = 400 / 844;
const SIDE_ASPECT = 265 / 1020; // 幅 / 高さ
const SIDE_MIN_HEIGHT_PX = 220;
const SIDE_MAX_HEIGHT_PX = 460;

export default function LiveStageBackdropPreview2() {
  const [rootRef, rootSize] = useElementSize<HTMLDivElement>();
  const sideHeightPx = rootSize
    ? Math.min(SIDE_MAX_HEIGHT_PX, Math.max(SIDE_MIN_HEIGHT_PX, rootSize.height * SIDE_HEIGHT_RATIO))
    : SIDE_MIN_HEIGHT_PX;
  const sideWidthPx = sideHeightPx * SIDE_ASPECT;
  // 舞台box(幅1400px固定・中央寄せ)より画面が広くなると、袖を画面端(left-0/
  // right-0)に置いたままだと舞台とどんどん離れてしまう。boxの外側の端
  // (中央から700px)を基準にすると、実際に舞台の絵が入っている範囲より
  // 手前で袖が止まってしまう(stage-bg-2.pngはboxの左右13.5%ずつが実質
  // 何も描かれていない余白で、見た目の舞台の端はbox中央から約511pxの
  // 位置にある。画像自体は加工しない方針のため、この511pxをJS側の定数として
  // 補正する)。見た目の舞台の端に袖の内側の端がちょうど揃う位置を計算し、
  // 画面が舞台より狭い(=はみ出す)間はmax(0px, ...)で0に丸められて従来通り
  // 画面端に張り付き、画面が広くなった分だけ袖が見た目の舞台の端にくっついてくる。
  const STAGE_VISIBLE_HALF_WIDTH = 410;
  const sideEdgeGap = `max(0px, calc(50% - ${STAGE_VISIBLE_HALF_WIDTH}px - ${sideWidthPx}px))`;

  return (
    <div ref={rootRef} className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0d0a1a]">
      {/* 舞台は加工していない元画像(stage-bg-2.png、大喜利素材2の舞台紫.pngそのまま)
          をそのまま使う。切り抜きやアルファ処理はせず、配置だけをCSSで行う。
          画面幅いっぱい(100vw)にすると、幅基準のobject-coverの拡大率が画面幅
          によって変わってしまい、広い画面ほど舞台が大きく見えてしまうため、
          幅も固定px(max-w-[420px])にしてスマホサイズから大きくならないようにする。
          観客シルエット(AudienceLayer, fixedBottomPx=-22, h-56=224px)が画面下部の
          ほぼ同じ範囲をより手前(高いz-index)で覆ってしまい、bottom-0のままだと
          舞台が完全に観客の裏に隠れて見えなくなっていた。観客の範囲より上に
          来るようbottomを大きくしてずらす。 */}
      {/* object-containは画像を欠けさせないための指定で、boxの大きさ(幅・高さ)は
          スマホ/PCどちらでも同じpx固定値(スクロール等では変わらない)。
          幅で拡大率が決まるため、幅を大きくするほど舞台全体が大きくなる。
          box自体の高さは中身(スケール後の画像)にちょうど合わせてあるので、
          余白なく回答席のあたりにbottom位置で合わせている。
          中央寄せは inset-x-0 + mx-auto だと固定幅と衝突して左端に張り付いて
          しまっていたため、left-1/2 + -translate-x-1/2 の確実な中央寄せに変更。 */}
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
      {/* side-left-crop.png/side-right-crop.pngは左右で同じ最終サイズ(265×1020)に
          揃え、外側の端(左袖は左端、右袖は右端)の余白をゼロにして画面端にぴったり
          付くようにしたもの。 */}
      <div
        className="absolute bottom-[242px]"
        style={{ width: sideWidthPx, height: sideHeightPx, left: sideEdgeGap }}
      >
        <Image
          src={`${BASE_PATH}/images/live2/side-left-crop.png`}
          alt=""
          fill
          sizes="300px"
          className="object-contain object-left-top"
        />
      </div>
      {/* 右袖は別素材(side-right-crop.png)を使うと大きさが左右で微妙に揃わず
          何度調整しても差が出ていたため、左袖の画像をそのまま左右反転させて
          右側に置く。同じ画像を使うことで左右対称になることが保証される。
          外枠(box)は左袖と同じ高さ・伸び方(scale(1, sideScaleY))のまま右端に
          配置し、画像自体だけをscaleX(-1)で鏡写しにする(boxごと反転させると
          回転の中心がずれて画面外にはみ出てしまうため、画像側だけ反転させる)。 */}
      <div
        className="absolute bottom-[242px]"
        style={{ width: sideWidthPx, height: sideHeightPx, right: sideEdgeGap }}
      >
        <Image
          src={`${BASE_PATH}/images/live2/side-left-crop.png`}
          alt=""
          fill
          sizes="300px"
          className="-scale-x-100 object-contain object-left-top"
        />
      </div>
    </div>
  );
}
