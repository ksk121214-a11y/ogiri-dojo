"use client";

import Image from "next/image";
import { motion } from "framer-motion";

import { BASE_PATH } from "@/lib/basePath";
import { fitAspect, useElementSize } from "@/lib/useElementSize";

const FLIP_RATIO = 2857 / 2360;

// 審査中の回答表示カード。紺色カード＋枠のデザインをやめ、「手つきフリップ」素材
// （answer-flip.png）を背景にして、その上に回答者名・回答本文を重ねて表示する
// （画像上部の手が邪魔にならないよう、テキスト領域は手の下から開始する）。
export default function AnswerRevealCard({
  authorName,
  answerBody,
  maxWidthClassName = "max-w-sm",
  scaleUp = true,
  fillHeight = false,
  hideAuthorName = false,
}: {
  authorName: string;
  answerBody: string;
  // 呼び出し画面ごとにフリップの大きさを微調整できるようにする（例：舞台視点だけ少し小さく）。
  maxWidthClassName?: string;
  // sm以上の画面幅で回答文字を一段階大きくするか。design-preview側はウィンドウを
  // 広げてもスマホサイズの見た目を保ちたいためfalseを渡す(本番は何も渡さないため
  // デフォルトtrueのまま今まで通り)。
  scaleUp?: boolean;
  // true時は幅基準(maxWidthClassName)ではなく、親要素の高さいっぱいに合わせて
  // アスペクト比から幅を逆算する（お題ボードと入力欄の間を画面サイズに応じて
  // 埋めるためのdesign-preview専用モード。本番は何も渡さないためfalseのまま
  // 今まで通り幅基準になる）。
  fillHeight?: boolean;
  // trueなら回答者名を表示しない（本番/live-room専用のオプション。既定はfalseで
  // 他の呼び出し箇所は今まで通り名前を表示する）。
  hideAuthorName?: boolean;
}) {
  const [boxRef, boxSize] = useElementSize<HTMLDivElement>();
  const fitted = boxSize ? fitAspect(boxSize.width, boxSize.height, FLIP_RATIO) : null;
  // fillHeight時はカード自体が画面サイズに応じて大きく伸縮するため、文字サイズも
  // 固定のTailwindクラスではなくカード幅に比例させる。カードが小さい画面でも
  // 最低限読める大きさは確保する。
  const bodyFontSize = fitted ? Math.max(16, fitted.width * (24 / 336)) : undefined;
  const authorFontSize = fitted ? Math.max(11, fitted.width * (14 / 336)) : undefined;

  return (
    <motion.div
      ref={fillHeight ? boxRef : undefined}
      initial={{ opacity: 0, scale: 0.95, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -12 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={fillHeight ? "relative mx-auto h-full w-full" : `relative mx-auto w-full ${maxWidthClassName}`}
    >
      <div
        className={fillHeight ? "relative mx-auto" : "relative aspect-[2857/2360] w-full"}
        style={
          fillHeight && fitted
            ? { width: fitted.width, height: fitted.height }
            : undefined
        }
      >
        {/* 2026-08-29:「回答フリップ画像が万が一出なかった時」の保険。フリップ画像
            （answer-flip.png）が何らかの理由で読み込めなかった場合、下の回答文字
            （暗い色）がライブ舞台の暗い背景にそのまま乗ってしまい読めなくなるため、
            先に白いカードを敷いておく。画像が正常に表示される場合は、object-containで
            同じアスペクト比のフリップ画像がぴったり重なるため見た目は変わらない。 */}
        <div className="absolute inset-0 rounded-2xl bg-white" aria-hidden />
        <Image
          src={`${BASE_PATH}/images/live/answer-flip.png`}
          alt=""
          fill
          sizes="384px"
          loading="eager"
          fetchPriority="high"
          className="pointer-events-none select-none object-contain"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-[12%] pb-[10%] pt-[22%] text-center">
          {!hideAuthorName && (
            <p
              className="font-sans text-xs text-dojo-gray-purple"
              style={authorFontSize ? { fontSize: authorFontSize } : undefined}
            >
              {authorName}
            </p>
          )}
          <p
            className={`mt-1 font-sans text-lg font-bold leading-snug text-dojo-ink ${
              scaleUp ? "sm:text-xl" : ""
            }`}
            style={bodyFontSize ? { fontSize: bodyFontSize } : undefined}
          >
            {answerBody}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
