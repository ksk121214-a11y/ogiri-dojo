import AppHeader from "@/components/app/AppHeader";

// ホーム/ガチャ/ショップ/ランキング/マイページ共通のレイアウト（簡易ナビゲーション付き）。
// ライブ体験（/live-demo）はフルスクリーン演出のためこのグループの外に置く。
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-dojo-tatami-cream">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
