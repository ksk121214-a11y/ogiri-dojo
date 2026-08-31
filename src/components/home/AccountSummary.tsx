"use client";

import { useState } from "react";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import PointHistoryModal from "@/components/app/PointHistoryModal";
import { getRankByMeter } from "@/data/collectionData";
import { useProfileStore } from "@/store/useProfileStore";
import { useUserStore } from "@/store/useUserStore";

import styles from "./StadiumHome.module.css";

// 名前表示に使える幅がこのカードでは限られているため、文字数に応じて段階的に
// フォントサイズを落とし、10文字（表示名の最大長）でも省略(...)にならないようにする。
function nameSizeClass(name: string): string {
  if (name.length <= 5) return "text-lg";
  if (name.length <= 7) return "text-base";
  return "text-sm";
}

// 生成り色の横長カード：アイコン＋ログイン状態／名前／段位＋ポイント残高。
// アイコンは大喜利ライブと同じ線画（MyIconAvatar、マイページで変更した色がそのまま反映される）。
// 2026-08-28: 「上のポイントは消して、こちらのポイント残高を押すと履歴が出るように」の
// 要望で、獲得履歴モーダルを開く動線をヘッダーからこちらに移した。
export default function AccountSummary() {
  const user = useUserStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const displayName = profile?.displayName ?? user.displayName;
  // 2026-08-31: 段位はライブ終了時に加算される実データ（profiles.mastery_meter）を優先する。
  const rank = getRankByMeter(profile?.masteryMeter ?? user.masteryMeter);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <section className={`${styles.grainPaper} flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[var(--ink)]`}>
      {/*
        「アイコンは丸で囲わずそのままの感じで」の要望のため、円形の縁取り・背景は付けず、
        bareモード（縁取りなし）のMyIconAvatarをそのまま置く
        （MyIconAvatar自体は他画面共通のコンポーネントなので変更しない）。
      */}
      <MyIconAvatar size={40} bare />
      <div className="min-w-0 flex-1">
        <span className="inline-block rounded-sm bg-[var(--ink)]/10 px-1.5 py-0.5 text-xs font-bold tracking-widest text-[var(--ink)]/70">
          ログイン中
        </span>
        {/* 2026-08-28: 「名前を10文字にしても...で切れず見れるように」の要望で、
            長い名前ほど自動的にフォントサイズを一段階ずつ落として省略されないようにする。 */}
        <p className={`mt-1 truncate font-bold ${nameSizeClass(displayName)}`}>{displayName}</p>
        <p className="text-sm font-bold text-[var(--ink)]/70">段位：{rank.label}</p>
      </div>
      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        aria-haspopup="dialog"
        className={`${styles.pressable} shrink-0 rounded-xl px-2 py-1 text-right transition hover:bg-[var(--ink)]/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
      >
        {/* 2026-08-31: 固定ダミー値(5000pt)のまま変わらなかったのを修正し、
            ライブ終了時に加算される実データ（profiles）を表示するようにした。
            見出しは「累計ポイント」（消費されず積み上がる値）を主表示にし、
            その下に小さく「ポイント残高」（将来ガチャ等で消費されうる値）を添える。 */}
        <p className="text-xs text-[var(--ink)]/60">累計ポイント</p>
        <p className="text-2xl font-black tabular-nums text-[var(--accent)]">
          {(profile?.totalPoints ?? user.points).toLocaleString()}
          <span className="ml-0.5 text-sm font-normal text-[var(--ink)]/60">pt</span>
        </p>
        <p className="text-[10px] text-[var(--ink)]/50">
          残高 {(profile?.pointsBalance ?? user.points).toLocaleString()}pt
        </p>
      </button>

      {historyOpen && <PointHistoryModal variant="stadium" onClose={() => setHistoryOpen(false)} />}
    </section>
  );
}
