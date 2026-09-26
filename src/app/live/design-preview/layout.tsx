import { notFound } from "next/navigation";

// 開発用のモック画面。本番ビルドでは存在しない画面（404）にする。
export default function DevOnlyLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <>{children}</>;
}
