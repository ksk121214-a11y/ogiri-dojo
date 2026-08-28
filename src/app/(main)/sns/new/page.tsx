"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsBackButton from "@/components/sns/SnsBackButton";
import { useSnsStore } from "@/store/useSnsStore";

const MAX_LENGTH = 60;

// お題投稿フォーム。投稿後は寄合帳トップ（新着順の先頭に表示される）に戻る。
// 2026-08-28: マイページ経由（「お題を投稿する」バナー）で来ることがほとんどのため、
// 見た目もマイページと同じ地下ライブハウス風（StadiumPageShell）に統一した。
export default function SnsNewTopicPage() {
  const router = useRouter();
  const addTopic = useSnsStore((s) => s.addTopic);
  const [body, setBody] = useState("");

  const overLimit = body.length > MAX_LENGTH;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || overLimit) return;
    // 静的サイト公開(GitHub Pages)では新規投稿のIDに対応する詳細ページが
    // 事前生成されておらず直接遷移すると404になるため、投稿後は寄合帳トップに戻す。
    addTopic(trimmed);
    router.push("/mypage");
  };

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton
        fallbackHref="/mypage"
        className="w-fit font-sans text-xs font-bold text-[var(--ink)]/70 hover:text-[var(--ink)]"
      />

      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">
          NEW TOPIC
        </p>
        <h1 className="mt-1 font-sans text-3xl font-black text-[var(--ink)]">
          お題を出す
        </h1>
        <p className="mt-2 font-sans text-xs text-[var(--ink)]/70">
          みんなに回答してもらうお題を投稿します（ダミー投稿・この端末内のみ反映されます）
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className={`${stadiumStyles.grainPaper} flex flex-col gap-4 rounded-2xl p-5 shadow-[0_10px_24px_rgba(23,21,19,0.22)] sm:p-6`}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="お題の文章を入力...（例：師匠に弟子入りしたら、まさかの修行内容だった。何をさせられた？）"
          rows={4}
          className={`w-full rounded-lg border bg-[var(--paper-muted)] p-3 font-sans text-sm text-[var(--ink)] outline-none ${
            overLimit
              ? "border-[var(--accent)] focus:border-[var(--accent)]"
              : "border-[var(--ink)]/20 focus:border-[var(--accent)]"
          }`}
        />
        <div className="flex items-center justify-between">
          <span
            className={`font-sans text-xs ${overLimit ? "font-bold text-[var(--accent)]" : "text-[var(--ink)]/60"}`}
          >
            {body.length} / {MAX_LENGTH}
          </span>
        </div>
        <button
          type="submit"
          disabled={!body.trim() || overLimit}
          className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} w-full rounded-xl px-6 py-3 font-sans text-sm font-bold text-[var(--paper)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
        >
          投稿する
        </button>
      </form>
    </StadiumPageShell>
  );
}
