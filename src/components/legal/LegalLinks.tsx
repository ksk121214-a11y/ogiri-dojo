import Link from "next/link";

// ホーム画面下部・Xログイン案内画面・ゲスト観戦選択画面から使う、利用規約・
// プライバシーポリシーへの導線。/terms・/privacyへのリンクだけを持つ小さな部品で、
// 認証状態・既存のログイン/ゲスト参加フロー（useAuthStore等）には一切触れない。
//
// 2026-09-25（再監査対応）：ConsentGateModal（Xログイン・ゲスト参加の直前に
// 表示する同意モーダル）からこのリンクを押すと、モーダルが残ったまま同じタブで
// 遷移してしまい、規約本文がモーダルに覆われて読めなかった。openInNewTabを
// 明示的に渡した場合だけ新しいタブで開くようにし、通常画面（ホーム下部・
// LegalConsentNote等）での動作（同じタブで遷移）は変更しない。
export function LegalLinksRow({
  className = "",
  openInNewTab = false,
}: {
  className?: string;
  openInNewTab?: boolean;
}) {
  const newTabProps = openInNewTab ? ({ target: "_blank", rel: "noopener noreferrer" } as const) : {};
  return (
    <p className={className}>
      <Link href="/terms" className="underline decoration-current/40 underline-offset-2" {...newTabProps}>
        利用規約
      </Link>
      <span className="mx-1.5">・</span>
      <Link href="/privacy" className="underline decoration-current/40 underline-offset-2" {...newTabProps}>
        プライバシーポリシー
      </Link>
    </p>
  );
}

// ログインボタン・ゲスト観戦ボタンの近くに表示する同意文言。
// 2026-09-25（再監査対応）：Xログイン・ゲスト参加は明示的な同意チェック
// （ConsentGateModal／既存ユーザーはConsentRequiredGate）を経て初めて実行される
// ようになったため、単なる継続利用をもって同意済みとみなす旧来の受動的な
// 表現は実態と合わなくなった。明示同意の事実を正確に述べる文言へ統一する
// （terms/page.tsx第1条2項と同じ趣旨）。
export function LegalConsentNote({ className = "" }: { className?: string }) {
  return (
    <p className={className}>
      利用者は、表示された
      <Link href="/terms" className="underline decoration-current/40 underline-offset-2">
        利用規約
      </Link>
      及び
      <Link href="/privacy" className="underline decoration-current/40 underline-offset-2">
        プライバシーポリシー
      </Link>
      を確認し、同意画面で明示的に同意した上で本サービスを利用します。
    </p>
  );
}
