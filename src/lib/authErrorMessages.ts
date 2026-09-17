// Supabase Authのエラー（AuthError.code）を、生のエラー文言・OAuthプロバイダーの
// 生エラーを一切画面に出さずに済むよう、日本語の案内文へ変換する共通関数。
//
// 背景（2026-09-16、複数プロバイダー対応）：Apple/Googleの連携・ログインでは、
// 「既に別アカウントへ連携済みのApple/Googleでログインしようとした」
// 「連携解除できるIDが最後の1つしかない」等、X単体運用では存在しなかった
// 失敗パターンが増える。これらをそのままエラーオブジェクトとして表示すると
// 内部実装が透けて見えるため、既知のcodeだけを個別に日本語へ変換し、
// 未知のcodeは一律の汎用メッセージに丸める（生のmessage/codeは
// console.warnにのみ出し、画面へは絶対に渡さない）。
const KNOWN_AUTH_ERROR_MESSAGES: Partial<Record<string, string>> = {
  identity_already_exists:
    "このアカウントは既に別の大喜利道場アカウントに連携済みです。連携するには、先にそちらのアカウントで連携を解除してください。",
  single_identity_not_deletable:
    "最後のログイン方法は解除できません。先に別のログイン方法を連携してからお試しください。",
  email_conflict_identity_not_deletable:
    "このログイン方法は解除できません。時間をおいて再度お試しください。",
  manual_linking_disabled: "現在この連携機能はご利用いただけません。",
  provider_disabled: "このログイン方法は現在ご利用いただけません。",
  oauth_provider_not_supported: "このログイン方法は現在ご利用いただけません。",
  anonymous_provider_disabled: "ゲスト参加は現在ご利用いただけません。",
  bad_oauth_state: "ログイン処理に失敗しました。もう一度お試しください。",
  bad_oauth_callback: "ログイン処理に失敗しました。もう一度お試しください。",
  identity_not_found: "指定されたログイン方法が見つかりませんでした。",
  user_banned: "このアカウントはご利用いただけません。",
};

const DEFAULT_AUTH_ERROR_MESSAGE = "ログイン処理に失敗しました。時間をおいて再度お試しください。";

// {code, message}の形（Supabase AuthErrorおよびOAuthコールバックのURLパラメータ
// から組み立てたもの）を受け取り、安全な日本語メッセージへ変換する。
export function mapAuthErrorToMessage(error: { code?: string | null } | null | undefined): string {
  if (!error?.code) return DEFAULT_AUTH_ERROR_MESSAGE;
  return KNOWN_AUTH_ERROR_MESSAGES[error.code] ?? DEFAULT_AUTH_ERROR_MESSAGE;
}
