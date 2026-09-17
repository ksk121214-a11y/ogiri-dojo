// 2026-09-17（複数プロバイダー対応レビュー修正・項目5）：linkIdentity()の
// OAuthコールバック成功後、マイページへ`?loginMethods=1&link=success`付きで
// 戻ってきた場合に「ログイン方法モーダルを自動で開く／成功表示を出すか」を
// 判定する純粋関数。window.location.searchの解析だけを切り出し、
// URL中の値を信頼して外部の任意URLへ遷移する処理は一切行わない
// （このモジュールは真偽値2つを返すだけで、遷移先は常にアプリ側の固定値）。
export interface LoginMethodsReturnParams {
  shouldOpen: boolean;
  showLinkSuccess: boolean;
}

export function parseLoginMethodsReturnParams(search: string): LoginMethodsReturnParams {
  const params = new URLSearchParams(search);
  const shouldOpen = params.get("loginMethods") === "1";
  const showLinkSuccess = shouldOpen && params.get("link") === "success";
  return { shouldOpen, showLinkSuccess };
}
