import SnsFeedSection from "@/components/sns/SnsFeedSection";
import SnsMyProfileCard from "@/components/sns/SnsMyProfileCard";

// SNS簡易版（大喜利SNSの姉妹プロジェクトを道場の世界観に合わせて再構築した簡易版）。
// フィード本体はSnsFeedSectionに切り出し、/mypageの寄合帳セクションと共有している。
export default function SnsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">SNS</p>
        <h1 className="mt-1 font-brush text-3xl text-dojo-dark-brown sm:text-4xl">
          寄合帳
        </h1>
        <p className="mt-2 font-sans text-xs text-dojo-dark-brown">
          道場の仲間たちが出したお題に回答して、いいねやツッコミを送り合う簡易版SNS（ダミーデータ）
        </p>
      </div>

      <SnsMyProfileCard />

      <SnsFeedSection />
    </div>
  );
}
