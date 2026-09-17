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

// SupabaseのProvider型（"x"|"google"|"apple"|...）に対する、このアプリが
// 実際に扱う3種類だけの対応表。useAuthStore.ts（linkIdentity/signInWithOAuth）と
// linkFlowVerification.ts（連携後にどのproviderのidentityが増えたかの照合）の
// 両方から参照する共有の正データ。
export const SUPABASE_PROVIDER_VALUE: Record<AuthProviderId, "x" | "google" | "apple"> = {
  x: "x",
  google: "google",
  apple: "apple",
};

// 2026-09-18（複数プロバイダー対応レビュー再修正・項目5）：判定ロジック自体は
// 環境変数を直接読まない純粋関数にし、テストが実際のprocess.envやモジュール
// キャッシュに触れずに任意の入力パターン（未設定/"true"/"1"/"false"/"0"/
// 大文字/不正値の組み合わせ）を検証できるようにする。
// 仕様：小文字の"1"または"true"の場合だけ有効。それ以外（未設定・空文字・
// "0"・"false"・大文字混じりの"True"/"TRUE"・その他の不正値）はすべて
// 安全側（無効）に倒す。
export function isProviderFlagOn(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export interface AuthProviderEnvFlags {
  google: string | undefined;
  apple: string | undefined;
}

export function computeAuthProviderEnabled(env: AuthProviderEnvFlags): Record<AuthProviderId, boolean> {
  return {
    // Xとゲスト観戦は既存機能なので常に有効（環境変数では制御しない）。
    x: true,
    google: isProviderFlagOn(env.google),
    apple: isProviderFlagOn(env.apple),
  };
}

export function computeEnabledAuthProviders(env: AuthProviderEnvFlags): AuthProviderId[] {
  const enabled = computeAuthProviderEnabled(env);
  return (Object.keys(enabled) as AuthProviderId[]).filter((id) => enabled[id]);
}

// 実行時に実際に使う値（process.envから1度だけ計算する）。判定ロジック自体の
// テストはcomputeAuthProviderEnabled/computeEnabledAuthProvidersを直接呼ぶため、
// ここでのモジュール読み込み時の1回限りの評価がテストを汚染することはない。
const RUNTIME_ENV_FLAGS: AuthProviderEnvFlags = {
  google: process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN,
  apple: process.env.NEXT_PUBLIC_ENABLE_APPLE_LOGIN,
};

export const AUTH_PROVIDER_ENABLED: Record<AuthProviderId, boolean> = computeAuthProviderEnabled(RUNTIME_ENV_FLAGS);

export function listEnabledAuthProviders(): AuthProviderId[] {
  return computeEnabledAuthProviders(RUNTIME_ENV_FLAGS);
}
