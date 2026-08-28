"use client";

import { BASE_PATH } from "@/lib/basePath";
import { getParticipantAvatarColor, getParticipantAvatarIconSrc } from "@/lib/participantAvatar";

// 自分以外の参加者（ボット含む）のアイコン表示。MyIconAvatarと同じ見た目・実装だが、
// useUserStoreではなくparticipantIdから決定的に選んだ絵柄・色を使う
// （参照: src/lib/participantAvatar.ts）。既存のInitialAvatar（頭文字＋グラデーション円）の
// 置き換え：「ボットのアイコンも編集画面にあるどれかのアイコンと色にしてほしい」の要望対応。
// bare=trueの場合は円形の背景・枠を出さず、線画そのものを表示する。
export default function ParticipantIconAvatar({
  participantId,
  size = 32,
  bare = false,
}: {
  participantId: string;
  size?: number;
  bare?: boolean;
}) {
  const avatarColor = getParticipantAvatarColor(participantId);
  const iconSrc = getParticipantAvatarIconSrc(participantId);

  const glyphSize = bare ? size : size * 0.8;
  const glyph = (
    <span
      aria-hidden
      style={{
        display: "block",
        width: glyphSize,
        height: glyphSize,
        backgroundColor: avatarColor,
        WebkitMaskImage: `url(${BASE_PATH}${iconSrc})`,
        maskImage: `url(${BASE_PATH}${iconSrc})`,
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
