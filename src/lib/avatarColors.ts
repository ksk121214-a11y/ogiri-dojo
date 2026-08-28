// マイページ・寄合帳アイコン（大喜利ライブの舞台アイコンと共通の線画）で選べる塗り色プリセット。
// 2026-08-28: 「色は黒赤青緑の四色でいいよ」の要望で8色から4色に絞った。
// 「黒」「赤」はStadiumテーマの基調色（--ink／--accent）とそのまま揃え、他画面と浮かないようにしている。
export const AVATAR_COLOR_PRESETS = [
  { label: "黒", value: "#171513" },
  { label: "赤", value: "#c8320c" },
  { label: "青", value: "#1d5fa8" },
  { label: "緑", value: "#2f7d4f" },
] as const;
