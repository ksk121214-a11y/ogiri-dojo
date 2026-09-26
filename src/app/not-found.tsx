import Link from "next/link";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";

export default function NotFound() {
  return (
    <StadiumPageShell contentTheme="dark">
      <div className={`${stadiumStyles.surfaceLight} flex flex-col items-center gap-3 p-8 text-center`}>
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--ink)]/80">404</p>
        <h1 className="font-sans text-2xl font-black text-[var(--ink)]">ページが見つかりません</h1>
        <p className="font-sans text-sm text-[var(--ink)]/90">
          URLが間違っているか、ページが移動・削除された可能性があります。
        </p>
        <Link
          href="/"
          className={`${stadiumStyles.pressable} ${stadiumStyles.surfaceAccent} rounded-xl px-6 py-2.5 font-sans text-sm font-bold text-[var(--paper)]`}
        >
          ホームへ戻る
        </Link>
      </div>
    </StadiumPageShell>
  );
}
