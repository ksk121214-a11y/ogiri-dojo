// 複数ログイン方法（X / Google / Apple）を横断して扱うための共通定義。
//
// 背景（2026-09-16、複数プロバイダー対応）：Google/AppleはSupabase・Google Cloud・
// Apple Developer側の本番設定（Client ID/Secret、Callback URL等）が揃うまでは
// 実際にOAuthを開始してもエラーにしかならない。設定が整うまで本番ユーザーへ
// 壊れたボタンを見せないよう、環境変数による機能フラグで表示自体を止められる
// ようにする（コードは常に存在させ、フラグをtrueにするだけで有効化できる）。
//
// NEXT_PUBLIC_*はビルド時にクライアントバンドルへ埋め込まれる値であり、
// 秘密情報ではない（有効/無効の真偽値だけ）。Client Secret等は絶対にここへ
// 置かない（サーバー側のSupabase Auth設定にのみ保存する）。
export type AuthProviderId = "x" | "google" | "apple";

export const AUTH_PROVIDER_LABELS: Record<AuthProviderId, string> = {
  x: "X",
  google: "Google",
  apple: "Apple",
};

function isEnvFlagOn(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

// Xとゲスト観戦は既存機能なので常に有効。Google/Appleは本番の外部設定が
// 完了してから環境変数でオンにする想定（未設定の間はfalseで安全側に倒す）。
export const AUTH_PROVIDER_ENABLED: Record<AuthProviderId, boolean> = {
  x: true,
  google: isEnvFlagOn(process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN),
  apple: isEnvFlagOn(process.env.NEXT_PUBLIC_ENABLE_APPLE_LOGIN),
};

export function listEnabledAuthProviders(): AuthProviderId[] {
  return (Object.keys(AUTH_PROVIDER_ENABLED) as AuthProviderId[]).filter(
    (id) => AUTH_PROVIDER_ENABLED[id],
  );
}
