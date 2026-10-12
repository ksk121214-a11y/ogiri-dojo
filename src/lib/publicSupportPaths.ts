// 認証確認中・未ログイン・未同意・同意確認エラー中でも常に閲覧できる公開サポートページ
// （利用規約・プライバシーポリシー・お問い合わせ・アカウント削除案内）。
// 純正アプリやストア審査等の外部リンクから直接開かれるため、同意ゲート（ConsentRequiredGate）・
// 同意モーダル（ConsentGateModal）・音声確認（audioRoutes）がこの1箇所の定義を共有する。
//
// 純正アプリ向け方針配信RPC（supabase/migrations/0089のget_client_policy_v1）が返すURLの
// パスと一致させること（src/lib/__tests__/publicSupportPages.check.tsが検査する）。
export const PUBLIC_SUPPORT_PATHS = ["/terms", "/privacy", "/contact", "/account-deletion"] as const;

// usePathname()の値（query・fragmentを含まないパス）を完全一致で判定する。
// next.config.tsはtrailingSlash: trueのため、実際のURL・usePathname()は"/contact/"の形に
// なる（"/contact"は"/contact/"へ308リダイレクトされる）。そのため末尾のスラッシュ1つだけを
// 取り除いてから完全一致で比較する（2026-10-12、実ブラウザで確認）。
// "/contact-x"・"/contact/foo"・"/contact//"のような類似パス・前方一致は許可しない。
export function isPublicSupportPath(pathname: string | null | undefined): boolean {
  if (typeof pathname !== "string") return false;
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (PUBLIC_SUPPORT_PATHS as readonly string[]).includes(normalized);
}
