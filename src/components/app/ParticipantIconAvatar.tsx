import { getAvatarIconSrc, getAvatarSilhouetteSrc } from "@/lib/avatarIcons";
import { getLimitedIconSrc } from "@/lib/limitedIcons";
import {
  getParticipantAvatarColor,
  getParticipantAvatarIconSrc,
  getParticipantAvatarSilhouetteSrc,
} from "@/lib/participantAvatar";

import AvatarGlyph from "./AvatarGlyph";

// 自分以外の参加者（ボット含む）のアイコン表示。MyIconAvatarと同じ見た目・実装。
// 2026-08-29: Supabase（profiles.avatar_icon/avatar_color、participant_display_names
// RPC経由）に保存された本人の実際の設定をavatarIcon/avatarColorとして渡せば、
// それを使う。渡されなかった場合（未取得・該当行が無い場合の保険）だけ、
// participantIdから決定的に選ぶハッシュベースの絵柄・色（src/lib/participantAvatar.ts）
// にフォールバックする。既存のInitialAvatar（頭文字＋グラデーション円）の置き換え：
// 「ボットのアイコンも編集画面にあるどれかのアイコンと色にしてほしい」の要望対応。
// bare=trueの場合は円形の背景・枠を出さず、線画そのものを表示する。
export default function ParticipantIconAvatar({
  participantId,
  avatarIcon,
  avatarColor: avatarColorOverride,
  equippedLimitedIconSlug,
  size = 32,
  bare = false,
}: {
  participantId: string;
  avatarIcon?: string;
  avatarColor?: string;
  // 2026-09-27（初期ライブ限定アイコン）：participant_display_names/sns_author_names
  // RPCが返すequipped_limited_icon_slugをそのまま渡す。指定されていれば通常アイコンより
  // 優先してフルカラー表示する（呼び出し元がこの値を取得していない場合は従来どおり）。
  equippedLimitedIconSlug?: string | null;
  size?: number;
  bare?: boolean;
}) {
  const avatarColor = avatarColorOverride ?? getParticipantAvatarColor(participantId);
  const iconSrc = avatarIcon ? getAvatarIconSrc(avatarIcon) : getParticipantAvatarIconSrc(participantId);
  const silhouetteSrc = avatarIcon
    ? getAvatarSilhouetteSrc(avatarIcon)
    : getParticipantAvatarSilhouetteSrc(participantId);
  const fullColorSrc = getLimitedIconSrc(equippedLimitedIconSlug);

  const glyphSize = bare ? size : size * 0.8;
  const glyph = (
    <AvatarGlyph
      iconSrc={iconSrc}
      silhouetteSrc={silhouetteSrc}
      color={avatarColor}
      size={glyphSize}
      fullColorSrc={fullColorSrc}
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
