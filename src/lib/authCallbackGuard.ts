// /auth/callback（Xログイン）で、セッションを「Xログイン成功」として扱ってよいかの判定。
//
// 背景：ゲスト観客ボタンからXログインへ切り替える際、OAuth開始前に匿名セッションを
// signOut()する実装をやめた（2026-09-27、ゲスト番号増殖バグの修正）。そのため、
// このページへ到達した時点でまだ古い匿名セッションが残っている（URLのフラグメントに
// 含まれるアクセストークンの検出・保存がまだ完了していない）ことがあり得る。
// 「セッションが存在する」だけでは成功と判定せず、非匿名（Xアカウント）の
// セッションであることを確認できた場合だけ成功として扱う。
export function isSignedInWithX(session: { user?: { is_anonymous?: boolean } } | null | undefined): boolean {
  return !!session && session.user?.is_anonymous !== true;
}
