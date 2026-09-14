// /live（src/app/live/page.tsx）の画面分岐のうち、認証・profile取得・live取得の
// 各段階を明示的なローディング状態として扱うために必要な判定を、外部I/Oに
// 依存しない純粋関数として切り出したもの。テストはsrc/lib/__tests__/
// liveGuestAccess.check.ts参照。
//
// 2026-09-13（0070ゲスト参加レビュー対応）：ゲスト判定はuseProfileStoreの
// profile.isGuest（profiles.is_guest由来、DBが最終防御）を使う。profile取得前
// （profileLoading中）に一瞬でも通常の参加画面を出さないよう、authLoading同様に
// 明示的なローディング状態として扱う。liveの取得（liveLoading）が終わるまでは
// live_modeが確定しないため判定を待つ。
//
// 2026-09-13（再々レビュー2回目対応・ゲスト観客の最終仕様確定）：ゲストは本番・
// テストどちらのライブも観客として視聴できる仕様に変更したため、
// 「official-guest-blocked」（認証済みゲストが本番ライブを開いた場合に一律で
// Xログイン案内へ差し替える分岐）を廃止した。isAnonymous/isGuestという
// パラメータ自体は、呼び出し元（/live/page.tsx）が引き続き「ゲストにはプレイヤー
// 希望ボタン等を出さない」といった表示分岐に使うため、この関数のシグネチャからは
// 削除せず残す（resolveLiveScreenGateはもう参照しないが、型としては呼び出し元の
// 互換性のために許容する形にはしない——実引数として渡され続けても無視される）。
export type LiveScreenGate = "auth-loading" | "not-authenticated" | "profile-loading" | "live-loading" | "ready";

export function resolveLiveScreenGate(params: {
  authLoading: boolean;
  isAuthenticated: boolean;
  profileLoading: boolean;
  liveLoading: boolean;
}): LiveScreenGate {
  if (params.authLoading) return "auth-loading";
  if (!params.isAuthenticated) return "not-authenticated";
  if (params.profileLoading) return "profile-loading";
  if (params.liveLoading) return "live-loading";
  return "ready";
}
