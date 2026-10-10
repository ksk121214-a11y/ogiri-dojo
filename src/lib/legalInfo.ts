// 利用規約(/terms)・プライバシーポリシー(/privacy)で共通して使う、運営者名・
// 問い合わせ先・制定日等の確定情報。両ページで別々にハードコードすると表記が
// ずれる恐れがあるため、この1ファイルだけを正とする。
//
// 2026-09-25確定：運営者から正式に受領した情報。実名・住所等、コードから確認
// できない/受領していない情報は書かない（個人情報保護法上の開示請求への対応は
// 別途プライバシーポリギー本文で説明する）。
export const OPERATOR_NAME = "爆笑スタジアム運営";
export const CONTACT_EMAIL = "bakushostadium.contact@gmail.com";
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

// 制定日（施行日）。本規約・本ポリシーが最初に効力を生じた日で、以後変わらない
// （利用規約・プライバシーポリシーは同じ日に制定されたため共通の値を使う）。
export const ENACTED_ON = "2026年9月25日";
// 最終改定日。制定後に内容を変更した場合にのみ設定する（未改定の間はnullのまま
// にし、「制定日と同じ」等の紛らわしい表示を出さない）。
// 2026-09-28（レビュー対応）：利用規約とプライバシーポリシーは改定のタイミングが
// 別々になり得るため、共通の1つの値ではなく文書ごとに分ける（一方だけを改定した
// 時に、改定していない方まで改定表示になってしまうことを防ぐ）。
// 2026-09-28：第8条（投稿内容の権利及び公式SNS等への掲載）を、公式Xアカウントのみ
// から、公式SNS・動画配信サービスへの短尺動画・切り抜き動画掲載まで広げる実質的な
// 改定を行ったため、利用規約もこの回から改定日を持つ（本サイトは既に本番公開済みで
// terms_consentsに実際の同意記録があるため、改定なし扱いにはしない。TERMS_VERSIONも
// 同時に更新しConsentRequiredGateが既存利用者・既存ゲストへ再同意を促す、
// supabase/migrations/0083のcurrent_legal_document_versions参照）。
// 2026-10-10：第6条（ライブ結果へのコメントを本人が削除できるようにする実質改定）
// に伴い、利用規約もこの回から改定日を更新する（本人削除機能なし→ありへの変更。
// supabase/migrations/0088のcurrent_legal_document_versions参照）。
export const TERMS_LAST_REVISED_ON: string | null = "2026年10月10日";
// 2026-09-28（プロフィール公開情報の説明改定に続く2回目の改定）：公式SNS等への
// 掲載対象・目的・利用態様の拡張に伴い、プライバシーポリシーも同日付であわせて
// 改定する（利用規約と同じ改定なので同じ日付を使う）。
// 2026-10-10：保存期間セクション（ライブ結果コメントの本人削除機能追加）に伴い、
// プライバシーポリシーもこの回から改定日を更新する（利用規約と同じ改定なので
// 同じ日付を使う）。
export const PRIVACY_LAST_REVISED_ON: string | null = "2026年10月10日";

// mailtoリンクに件名を付ける場合、日本語件名は必ずencodeURIComponentで
// パーセントエンコードしてからクエリに載せる（生の日本語文字列をURLへ
// そのまま埋め込むと壊れたリンクになるため）。
export function contactMailtoWithSubject(subject: string): string {
  return `${CONTACT_MAILTO}?subject=${encodeURIComponent(subject)}`;
}

// 件名に加えて本文もあらかじめ入力した状態のmailtoリンクを作る（アカウント削除
// 依頼で、パスワード等ではなくアプリ内で発行した削除申請番号だけを本文に自動
// 入力するために使う）。
export function contactMailtoWithSubjectAndBody(subject: string, body: string): string {
  return `${CONTACT_MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const ACCOUNT_DELETION_MAIL_SUBJECT = "爆笑スタジアム アカウント削除依頼";

// 利用規約・プライバシーポリシーの同意バージョン。内容を実質的に変更した場合は
// このバージョン文字列を更新する（terms_consentsテーブルへ記録し、既存ユーザーの
// 再同意が必要かどうかの判定に使う。src/store/useConsentGateStore.ts参照）。
// 2026-09-28：第8条（公式SNS等への掲載）を公式Xアカウントのみから公式SNS・動画
// 配信サービスへの短尺動画掲載まで広げる実質改定に伴い更新。
// 2026-10-10：ライブ結果コメントを本人が削除できるようにする実質改定に伴いさらに
// 更新。supabase/migrations/0088のcurrent_legal_document_versions()と必ず同じ値にする
// （src/lib/__tests__/legalPagesWiring.check.tsが一致を検査する。0083自身の定義は
// 当時の値のまま編集していない）。
export const TERMS_VERSION = "2026-10-10-v3";
// 2026-09-28：プロフィール公開情報の説明改定（v2）に続き、公式SNS等への掲載対象・
// 目的・利用態様の拡張に伴いさらに更新。
// 2026-10-10：ライブ結果コメントを本人が削除できるようにする実質改定に伴いさらに
// 更新。supabase/migrations/0088のcurrent_legal_document_versions()と必ず同じ値にする。
export const PRIVACY_VERSION = "2026-10-10-v4";
