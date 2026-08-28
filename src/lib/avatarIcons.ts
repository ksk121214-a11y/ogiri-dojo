// マイページ・寄合帳アイコン（大喜利ライブの舞台アイコンと共通の線画）で選べる絵柄プリセット。
// 「素顔（default）」が従来からの唯一の絵柄、それ以外は大喜利素材2に追加された6種類。
// どの画像も「線画のみ不透明・それ以外は透明」なmask画像のため、MyIconAvatar側の
// mask-imageをこのsrcに差し替えるだけでavatarColorの塗り色がそのまま活きる
// （avatarColors.tsと同じ「形と色は独立した2つの選択肢」という設計）。
export const AVATAR_ICON_PRESETS = [
  { id: "default", label: "素顔", src: "/images/live2/avatar-2-line-mask.png" },
  { id: "afro", label: "アフロ", src: "/images/live2/avatar-afro-mask.webp" },
  { id: "mohawk", label: "モヒカン", src: "/images/live2/avatar-mohawk-mask.webp" },
  { id: "suit", label: "スーツ", src: "/images/live2/avatar-suit-mask.webp" },
  { id: "rakugo", label: "着物", src: "/images/live2/avatar-rakugo-mask.webp" },
  { id: "clown", label: "ピエロ", src: "/images/live2/avatar-clown-mask.webp" },
  { id: "shirtless", label: "上半身裸", src: "/images/live2/avatar-shirtless-mask.webp" },
] as const;

export type AvatarIconId = (typeof AVATAR_ICON_PRESETS)[number]["id"];

export const DEFAULT_AVATAR_ICON_ID: AvatarIconId = "default";

// 未知のid（旧データ・破損データ）が渡ってきても必ず何かしらの画像を返す。
export function getAvatarIconSrc(id: string | undefined): string {
  return (
    AVATAR_ICON_PRESETS.find((preset) => preset.id === id)?.src ?? AVATAR_ICON_PRESETS[0].src
  );
}
