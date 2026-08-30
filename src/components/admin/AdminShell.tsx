// 運営者専用管理画面(/admin配下・司会コンソール)共通のページ全体ラッパー。
// 背景は薄いグレーで統一し、PCでの操作を優先して一覧系ページは横幅を広めに取る。
// 外側でbg-gray-50をビューポート全幅に敷き、内側だけをmax-widthで中央寄せすることで、
// 画面が広い（PC）場合でも左右に白い余白が出ないようにしている。
export default function AdminShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-svh w-full bg-gray-50">
      <div
        className={`mx-auto flex w-full flex-col gap-4 px-4 py-6 text-left font-sans sm:px-6 lg:px-8 ${
          wide ? "max-w-4xl" : "max-w-2xl"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
