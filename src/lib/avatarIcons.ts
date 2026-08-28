// マイページ・寄合帳アイコン（大喜利ライブの舞台アイコンと共通の線画）で選べる絵柄プリセット。
// 「素顔（default）」が従来からの唯一の絵柄、それ以外は大喜利素材2に追加された6種類。
// 各絵柄は2枚の画像からなる：
// ・src（線画のみ不透明・それ以外は透明）：選んだ色（avatarColor）で線を塗るためのマスク。
// ・silhouetteSrc（円の内側全体が不透明・円の外側だけ透明）：円の中の「白い部分」を
//   透過させず、白いシルエットとして塗るための下敷きマスク。
//   2026-08-29:「アイコンの丸の中の白い部分を背景透過しないでそのまま素材として使って」の
//   要望対応。以前はsrcだけで線を塗る1層構造だったため、線以外の部分（円の中の背景）は
//   透明のままで下の背景（ライブ舞台の暗い色等）が透けて見えていた。
export const AVATAR_ICON_PRESETS = [
  {
    id: "default",
    label: "素顔",
    src: "/images/live2/avatar-2-line-mask.png",
    silhouetteSrc: "/images/live2/avatar-2-silhouette.webp",
  },
  {
    id: "afro",
    label: "アフロ",
    src: "/images/live2/avatar-afro-mask.webp",
    silhouetteSrc: "/images/live2/avatar-afro-silhouette.webp",
  },
  {
    id: "mohawk",
    label: "モヒカン",
    src: "/images/live2/avatar-mohawk-mask.webp",
    silhouetteSrc: "/images/live2/avatar-mohawk-silhouette.webp",
  },
  {
    id: "suit",
    label: "スーツ",
    src: "/images/live2/avatar-suit-mask.webp",
    silhouetteSrc: "/images/live2/avatar-suit-silhouette.webp",
  },
  {
    id: "rakugo",
    label: "着物",
    src: "/images/live2/avatar-rakugo-mask.webp",
    silhouetteSrc: "/images/live2/avatar-rakugo-silhouette.webp",
  },
  {
    id: "clown",
    label: "ピエロ",
    src: "/images/live2/avatar-clown-mask.webp",
    silhouetteSrc: "/images/live2/avatar-clown-silhouette.webp",
  },
  {
    id: "shirtless",
    label: "上半身裸",
    src: "/images/live2/avatar-shirtless-mask.webp",
    silhouetteSrc: "/images/live2/avatar-shirtless-silhouette.webp",
  },
] as const;

export type AvatarIconId = (typeof AVATAR_ICON_PRESETS)[number]["id"];

export const DEFAULT_AVATAR_ICON_ID: AvatarIconId = "default";

// 未知のid（旧データ・破損データ）が渡ってきても必ず何かしらの画像を返す。
export function getAvatarIconSrc(id: string | undefined): string {
  return (
    AVATAR_ICON_PRESETS.find((preset) => preset.id === id)?.src ?? AVATAR_ICON_PRESETS[0].src
  );
}

export function getAvatarSilhouetteSrc(id: string | undefined): string {
  return (
    AVATAR_ICON_PRESETS.find((preset) => preset.id === id)?.silhouetteSrc ??
    AVATAR_ICON_PRESETS[0].silhouetteSrc
  );
}
