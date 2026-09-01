"use client";

import type { ReactNode } from "react";

import Link from "next/link";

import {
  CalendarBellGlyph,
  CalendarGlyph,
  DocumentPencilGlyph,
  DoorEnterGlyph,
  PersonGlyph,
  ScoreBubbleGlyph,
  TrophyGlyph,
} from "@/components/home/icons";
import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import { MAX_ANSWERS_PER_PLAYER } from "@/data/liveDemoData";

// 遊び方ページ。従来はモーダル（TutorialModal、削除済み）で表示していたが、下部ナビ・
// ヒーローの「遊び方を見る」から専用ページへ遷移する形に変更した。
// いただいた参考画像（手順1〜6のチケット風カード＋明るいコンクリート背景）を元にしている。
// 「各組の持ち時間」は当初、実装側のレガシーな値（DEMO_TIMING.answerMs、当時90秒）に
// 合わせて90秒と表記していたが、仕様書.md §1・実バックエンド側のLIVE_ROOM_TIMING.answerMsを
// 確認したところ現行仕様は60秒（2026-08-27改訂）で、DEMO_TIMING側の更新漏れだったと判明。
// DEMO_TIMING.answerMsを60秒に修正した上で、表記も60秒に戻した。
// 「結果発表で貰えるポイント」は、実装（FinalResultScreen.tsxのrankBonus＋ベストアンサー
// ボーナス）が順位に応じたボーナス方式のため、参考画像の「獲得点と同じポイント」から
// その表現に補正している。
export default function HowToPlayPage() {
  return (
    <StadiumPageShell contentTheme="concrete">
      <div>
        <h1 className="font-sans text-4xl font-black text-[var(--ink)]">遊び方</h1>
        <div className="mt-2 h-[3px] w-full bg-[var(--ink)]" aria-hidden />
        <p className="mt-3 font-sans text-sm leading-relaxed text-[var(--ink)]/75">
          開催日時に集まり、参加者と観客に分かれて遊ぶオンライン大喜利ライブ。
        </p>
      </div>

      <StepCard number="1" icon={<CalendarBellGlyph />} title="開催通知を確認">
        開催日時をXなどで告知。時間になったらサイトへ集合。
      </StepCard>

      <StepCard number="2" icon={<DoorEnterGlyph />} title="ライブに参加">
        「ライブに参加」を押して入室。参加者か観客を選びます。
      </StepCard>

      <StepCard number="3" icon={null} title="参加者と観客">
        <div className="flex items-center gap-4">
          <PeopleTag label="参加者" tone="accent" count={3} />
          <div className="h-12 shrink-0 border-l-2 border-dashed border-[var(--ink)]/25" aria-hidden />
          <PeopleTag label="観客" tone="ink" count={5} />
        </div>
        <p className="mt-2">
          参加者：最大15人。舞台に立って回答するほか、自分の組の出番以外は採点も担当。
          観客：人数制限なし。採点はできず、リアクションで観戦する立場です。
        </p>
      </StepCard>

      <StepCard number="4" icon={null} title="5人×3組で勝負">
        <div className="flex items-center gap-3">
          <PeopleTag label="1組" tone="accent" count={2} />
          <PeopleTag label="2組" tone="accent" count={2} />
          <PeopleTag label="3組" tone="accent" count={2} />
        </div>
        <p className="mt-2">各組60秒。5人が回答し、残り10人が審査員。</p>
      </StepCard>

      <StepCard number="5" icon={null} title="回答・採点">
        <div className="flex items-center gap-3">
          <DocumentPencilGlyph className="shrink-0 text-[var(--ink)]" />
          <ScoreBubbleGlyph className="shrink-0 text-[var(--ink)]" />
        </div>
        <p className="mt-2">
          回答者は1題につき最大{MAX_ANSWERS_PER_PLAYER}回答。審査員は各回答を0〜3点で採点。
        </p>
      </StepCard>

      <StepCard number="6" icon={<TrophyGlyph />} title="結果発表">
        3組終了後に順位発表。順位に応じたボーナスポイントを獲得。
      </StepCard>

      <Link
        href="/live-schedule"
        className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl px-5 font-sans text-xl font-bold text-[var(--paper)] transition hover:opacity-90`}
      >
        <CalendarGlyph />
        次回のライブを見る
        <span aria-hidden>›</span>
      </Link>
    </StadiumPageShell>
  );
}

function StepCard({
  number,
  icon,
  title,
  children,
}: {
  number: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`${stadiumStyles.stepTicket} ${stadiumStyles.grainPaper} flex items-start gap-3 px-5 py-4 text-[var(--ink)]`}>
      <span className="w-9 shrink-0 font-sans text-4xl font-black leading-none text-[var(--accent)]">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          {icon && <span className="shrink-0 text-[var(--ink)]">{icon}</span>}
          <p className="font-sans text-base font-black text-[var(--ink)]">{title}</p>
        </div>
        <div className="mt-1.5 font-sans text-xs leading-relaxed text-[var(--ink)]/75">
          {children}
        </div>
      </div>
    </div>
  );
}

function PeopleTag({
  label,
  tone,
  count,
}: {
  label: string;
  tone: "accent" | "ink";
  count: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span
        className={`rounded-sm px-2 py-0.5 font-sans text-[10px] font-bold text-[var(--paper)] ${
          tone === "accent" ? stadiumStyles.grainAccent : "bg-[var(--ink)]"
        }`}
      >
        {label}
      </span>
      <div className="flex gap-0.5 text-[var(--ink)]">
        {Array.from({ length: count }).map((_, i) => (
          <PersonGlyph key={i} />
        ))}
      </div>
    </div>
  );
}
