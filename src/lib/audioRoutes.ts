// 音声（BGM確認モーダル・BGM再生・SE事前読み込み）を一切出さない画面。
// 法務文書は読むことが目的、/auth/callbackはログイン処理中のため、音声確認が割り込まない。
const NO_AUDIO_PREFIXES = ["/terms", "/privacy", "/auth/callback"];

export function isNoAudioRoute(pathname: string): boolean {
  return NO_AUDIO_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
