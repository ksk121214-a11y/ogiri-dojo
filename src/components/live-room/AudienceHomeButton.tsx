"use client";

import Link from "next/link";

import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// 観客としてライブを見ている人だけに表示する「ホームに戻る」ボタン。
// プレイヤーは進行に関わる（回答・審査を待たれる）ため表示しない。観客は進行に
// 影響しないため、ライブ中いつでも自由に出入りできるようにする
// （要望：「観客は出入りできるようにしよう」）。
export default function AudienceHomeButton() {
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const live = useLiveFollowerStore((s) => s.live);
  // 2026-09-03:「参加登録受付中(opening)画面には、プレイヤーとして参加登録した人には
  // ホームに戻るボタンはいらない、観客はいる」の要望対応。openingフェーズはまだ
  // 組分け前で、participants.roleは（組分け完了まで）既定値のaudienceのままなので、
  // roleではなく本人が選んだpreferred_roleで判定する必要がある（roleで判定すると、
  // プレイヤー希望の人にも「観客」用のこのボタンが出てしまっていた）。組分け後の
  // フェーズは従来どおりroleで判定する。
  const isPlayer =
    live?.current_phase === "opening"
      ? myParticipant?.preferred_role === "player"
      : myParticipant?.role === "player";
  if (isPlayer) return null;
  // 2026-09-03:「ライブ終了時にホームに戻るボタンが2個になる」不具合対策。
  // ライブ終了(closed)画面自体に、既に中央寄せの大きな「ホームに戻る」ボタンが
  // あるため、こちらの固定表示ボタンは終了画面では出さない。
  if (live?.current_phase === "closed") return null;

  return (
    <Link
      href="/"
      className="fixed left-3 top-3 z-[100] rounded-full bg-black/60 px-3 py-1.5 font-sans text-xs font-bold text-white backdrop-blur-sm transition hover:bg-black/80"
    >
      ← ホームに戻る
    </Link>
  );
}
