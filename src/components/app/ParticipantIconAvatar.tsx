import {
  getParticipantAvatarColor,
  getParticipantAvatarIconSrc,
  getParticipantAvatarSilhouetteSrc,
} from "@/lib/participantAvatar";

import AvatarGlyph from "./AvatarGlyph";

// 自分以外の参加者（ボット含む）のアイコン表示。MyIconAvatarと同じ見た目・実装だが、
// useUserStoreではなくparticipantIdから決定的に選んだ絵柄・色を使う
// （参照: src/lib/participantAvatar.ts）。既存のInitialAvatar（頭文字＋グラデーション円）の
// 置き換え：「ボットのアイコンも編集画面にあるどれかのアイコンと色にしてほしい」の要望対応。
// 2026-08-29: 円の中の白い部分を透過させない2層描画（AvatarGlyph）に統一した。
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
  const silhouetteSrc = getParticipantAvatarSilhouetteSrc(participantId);

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
