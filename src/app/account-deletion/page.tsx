import type { Metadata } from "next";
import Link from "next/link";

import LegalPageLayout, { LegalSection } from "@/components/legal/LegalPageLayout";
import { ACCOUNT_DELETION_MAIL_SUBJECT, CONTACT_EMAIL, OPERATOR_NAME, contactMailtoWithSubject } from "@/lib/legalInfo";

export const metadata: Metadata = {
  title: "アカウント削除のご案内｜爆笑スタジアム",
};

// アカウント削除の案内ページ。認証不要で誰でも閲覧できる公開サポートページ
// （src/lib/publicSupportPaths.ts。純正アプリの方針配信RPCが返す
// account_deletion_request_urlの遷移先）。
// 申請そのものは既存の導線（マイページ→プロフィール編集内の「アカウントの削除を申請する」、
// AccountDeletionRequestModal／create_account_deletion_request）と、既存の削除依頼件名付き
// mailto（legalInfo.tsのACCOUNT_DELETION_MAIL_SUBJECT／contactMailtoWithSubject）だけを
// 案内し、このページ自体は削除フォーム・認証処理・DB書き込みを一切持たない。
// 削除対象・保持される記録の詳細は、プライバシーポリシーの該当項目を正とする（ここで
// 重複して書かない）。
export default function AccountDeletionPage() {
  const deletionMailto = contactMailtoWithSubject(ACCOUNT_DELETION_MAIL_SUBJECT);

  return (
    <LegalPageLayout title="アカウント削除のご案内" updatedLabel={<>運営上の表示名：{OPERATOR_NAME}</>}>
      <p className="font-sans text-base leading-7 text-gray-900">
        「爆笑スタジアム」のアカウントの削除をご希望の方は、以下の方法でお申し込みください。削除は、運営が内容とご本人からのお申し込みであることを確認した上で行います。
      </p>

      <LegalSection id="in-app" heading="ログインできる方">
        <p>
          ご利用中のアカウントでログインの上、マイページの「編集する」（プロフィール編集）内にある「アカウントの削除を申請する」から申請してください。ログイン中のアカウントに紐づいた申請番号が発行されるため、ご本人からの申請であることを確認しやすく、最も確実な方法です。
        </p>
      </LegalSection>

      <LegalSection id="by-email" heading="ログインできない方・アプリ内から申請できない方">
        <p>以下の窓口へ、件名を「{ACCOUNT_DELETION_MAIL_SUBJECT}」としてメールでご連絡ください。</p>
        <ul className="list-disc pl-5">
          <li>
            受付先：
            <a href={deletionMailto} className="ml-1 break-all text-blue-800 underline underline-offset-2">
              {CONTACT_EMAIL}
            </a>
          </li>
        </ul>
        <p>アプリ内で申請番号が発行されている場合は、その番号を本文にご記載ください。</p>
      </LegalSection>

      <LegalSection id="identity-check" heading="ご本人確認について">
        <p>
          パスワード、認証コード、アクセストークンその他の認証情報は送らないでください。運営がこれらの送付をお願いすることはありません。
        </p>
        <p>
          演者名（表示名）、Xの表示名・ユーザー名、公開プロフィール等、一般に公開されている情報だけを根拠に削除することはありません。
        </p>
        <p>
          メールでお申し込みいただいた場合は、運営から安全な本人確認の方法をご案内し、ご本人であることを確認できた後に処理します。ご本人であることを確認できない場合は、削除のお申し込みにお応えできないことがあります。
        </p>
      </LegalSection>

      <LegalSection id="after-request" heading="削除される情報・保持される記録">
        <p>
          お申し込み後、ただちに削除されるものではありません。削除される情報、削除後も保持される記録、投稿の取扱い等の詳細は、
          <Link href="/privacy#account-deletion" className="text-blue-800 underline underline-offset-2">
            プライバシーポリシー「アカウント削除のご依頼について」
          </Link>
          及び
          <Link href="/privacy#retention" className="text-blue-800 underline underline-offset-2">
            「保存期間と削除／投稿削除とアカウント削除の違い」
          </Link>
          をご覧ください。
        </p>
      </LegalSection>

      <LegalSection id="other-contact" heading="その他のお問い合わせ">
        <p>
          アカウント削除以外のお問い合わせは、
          <Link href="/contact" className="text-blue-800 underline underline-offset-2">
            お問い合わせ
          </Link>
          ページをご覧ください。
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
