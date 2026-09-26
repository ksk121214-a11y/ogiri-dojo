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
    <div className="min-h-screen bg-white text-gray-900">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="shrink-0 rounded-full border border-gray-300 px-3 py-1.5 font-sans text-xs font-bold text-gray-900 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            ← ホームに戻る
          </Link>
          <p className="truncate font-sans text-xs text-gray-600">爆笑スタジアム</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-sans text-2xl font-bold text-gray-900 sm:text-3xl">{title}</h1>
        <p className="mt-2 font-sans text-sm text-gray-600">{updatedLabel}</p>

        <div className="mt-8 flex flex-col gap-8">{children}</div>

        <div className="mt-10 border-t border-gray-200 pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-4 py-2 font-sans text-sm font-bold text-gray-900 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
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
      <h2 className="font-sans text-lg font-bold text-gray-900 sm:text-xl">{heading}</h2>
      <div className="mt-2 flex flex-col gap-2 font-sans text-base leading-7 text-gray-900">
        {children}
      </div>
    </section>
  );
}

// 長文でも現在位置・各項目を把握しやすいよう、ページ冒頭に置く目次。
export function LegalTableOfContents({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="目次" className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="font-sans text-sm font-bold text-gray-900">目次</p>
      <ol className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 font-sans text-sm text-gray-800 sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="text-blue-800 underline underline-offset-2 hover:text-blue-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
            >
              {i + 1}. {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
