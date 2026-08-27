"use client";

import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";

// 画面上部に常設するアプリタイトルロゴバナー。金の王冠・星、赤い電飾アーチ、
// 紺色のリボンプレート＋白抜き文字「爆笑スタジアム」で構成する（完成図モックアップ準拠）。
// 装飾はSVG＋絵文字で自己完結させ、追加の画像素材には依存しない。
//
// このファイルはlive-demo専用ではなく、本番のlive-room（StageAnsweringView/
// AudienceAnsweringView）と1個目のdesign-previewからも直接importされている
// 共有コンポーネントのため、既存の呼び出し箇所の見た目は一切変えない。
//
// showDecoration: 赤いアーチ＋白い電飾ドットのSVGを表示するか。デザイン確認用画面から
// 一時的に非表示にできるようにするためのpropで、本番(live-room)側は呼び出し側で
// このpropを渡していないため、デフォルトtrueのまま今まで通りの見た目になる。
// scaleUp: sm以上の画面幅でロゴ文字を一段階大きくするか。design-preview側は
// ウィンドウを広げてもスマホサイズの見た目を保ちたいためfalseを渡す
// (本番は何も渡さないためデフォルトtrueのまま今まで通り)。
// showCrown: ★👑★の飾り行を表示するか。design-preview側はお題ボードのために
// 縦スペースを詰めたくfalseを渡す(本番は何も渡さないためデフォルトtrueのまま今まで通り)。
// variant: "neon2"を渡すと、SVG装飾の代わりにdesign-preview-2（隠しURL
// /live/design-preview-2）と同じ電飾バー画像(top-lights-crop.png)一枚に差し替わる。
// 未指定時は"dojo"のまま＝既存呼び出し元は全員今まで通りの見た目（このpropを渡すのは
// live-demoの再スキン済み画面だけ）。
export default function StageHeaderBanner({
  showDecoration = true,
  scaleUp = true,
  showCrown = true,
  variant = "dojo",
}: {
  showDecoration?: boolean;
  scaleUp?: boolean;
  showCrown?: boolean;
  variant?: "dojo" | "neon2";
}) {
  const dotsLeft = Array.from({ length: 6 }, (_, i) => {
    const t = i / 5;
    return { x: 6 + t * 140, y: 58 - t * 40 - Math.sin(t * Math.PI) * 12 };
  });
  const dotsRight = dotsLeft.map((p) => ({ x: 400 - p.x, y: p.y }));

  if (variant === "neon2") {
    return (
      <div className="relative mx-auto w-full max-w-[270px] shrink-0 pt-1 sm:max-w-xs">
        <Image
          src={`${BASE_PATH}/images/live2/top-lights-crop.png`}
          alt="爆笑スタジアム"
          width={1024}
          height={230}
          sizes="400px"
          priority
          className="h-auto w-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex w-full max-w-3xl shrink-0 items-center justify-center pb-1 pt-0.5">
      {showDecoration && (
        <svg
          viewBox="0 0 400 70"
          className="pointer-events-none absolute inset-x-0 top-0 h-full w-full"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M4 58 Q 80 0 150 20"
            stroke="#C0263F"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M396 58 Q 320 0 250 20"
            stroke="#C0263F"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          {dotsLeft.map((p, i) => (
            <circle key={`l-${i}`} cx={p.x} cy={p.y} r="3" fill="#fff8e7" />
          ))}
          {dotsRight.map((p, i) => (
            <circle key={`r-${i}`} cx={p.x} cy={p.y} r="3" fill="#fff8e7" />
          ))}
        </svg>
      )}
      <div className="relative z-10 flex flex-col items-center">
        {showCrown && (
          <div className="mb-0.5 flex items-center gap-1 leading-none text-dojo-curtain-gold">
            <span className="text-[9px]">★</span>
            <span className="text-sm">👑</span>
            <span className="text-[9px]">★</span>
          </div>
        )}
        <div className="rounded-lg border-2 border-dojo-curtain-gold bg-dojo-backstage-navy px-4 py-1 shadow-[0_0_15px_rgba(232,184,76,0.4)]">
          <p
            className={`whitespace-nowrap font-sans text-sm font-black tracking-wide text-dojo-washi-white ${
              scaleUp ? "sm:text-lg" : ""
            }`}
          >
            爆笑スタジアム
          </p>
        </div>
      </div>
    </div>
  );
}
