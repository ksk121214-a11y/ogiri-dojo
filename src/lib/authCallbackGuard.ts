// /auth/callback（Xログイン）で、セッションを「Xログイン成功」として扱ってよいかの判定。
//
// 背景：ゲスト観客ボタンからXログインへ切り替える際、OAuth開始前に匿名セッションを
// signOut()する実装をやめた（2026-09-27、ゲスト番号増殖バグの修正）。そのため、
// コールバックの処理中にも古い匿名セッションが残っていることがあり得る。
// 「セッションが存在する」だけでは成功と判定せず、匿名ではない（非匿名の）セッションを
// 確認できた場合だけ成功として扱う。
//
// 注意：この関数はprovider（X）そのものを検査していない。/auth/callbackはXのOAuth戻り先
// としてだけ使われるため、そこで得た非匿名セッションをXアカウントのものとみなす。
// provider文字列の推測による判定は、実際のX応答で確認するまで追加しない。
export interface AuthSessionLike {
  access_token?: string;
  user?: { is_anonymous?: boolean } | null;
}

export function isNonAnonymousSession(session: AuthSessionLike | null | undefined): boolean {
  return !!session && session.user?.is_anonymous !== true;
}
