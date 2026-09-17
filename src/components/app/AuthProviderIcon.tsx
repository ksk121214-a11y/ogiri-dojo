import type { AuthProviderId } from "@/lib/authProviders";

// 2026-09-17（複数プロバイダー対応レビュー修正・項目7）→2026-09-18（レビュー
// 再修正・項目4）：ログイン方法の一覧・選択ボタンでX/Google/Appleを視覚的に
// 区別するためのロゴ。
//
// - Google：出所不明な手書きSVGパスだった実装を撤回し、Google公式の
//   ブランドガイドライン（https://developers.google.com/identity/branding-guidelines、
//   2026-09-18確認）が配布している署名入りZIP（/static/identity/images/
//   signin-assets.zip）内のSVGをそのまま
//   public/auth-icons/google-g-light-square.svg として同梱し、一切加工せず
//   <img>で読み込む（色・形状の描き直しはしていない）。ボタン自体の文言
//   （「Googleでログイン」）は日本語化のため公式アセット内蔵の英語テキスト
//   付きボタン画像ではなく、テキスト無しの正方形アイコン単体を使い、
//   ボタン文言はこのコンポーネントの外側（LoginMethodModal/
//   LoginMethodsManageModal）でGoogleガイドラインに沿った文字色
//   （#1F1F1F）のテキストとして別途組んでいる。
// - Apple：公式のボタン生成はAppleID.auth（appleid.cdn-apple.com、Apple自身の
//   認証フローに紐づく）経由のみで、静的なロゴSVGとして安全に取得・検証
//   できる公式配布物を確認できなかった（HIGページはスクリプト描画で内容を
//   取得できず、認証済みDeveloperアカウント経由のダウンロード資産にも
//   アクセスできない）。出所を確認できないロゴを描き起こすことはせず、
//   ロゴ無し（テキストのみ）の状態にしている。docs/multi-provider-auth-setup.md
//   に「公式素材導入待ち」と明記済み。NEXT_PUBLIC_ENABLE_APPLE_LOGINが
//   OFFの間はそもそもボタン自体が表示されない。
// - X：既存のボタン意匠（赤背景に文字のみ）を崩さない方針のため、ロゴ画像は
//   使わず、他画面のリスト表示で視覚的な区別だけを付けたい場合向けに
//   最小限の黒地に white "X" の角丸バッジを返す（外部サイトからの画像コピーは
//   行わず、単なる文字＋図形として実装。Xについてはレビュー指摘の対象外）。
export default function AuthProviderIcon({
  provider,
  className,
}: {
  provider: AuthProviderId;
  className?: string;
}) {
  if (provider === "google") {
    // next/imageの最適化はnext.config.tsでunoptimized:trueにしており、
    // 公開ドメイン内の小さな固定SVGなので素の<img>で十分（他の素材画像と同じ扱い）。
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/auth-icons/google-g-light-square.svg"
        alt=""
        aria-hidden="true"
        className={className}
      />
    );
  }

  if (provider === "apple") {
    // 2026-09-18（レビュー再修正・項目4）：出所を確認できる公式ロゴ素材を
    // 導入するまでは、ロゴを描かずテキストのみのボタンにする
    // （docs/multi-provider-auth-setup.md「公式素材導入待ち」参照）。
    return null;
  }

  // provider === "x"：ロゴ画像は使わず、シンプルな黒地に白文字の角丸バッジ。
  return (
    <span
      aria-hidden="true"
      className={`${className ?? ""} inline-flex items-center justify-center rounded bg-black font-black text-white`}
    >
      <span style={{ fontSize: "0.65em", lineHeight: 1 }}>X</span>
    </span>
  );
}
