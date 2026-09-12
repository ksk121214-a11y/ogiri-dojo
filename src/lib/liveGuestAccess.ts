// /live（src/app/live/page.tsx）の画面分岐のうち、「認証済みゲストが本番ライブへ
// 進めないようにする」ために必要な判定だけを、外部I/Oに依存しない純粋関数として
// 切り出したもの。テストはsrc/lib/__tests__/liveGuestAccess.check.ts参照。
//
// 2026-09-13（0070ゲスト参加レビュー対応）：ゲスト判定はuseProfileStoreの
// profile.isGuest（profiles.is_guest由来、DBが最終防御）を使う。profile取得前
// （profileLoading中）に一瞬でも通常の参加画面を出さないよう、authLoading同様に
// 明示的なローディング状態として扱う。liveの取得（liveLoading）が終わるまでは
// live_modeが確定しないため、official/testどちらの判定もしない。
export type LiveScreenGate =
  | "auth-loading"
  | "not-authenticated"
  | "profile-loading"
  | "live-loading"
  | "official-guest-blocked"
  | "ready";

export function resolveLiveScreenGate(params: {
  authLoading: boolean;
  isAuthenticated: boolean;
  profileLoading: boolean;
  liveLoading: boolean;
  liveMode: string | null;
  isGuest: boolean;
}): LiveScreenGate {
  if (params.authLoading) return "auth-loading";
  if (!params.isAuthenticated) return "not-authenticated";
  if (params.profileLoading) return "profile-loading";
  if (params.liveLoading) return "live-loading";
  if (params.isGuest && params.liveMode === "official") return "official-guest-blocked";
  return "ready";
}
