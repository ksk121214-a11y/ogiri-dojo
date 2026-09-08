"use client";

// 運営者専用管理画面(/admin配下・司会コンソール)共通のページ全体ラッパー。
// 背景は薄いグレーで統一し、PCでの操作を優先して一覧系ページは横幅を広めに取る。
// 外側でbg-gray-50をビューポート全幅に敷き、内側だけをmax-widthで中央寄せすることで、
// 画面が広い（PC）場合でも左右に白い余白が出ないようにしている。
//
// text-gray-900をここで明示しているのは、body（グローバルレイアウト）の
// colorが公開サイトの暗い舞台背景向けに薄いクリーム色(--foreground)に
// 設定されており、それを何も指定していないinput/select/textarea等が
// color: inheritでそのまま引き継いでしまい、白い入力欄の中の文字が
// 薄くて読みにくくなっていたため。ここで濃い文字色を明示することで、
// 配下の要素（自身で色を指定していないものすべて）に正しく継承させる。
import { useLiveHostStore } from "@/store/useLiveHostStore";

export default function AdminShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  // 2026-09-09（司会コンソール以外への移動でライブ進行が止まる問題への対応）：
  // ライブ進行(useLiveHostStore.init()のsetInterval + Realtime購読)は、
  // RootLayoutに常駐するHostProgressControllerがisHostである間ずっと動かして
  // おり、/live/host以外の管理画面（/admin/*）へ移動しても止まらない。ただし、
  // ブラウザタブそのものを閉じる・PCがスリープする等、JS実行自体が止まるケースは
  // カバーできない（サーバー側の完全自動進行ではないため）。/admin配下・
  // 司会コンソールいずれの画面でも、進行中のライブがある間はこの注意文を出す。
  const hasProgressingLive = useLiveHostStore((s) => s.live !== null);

  return (
    <div className="min-h-svh w-full bg-gray-50 text-gray-900">
      <div
        className={`mx-auto flex w-full flex-col gap-4 px-4 py-6 text-left font-sans sm:px-6 lg:px-8 ${
          wide ? "max-w-4xl" : "max-w-2xl"
        }`}
      >
        {hasProgressingLive && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ライブ進行中は管理画面を開いておいてください。ブラウザを閉じたりPCをスリープすると進行が停止する可能性があります。
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
