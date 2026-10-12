import type { Metadata } from "next";
import Link from "next/link";

import LegalPageLayout, { LegalSection } from "@/components/legal/LegalPageLayout";
import { CONTACT_EMAIL, CONTACT_MAILTO, OPERATOR_NAME } from "@/lib/legalInfo";

export const metadata: Metadata = {
  title: "お問い合わせ｜爆笑スタジアム",
};

// お問い合わせページ。認証不要で誰でも閲覧できる公開サポートページ
// （src/lib/publicSupportPaths.ts。純正アプリの方針配信RPCが返すcontact_urlの遷移先）。
// 利用規約・プライバシーポリシーと同じ文書画面（LegalPageLayout）で、連絡先は
// src/lib/legalInfo.tsのCONTACT_EMAIL/CONTACT_MAILTOだけを正として使う。
// 問い合わせフォーム・DB保存・認証処理は持たない（メールでの連絡のみ）。
export default function ContactPage() {
  return (
    <LegalPageLayout title="お問い合わせ" updatedLabel={<>運営上の表示名：{OPERATOR_NAME}</>}>
      <p className="font-sans text-base leading-7 text-gray-900">
        「爆笑スタジアム」に関するご質問・不具合のご報告・その他のお問い合わせは、以下のメールアドレスまでご連絡ください。
      </p>

      <LegalSection id="contact-email" heading="お問い合わせ先">
        <p>
          メールアドレス：
          <a href={CONTACT_MAILTO} className="ml-1 break-all text-blue-800 underline underline-offset-2">
            {CONTACT_EMAIL}
          </a>
        </p>
      </LegalSection>

      <LegalSection id="do-not-send" heading="メールに書かないでください">
        <p>
          パスワード、認証コード、アクセストークンその他の認証情報は、メールに書かないでください。運営がこれらの送付をお願いすることはありません。
        </p>
      </LegalSection>

      <LegalSection id="account-deletion-guide" heading="アカウントの削除をご希望の方">
        <p>
          アカウントの削除については、
          <Link href="/account-deletion" className="text-blue-800 underline underline-offset-2">
            アカウント削除のご案内
          </Link>
          をご覧ください。
        </p>
      </LegalSection>

      <LegalSection id="related-documents" heading="関連する文書">
        <ul className="list-disc pl-5">
          <li>
            <Link href="/terms" className="text-blue-800 underline underline-offset-2">
              利用規約
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="text-blue-800 underline underline-offset-2">
              プライバシーポリシー
            </Link>
            （お問い合わせでお預かりする情報の取扱いを含みます）
          </li>
        </ul>
      </LegalSection>
    </LegalPageLayout>
  );
}
