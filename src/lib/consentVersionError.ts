// record_terms_consent_v2（supabase/migrations/0083）がVERSION_MISMATCHで拒否した場合、
// 及び退役させた旧record_terms_consent()がCLIENT_UPDATE_REQUIREDで拒否した場合、生の
// DBエラーコードをそのまま利用者へ見せず、共通の日本語案内へ変換するための純粋関数。
//
// 背景：0083適用と新フロントエンドのデプロイのどちらが先になっても、画面が表示して
// いる版と実際にDBへ記録する版がズレたまま同意行を作らないよう、record_terms_consent_v2は
// クライアントが渡した期待バージョンとDBの現在値が完全一致する場合にだけ記録し、
// 不一致ならVERSION_MISMATCHで拒否する（旧関数はCLIENT_UPDATE_REQUIREDで無条件拒否）。
// この2つのエラーはいずれも「利用者側の落ち度ではなく、アプリの版が古い／規約が
// 更新された」ことを示すため、通信エラー等の汎用メッセージとは区別し、再読み込みを
// 促す案内を出す。
export const CONSENT_VERSION_RELOAD_MESSAGE =
  "規約情報が更新されました。ページを再読み込みして、最新の内容をご確認ください。";

function extractErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

export function isConsentVersionMismatchError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return message.includes("VERSION_MISMATCH") || message.includes("CLIENT_UPDATE_REQUIRED");
}
