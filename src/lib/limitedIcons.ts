// 初回本番ライブ(#0001)限定アイコンのカタログ。src/lib/avatarIcons.tsの通常アイコンとは
// 別物で、CSS maskで単色化せずフルカラーのまま表示する（供給元の全色付きPNGを
// そのまま使う、supabase/migrations/0081参照）。現状は1種類のみ。
export const LIMITED_ICON_PRESETS = [
  {
    slug: "first-witness",
    label: "初回ライブ限定アイコン",
    src: "/images/live2/limited-first-witness-512.png",
  },
] as const;

export type LimitedIconSlug = (typeof LIMITED_ICON_PRESETS)[number]["slug"];

export function getLimitedIconSrc(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return LIMITED_ICON_PRESETS.find((p) => p.slug === slug)?.src ?? null;
}

export function getLimitedIconLabel(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return LIMITED_ICON_PRESETS.find((p) => p.slug === slug)?.label ?? null;
}
