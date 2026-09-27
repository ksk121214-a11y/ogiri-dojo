// 参加者用ライブ画面（/live、司会コンソール/live/hostや/live-demo等は含まない）かどうか。
// trailingSlash設定（next.config.ts）により本番URLは"/live/"になる。
export function isLiveParticipantPath(pathname: string): boolean {
  return pathname === "/live" || pathname === "/live/";
}
