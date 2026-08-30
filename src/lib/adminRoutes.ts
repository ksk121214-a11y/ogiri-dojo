// 運営者専用画面（管理画面・司会コンソール）かどうかの判定。
// BGM/SE（AmbientBgmController・StadiumSfxController）の適用範囲や、
// 今後同様の「一般ユーザー向け演出を出さない」判定で共通利用する。
export function isAdminRoute(pathname: string): boolean {
  // trailingSlash設定やクエリの有無に関わらず判定できるよう前方一致で見る
  // （このアプリには/adminや/live/hostで始まる一般ユーザー向けルートは無い）。
  return pathname.startsWith("/admin") || pathname.startsWith("/live/host");
}
