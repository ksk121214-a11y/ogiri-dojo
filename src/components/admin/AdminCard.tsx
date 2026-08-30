// 運営者専用管理画面共通の白カード。/live/hostのPanelと同じ見た目を切り出し、
// 両方から使い回すことで表記ゆれ・二重実装を防ぐ。
export default function AdminCard({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 ${className}`}>
      {title && <p className="text-xs font-bold text-gray-500">{title}</p>}
      <div className={title ? "mt-1.5" : ""}>{children}</div>
    </div>
  );
}
