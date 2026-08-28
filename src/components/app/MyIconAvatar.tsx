"use client";

import { getAvatarIconSrc, getAvatarSilhouetteSrc } from "@/lib/avatarIcons";
import { useUserStore } from "@/store/useUserStore";

import AvatarGlyph from "./AvatarGlyph";

// マイページ・寄合帳・番付表・結果発表など「あなた」のアイコンを表示する箇所で共通利用する。
// 大喜利ライブの舞台で使っている線画アイコン（avatar-2-crop.png）と共通の画像をCSS maskとして使い、
// user.avatarColorで塗ることで「ライブと同じアイコン・色は自分で選べる」を実現している。
// 2026-08-28: user.avatarIcon（絵柄）でマスク画像そのものも複数種類から選べるようにした
// （マイページの編集画面参照）。
// 2026-08-29: 円の中の白い部分を透過させない2層描画（AvatarGlyph）に統一した。
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
  const avatarIcon = useUserStore((s) => s.user.avatarIcon);
  const iconSrc = getAvatarIconSrc(avatarIcon);
  const silhouetteSrc = getAvatarSilhouetteSrc(avatarIcon);

  const glyphSize = bare ? size : size * 0.8;
  const glyph = <AvatarGlyph iconSrc={iconSrc} silhouetteSrc={silhouetteSrc} color={avatarColor} size={glyphSize} />;

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
