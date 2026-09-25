import Link from "next/link";

// 利用規約(/terms)・プライバシーポリシー(/privacy)の共通レイアウト。
// 認証状態を一切参照しない完全に独立したページとして実装している
// （AppHeader/BottomNavigation等の既存コンポーネントに一切依存しない）。
// これにより、未ログイン・ログイン中・ゲストのいずれの状態でも、既存の
// ログイン・ゲスト参加フローに影響を与えることなく必ず開ける。
export default function LegalPageLayout({
  title,
  updatedLabel,
  children,
}: {
  title: string;
  updatedLabel: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-dojo-tatami-cream">
      <header className="sticky top-0 z-10 border-b border-dojo-dark-brown/20 bg-dojo-tatami-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="shrink-0 rounded-full border border-dojo-dark-brown/30 px-3 py-1.5 font-sans text-xs font-bold text-dojo-dark-brown transition hover:bg-dojo-light-brown"
          >
            ← ホームに戻る
          </Link>
          <p className="truncate font-sans text-xs text-dojo-dark-brown/70">爆笑スタジアム</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-sans text-2xl font-black text-dojo-ink sm:text-3xl">{title}</h1>
        <p className="mt-2 font-sans text-xs text-dojo-dark-brown/70">{updatedLabel}</p>

        <div className="mt-8 flex flex-col gap-8">{children}</div>

        <div className="mt-10 border-t border-dojo-dark-brown/20 pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-full border border-dojo-dark-brown/30 px-4 py-2 font-sans text-xs font-bold text-dojo-dark-brown transition hover:bg-dojo-light-brown"
          >
            ← ホームに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}

// 各条・各セクション共通のヘッダー付きブロック。id属性を持たせることで、
// 目次(LegalTableOfContents)からのアンカーリンクで直接その項目まで移動できる。
export function LegalSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="font-sans text-base font-bold text-dojo-ink sm:text-lg">{heading}</h2>
      <div className="mt-2 flex flex-col gap-2 font-sans text-sm leading-relaxed text-dojo-ink/90">
        {children}
      </div>
    </section>
  );
}

// 長文でも現在位置・各項目を把握しやすいよう、ページ冒頭に置く目次。
export function LegalTableOfContents({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="目次" className="rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/40 p-4">
      <p className="font-sans text-xs font-bold text-dojo-dark-brown">目次</p>
      <ol className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 font-sans text-xs text-dojo-dark-brown sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="underline decoration-dojo-dark-brown/40 underline-offset-2 hover:text-dojo-ink"
            >
              {i + 1}. {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
