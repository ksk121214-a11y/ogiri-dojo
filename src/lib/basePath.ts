// Vercelでは通常のNext.jsサーバーとしてルートドメイン直下に配信するため、basePathは不要。
// OAuthのredirectTo等、絶対URLを組み立てる箇所は引き続きこの定数を経由しておき、
// 将来サブパス配信が必要になった場合はここだけ変更すればよいようにしてある。
export const BASE_PATH = "";
