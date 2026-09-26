import { isUuid } from "./uuid";

export type AuthorLookupStatus = "loading" | "found" | "not-found" | "error";

// 演者情報の取得状態。取得が終わる前は「読み込み中」（not-foundにしない）、
// UUIDでないIDはAPIを呼ばずnot-found、通信・DBエラーは「存在しない」と区別してerror。
export function deriveAuthorLookupStatus(p: {
  authorId: string;
  hasInfo: boolean; // ダミー投稿者またはキャッシュ済みの実ユーザー情報がある
  attempt: { id: string; result: "ok" | "error" } | null;
}): AuthorLookupStatus {
  if (p.hasInfo) return "found";
  if (!isUuid(p.authorId)) return "not-found";
  if (p.attempt?.id !== p.authorId) return "loading";
  return p.attempt.result === "error" ? "error" : "not-found";
}
