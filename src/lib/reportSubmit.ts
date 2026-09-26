import { isUuid } from "./uuid";

// target_author_id（uuid列）へ渡してよいのは実際のUUIDだけ。"me"・"deleted-user"・
// "author-…"（ダミー）・空文字などの内部用IDはnullにする。
export function reportTargetAuthorId(authorId: string | null | undefined): string | null {
  return authorId && isUuid(authorId) ? authorId : null;
}

// ライブ結果コメント等で、本人の投稿（authorIdが"me"）には通報ボタンを出さない。
export function isOwnAuthorId(authorId: string | null | undefined): boolean {
  return authorId === "me";
}

export type ReportInsertOutcome = "ok" | "duplicate" | "failed";

// 一意制約違反（23505）＝同じ対象を通報済み。それ以外のエラーは通常の失敗（通報済み扱いにしない）。
export function classifyReportInsertError(error: { code?: string | null } | null | undefined): ReportInsertOutcome {
  if (!error) return "ok";
  return error.code === "23505" ? "duplicate" : "failed";
}

export type ReportSubmitResult = "submitted" | "duplicate" | "failed" | "busy";

// 通報送信の状態遷移。送信中は再入不可（busy＝INSERTしない）。成功・DBエラー・例外の
// いずれでも finally でロックを解除するため、失敗後も再試行できる。
export function createReportSubmitter<P>(insert: (payload: P) => Promise<{ error: { code?: string | null } | null }>) {
  let inFlight = false;
  return {
    isSubmitting: () => inFlight,
    async submit(payload: P): Promise<ReportSubmitResult> {
      if (inFlight) return "busy";
      inFlight = true;
      try {
        const { error } = await insert(payload);
        const outcome = classifyReportInsertError(error);
        return outcome === "ok" ? "submitted" : outcome;
      } catch {
        return "failed";
      } finally {
        inFlight = false;
      }
    },
  };
}
