"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useSnsStore } from "@/store/useSnsStore";

const MAX_LENGTH = 60;

// お題投稿フォーム。投稿後は詳細ページに遷移し、そのまま回答一覧（0件）が見える状態になる。
export default function SnsNewTopicPage() {
  const router = useRouter();
  const addTopic = useSnsStore((s) => s.addTopic);
  const [body, setBody] = useState("");

  const overLimit = body.length > MAX_LENGTH;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || overLimit) return;
    const topic = addTopic(trimmed);
    router.push(`/sns/${topic.id}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          NEW TOPIC
        </p>
        <h1 className="mt-1 font-brush text-3xl text-dojo-dark-brown sm:text-4xl">
          お題を出す
        </h1>
        <p className="mt-2 font-sans text-xs text-dojo-dark-brown">
          みんなに回答してもらうお題を投稿します（ダミー投稿・この端末内のみ反映されます）
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-5 sm:p-6"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="お題の文章を入力...（例：師匠に弟子入りしたら、まさかの修行内容だった。何をさせられた？）"
          rows={4}
          className={`w-full rounded-lg border bg-dojo-tatami-cream p-3 font-sans text-sm text-dojo-ink outline-none ${
            overLimit
              ? "border-dojo-curtain-red focus:border-dojo-curtain-red"
              : "border-dojo-dark-brown/25 focus:border-dojo-curtain-gold"
          }`}
        />
        <div className="flex items-center justify-between">
          <span
            className={`font-sans text-xs ${overLimit ? "font-bold text-dojo-curtain-red" : "text-dojo-dark-brown"}`}
          >
            {body.length} / {MAX_LENGTH}
          </span>
        </div>
        <button
          type="submit"
          disabled={!body.trim() || overLimit}
          className="w-full rounded-full bg-dojo-curtain-red px-6 py-3 font-sans text-sm font-bold text-dojo-washi-white shadow-[0_0_20px_rgba(192,38,63,0.35)] transition hover:bg-dojo-deep-crimson active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          投稿する
        </button>
      </form>
    </div>
  );
}
