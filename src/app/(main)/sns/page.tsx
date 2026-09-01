"use client";

import { useState } from "react";

import MyProfileEditModal from "@/components/app/MyProfileEditModal";
import MyStatsModal from "@/components/app/MyStatsModal";
import MyProfileTicket from "@/components/home/MyProfileTicket";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsFeedSection from "@/components/sns/SnsFeedSection";

// SNS簡易版（大喜利SNSの姉妹プロジェクトを道場の世界観に合わせて再構築した簡易版）。
// フィード本体はSnsFeedSectionに切り出し、/mypageの寄合帳セクションと共有している。
// 2026-08-30: ホーム・マイページと同じ地下ライブハウス風デザイン（StadiumPageShell）に統一した
// （寄合帳のアイコン・名前を押すと旧デザインに切り替わってしまう問題への対応）。
// 2026-08-31: 自分のプロフィール表示を、独自の簡易版（SnsMyProfileCard、bioしか編集できず
// 「楽屋で着せ替える」も旧デザインの/backstage-roomへ飛ぶだけだった）から、/mypageと
// 全く同じ実装（MyProfileTicket＋MyProfileEditModal＋MyStatsModal）に置き換えた。
// これにより、寄合帳で自分の名前をタップして辿り着く自分のプロフィール画面が、
// マイページのプロフィール画面と完全に同じ（アイコン・名前・一言コメントをまとめて
// 編集できる）ものになる。
export default function SnsPage() {
  const [statsOpen, setStatsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <StadiumPageShell contentTheme="kraft">
      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">SNS</p>
        <h1 className="mt-1 font-sans text-3xl font-black text-[var(--ink)] sm:text-4xl">
          寄合帳
        </h1>
        <p className="mt-2 font-sans text-xs text-[var(--ink)]/70">
          みんなが出したお題に回答して、いいねやツッコミを送り合う寄合帳
        </p>
      </div>

      <MyProfileTicket onOpenStats={() => setStatsOpen(true)} onOpenEdit={() => setEditOpen(true)} />

      <SnsFeedSection />

      <MyStatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
      {editOpen && <MyProfileEditModal onClose={() => setEditOpen(false)} />}
    </StadiumPageShell>
  );
}
