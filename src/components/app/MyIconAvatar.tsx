"use client";

import { BASE_PATH } from "@/lib/basePath";
import { useUserStore } from "@/store/useUserStore";

// マイページ・寄合帳・番付表・結果発表など「あなた」のアイコンを表示する箇所で共通利用する。
// 大喜利ライブの舞台で使っている線画アイコン（avatar-2-crop.png）と共通の画像をCSS maskとして使い、
// user.avatarColorで塗ることで「ライブと同じアイコン・色は自分で選べる」を実現している。
// 複数箇所で個別に同じ参照ロジックを持つと表示がズレる不具合が過去に起きたため、ここに一本化する。
// bare=trueの場合は円形の背景・枠を出さず、線画そのものを表示する（マイページの演者名カード用）。
export default function MyIconAvatar({
  size = 32,
  bare = false,
}: {
  size?: number;
  bare?: boolean;
}) {
  const avatarColor = useUserStore((s) => s.user.avatarColor);

  const glyphSize = bare ? size : size * 0.8;
  const glyph = (
    <span
      aria-hidden
      style={{
        display: "block",
        width: glyphSize,
        height: glyphSize,
        backgroundColor: avatarColor,
        WebkitMaskImage: `url(${BASE_PATH}/images/live2/avatar-2-line-mask.png)`,
        maskImage: `url(${BASE_PATH}/images/live2/avatar-2-line-mask.png)`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );

  if (bare) {
    return (
      <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
        {glyph}
      </span>
    );
  }

  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-dojo-curtain-gold/60 bg-white"
      style={{ width: size, height: size }}
    >
      {glyph}
    </span>
  );
}
