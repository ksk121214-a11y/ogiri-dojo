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

// 制定日（施行日）。本規約・本ポリシーが最初に効力を生じた日で、以後変わらない。
export const ENACTED_ON = "2026年9月25日";
// 最終改定日。制定後に内容を変更した場合にのみ設定する（未改定の間はnullのまま
// にし、「制定日と同じ」等の紛らわしい表示を出さない）。
export const LAST_REVISED_ON: string | null = null;

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
export const TERMS_VERSION = "2026-09-25-v1";
export const PRIVACY_VERSION = "2026-09-25-v1";
