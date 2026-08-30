import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsFeedSection from "@/components/sns/SnsFeedSection";
import SnsMyProfileCard from "@/components/sns/SnsMyProfileCard";

// SNS簡易版（大喜利SNSの姉妹プロジェクトを道場の世界観に合わせて再構築した簡易版）。
// フィード本体はSnsFeedSectionに切り出し、/mypageの寄合帳セクションと共有している。
// 2026-08-30: ホーム・マイページと同じ地下ライブハウス風デザイン（StadiumPageShell）に統一した
// （寄合帳のアイコン・名前を押すと旧デザインに切り替わってしまう問題への対応）。
export default function SnsPage() {
  return (
    <StadiumPageShell contentTheme="kraft">
      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">SNS</p>
        <h1 className="mt-1 font-sans text-3xl font-black text-[var(--ink)] sm:text-4xl">
          寄合帳
        </h1>
        <p className="mt-2 font-sans text-xs text-[var(--ink)]/70">
          道場の仲間たちが出したお題に回答して、いいねやツッコミを送り合う簡易版SNS（ダミーデータ）
        </p>
      </div>

      <SnsMyProfileCard />

      <SnsFeedSection />
    </StadiumPageShell>
  );
}
