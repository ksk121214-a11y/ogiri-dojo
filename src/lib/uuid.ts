// UUID文字列（8-4-4-4-12、バージョン・バリアントは問わない）かどうか。
// PostgRESTのuuid列へ不正な値を渡すと400になるため、APIを呼ぶ前の存在確認に使う。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
