"use client";

import { useState } from "react";

import { useLiveBotStore } from "@/store/useLiveBotStore";

// 司会コンソール専用：ボット参加者（メール+パスワードの実アカウント）をその場で
// 参加させるためのフォーム。認証情報はこの画面にもコードにも保存されず、
// 送信するたびにメモリ上でのみ扱う（このリポジトリはPublicなためNEXT_PUBLIC_化は厳禁）。
export default function BotSetupPanel({ liveId }: { liveId: string }) {
  const bots = useLiveBotStore((s) => s.bots);
  const loading = useLiveBotStore((s) => s.loading);
  const error = useLiveBotStore((s) => s.error);
  const addBots = useLiveBotStore((s) => s.addBots);
  const [text, setText] = useState("");

  const handleAdd = async () => {
    const credentials = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [email, password] = line.split(",").map((s) => s.trim());
        return { email, password };
      })
      .filter((c) => c.email && c.password);
    if (credentials.length === 0) return;
    await addBots(liveId, credentials);
    setText("");
  };

  return (
    <div className="w-full rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
      <p className="font-sans text-xs font-bold text-dojo-ink">
        ボット参加者（{bots.length}体 参加中）
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={"bot1@example.com,password1\nbot2@example.com,password2"}
        className="mt-2 w-full rounded-lg border border-dojo-dark-brown/25 bg-dojo-washi-white p-2 font-sans text-xs text-dojo-ink outline-none"
      />
      <p className="mt-1 font-sans text-[10px] text-dojo-dark-brown">
        1行に「メールアドレス,パスワード」で入力（複数行可）。この場でのみ使用し、保存はされません。
      </p>
      <button
        type="button"
        onClick={handleAdd}
        disabled={loading}
        className="mt-2 rounded-full bg-dojo-curtain-red px-4 py-2 font-sans text-xs font-bold text-dojo-washi-white disabled:opacity-50"
      >
        {loading ? "参加処理中…" : "ボットを参加させる"}
      </button>
      {error && <p className="mt-1 font-sans text-xs text-dojo-deep-crimson">{error}</p>}
    </div>
  );
}
