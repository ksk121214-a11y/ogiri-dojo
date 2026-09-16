"use client";

import { useState } from "react";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import PointHistoryModal from "@/components/app/PointHistoryModal";
import { getRankByMeter } from "@/data/collectionData";
import { isConfirmedMember, isGuestUser } from "@/lib/guestStatus";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

import styles from "./StadiumHome.module.css";

// 名前表示に使える幅がこのカードでは限られているため、文字数に応じて段階的に
// フォントサイズを落とし、10文字（表示名の最大長）でも省略(...)にならないようにする。
function nameSizeClass(name: string): string {
  if (name.length <= 5) return "text-lg";
  if (name.length <= 7) return "text-base";
  return "text-sm";
}

// 2026-09-16: ポイントを消費する機能（ガチャ等）がまだ無いため、累計ポイントの下に
// 小さく出ている「ポイント残高」表示だけを一旦隠す。取得・計算処理（pointsBalance
// 自体）はそのまま残し、消費機能を実装するタイミングでtrueに戻せばよい。
const SHOW_POINTS_BALANCE = false;

// 生成り色の横長カード：アイコン＋ログイン状態／名前／段位＋ポイント残高。
// アイコンは大喜利ライブと同じ線画（MyIconAvatar、マイページで変更した色がそのまま反映される）。
// 2026-08-28: 「上のポイントは消して、こちらのポイント残高を押すと履歴が出るように」の
// 要望で、獲得履歴モーダルを開く動線をヘッダーからこちらに移した。
// 2026-09-01: 未ログイン時（またはprofile取得前）に、ローカルのダミー値（useUserStore、
// 「あなた」「累計5000pt」等）が実データであるかのように表示されていた問題を修正。
// 「ログイン中」表示・段位・ポイントは、実際にログインしていて(authUser)かつ
// profileを取得できた場合にのみ出し、それ以外はログインを促す表示に切り替える。
export default function AccountSummary() {
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const profile = useProfileStore((s) => s.profile);
  const profileLoading = useProfileStore((s) => s.loading);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [xLoginError, setXLoginError] = useState<string | null>(null);

  // 2026-09-03: 「名前とポイントが見れるところを丸角ではなく四角にして、左上に
  // リング通しのような丸い穴を（背景が透けて見える形で）付ける」要望対応。
  // 「角の境界線をまたぐ」のではなく、上から8px・左から8pxの位置にある、
  // カードの内側に完全に収まった穴（ノート・バインダーの綴じ穴のイメージ）。
  // .ringHole自体はページ本体の背景と同じ質感を描いて「穴」に見せているだけ
  // （本当に透過しているわけではない、既存の.scallopCap系と同じ手法）。
  // ホームにしか出さないコンポーネントなので.scallopDarkで固定してよい。
  // 穴と中身の文字・アイコンが重ならないよう、padding-top/padding-leftを
  // 広めに取っている（pt-6/pl-7、他の辺は元のpx-4/py-3.5のまま）。
  if (authLoading) {
    return (
      <section
        className={`${styles.grainPaper} relative flex items-center gap-3 pl-7 pr-4 pt-6 pb-3.5 text-[var(--ink)]/40`}
        aria-hidden
      >
        <div className={`${styles.ringHole} ${styles.scallopDark}`} aria-hidden />
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[var(--ink)]/10" />
        <div className="h-4 flex-1 animate-pulse rounded bg-[var(--ink)]/10" />
      </section>
    );
  }

  if (!authUser) {
    return (
      <section className={`${styles.grainPaper} relative flex items-center justify-between gap-3 pl-7 pr-4 pt-6 pb-3.5 text-[var(--ink)]`}>
        <div className={`${styles.ringHole} ${styles.scallopDark}`} aria-hidden />
        <p className="text-sm font-bold text-[var(--ink)]/70">
          ログインすると段位・ポイントが確認できます
        </p>
        <button
          type="button"
          onClick={async () => {
            setXLoginError(null);
            const result = await signInWithX();
            if (!result.ok && result.reason) setXLoginError(result.reason);
          }}
          className={`${styles.pressable} ${styles.grainAccent} shrink-0 rounded-xl px-4 py-2 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90`}
        >
          Xでログイン
        </button>
        {xLoginError && (
          <p className="absolute -bottom-5 left-7 font-sans text-[10px] text-red-600">{xLoginError}</p>
        )}
      </section>
    );
  }

  // 2026-09-13（0070ゲスト参加レビュー対応）：ゲストは通常会員のような段位・ポイント
  // 表示にせず、「ゲスト参加中」＋Xログイン導線に差し替える。authUser.is_anonymousも
  // 併せて見る共通関数（src/lib/guestStatus.ts）を使うため、profile取得前・取得失敗の
  // 匿名ユーザーも即座にゲストとして扱える（下のprofile未確定ガードを待たない）。
  if (isGuestUser(authUser, profile)) {
    return (
      <section className={`${styles.grainPaper} relative flex items-center justify-between gap-3 pl-7 pr-4 pt-6 pb-3.5 text-[var(--ink)]`}>
        <div className={`${styles.ringHole} ${styles.scallopDark}`} aria-hidden />
        <p className="text-sm font-bold text-[var(--ink)]/70">
          ゲスト参加中です。Xでログインすると段位・ポイントが記録されます
        </p>
        <button
          type="button"
          onClick={async () => {
            setXLoginError(null);
            const result = await signInWithX({ isGuestSwitch: true });
            if (!result.ok && result.reason) setXLoginError(result.reason);
          }}
          className={`${styles.pressable} ${styles.grainAccent} shrink-0 rounded-xl px-4 py-2 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90`}
        >
          Xでログイン
        </button>
        {xLoginError && (
          <p className="absolute -bottom-5 left-7 font-sans text-[10px] text-red-600">{xLoginError}</p>
        )}
      </section>
    );
  }

  // 2026-09-13（再レビュー対応）：ゲストではないと分かった後も、profile取得が
  // 完了する（isConfirmedMemberがtrueになる）までは、段位「見習い」・累計0pt等の
  // 既定値を実データであるかのように表示しない（通常のXユーザーでも、profile取得の
  // 一瞬だけ0pt・見習いが実データのように見えてしまっていた）。
  if (!isConfirmedMember({ authUser, profile, profileLoading })) {
    return (
      <section
        className={`${styles.grainPaper} relative flex items-center gap-3 pl-7 pr-4 pt-6 pb-3.5 text-[var(--ink)]/40`}
        aria-hidden
      >
        <div className={`${styles.ringHole} ${styles.scallopDark}`} aria-hidden />
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[var(--ink)]/10" />
        <div className="h-4 flex-1 animate-pulse rounded bg-[var(--ink)]/10" />
      </section>
    );
  }

  const displayName = profile?.displayName ?? "名無しの演者";
  const rank = getRankByMeter(profile?.masteryMeter ?? 0);
  const totalPoints = profile?.totalPoints ?? 0;
  const pointsBalance = profile?.pointsBalance ?? 0;

  return (
    <section className={`${styles.grainPaper} relative flex items-center gap-3 pl-7 pr-4 pt-6 pb-3.5 text-[var(--ink)]`}>
      <div className={`${styles.ringHole} ${styles.scallopDark}`} aria-hidden />
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
        {/* 見出しは「累計ポイント」（消費されず積み上がる値）を主表示にし、
            その下に小さく「ポイント残高」（将来ガチャ等で消費されうる値）を添える。 */}
        <p className="text-xs text-[var(--ink)]/60">累計ポイント</p>
        <p className="text-2xl font-black tabular-nums text-[var(--accent)]">
          {totalPoints.toLocaleString()}
          <span className="ml-0.5 text-sm font-normal text-[var(--ink)]/60">pt</span>
        </p>
        {SHOW_POINTS_BALANCE && (
          <p className="text-[10px] text-[var(--ink)]/50">残高 {pointsBalance.toLocaleString()}pt</p>
        )}
      </button>

      {historyOpen && <PointHistoryModal variant="stadium" onClose={() => setHistoryOpen(false)} />}
    </section>
  );
}
