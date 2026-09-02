"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import { getRankByMeter } from "@/data/collectionData";
import { formatMinutesUntil } from "@/lib/ticketFormat";
import { MAX_TICKETS, computeDisplayedTickets } from "@/lib/ticketRecovery";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";

import { ClockGlyph, EditGlyph } from "./icons";
import styles from "./StadiumHome.module.css";

// マイページの演者名カード。NextLiveTicket（次回ライブ）と同じ「本券／半券＋丸い切り欠き」の
// チケット言語を流用し、半券側には寄合券（寄合帳に投稿・回答するためのスタミナ的リソース、
// profiles.tickets_countで管理、§ticketRecovery）の残り枚数を5分割のスタンプ欄として表示する。
// 2026-08-29: 「寄合券を使うとスタンプが消えるのではなく、そのチケットの部分ごと消えるように」
// の要望で、本体と半券を（ライブ予定ページの.tornTicketRow／.tornTicketMainと同じ考え方で）
// 別々の独立したカードに分離した。詳しくはTicketStubColumnのコメント参照。

// 名前表示に使える幅がこのカードでは限られているため、文字数に応じて段階的に
// フォントサイズを落とし、10文字（表示名の最大長）でも省略(...)にならないようにする。
function nameSizeClass(name: string): string {
  if (name.length <= 4) return "text-2xl";
  if (name.length <= 6) return "text-xl";
  if (name.length <= 8) return "text-lg";
  return "text-base";
}

export default function MyProfileTicket({
  onOpenStats,
  onOpenEdit,
}: {
  onOpenStats: () => void;
  onOpenEdit: () => void;
}) {
  const authUser = useAuthStore((s) => s.user);
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const profile = useProfileStore((s) => s.profile);
  // 2026-09-01: 未ログイン時にローカルのダミー値（useUserStore、名前「あなた」・
  // 段位「前座」・固定bio等）が実データであるかのように表示されていた問題を修正。
  // ログインしている場合のみ実データ（profiles）を出す。
  const isLoggedIn = !!authUser;
  const rank = getRankByMeter(isLoggedIn ? (profile?.masteryMeter ?? 0) : 0);
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);
  const followerCount = useSnsStore((s) => s.myFollowerCount);
  const displayName = isLoggedIn ? (profile?.displayName ?? "…") : "ログインしてください";
  const bio = isLoggedIn ? (profile?.bio ?? "") : "";

  // 「次の回復まで◯分」の表示を実時間の経過に合わせて更新するための再描画
  // （profile自体はサーバー側の値のスナップショットなので、時間経過ぶんの見た目上の
  // 回復はcomputeDisplayedTicketsで都度計算し直す。実際に投稿できるかどうかは
  // サーバー側のRPCが最終判定する）。
  const [, setTicketTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTicketTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const displayedTickets = profile
    ? computeDisplayedTickets(profile.ticketsCount, profile.ticketsNextRecoveryAt)
    : { count: 0, nextRecoveryAt: null };
  const ticketCount = displayedTickets.count;
  const nextTicketRecoveryAt = displayedTickets.nextRecoveryAt;

  return (
    <div className="flex flex-col gap-1.5">
      <div className={styles.profileCardRow}>
        {/* 本体：独立した紙（左のみ角丸、右は半券との境目でシャープな直角）。 */}
        <div className={`${styles.profileCardMain} ${styles.grainPaper}`}>
          <div className={`${styles.scallopDivider} ${styles.scallopKraft}`} aria-hidden />
          <div className={`${styles.scallopCapTop} ${styles.scallopKraft}`} aria-hidden />
          <div className={`${styles.scallopCapBottom} ${styles.scallopKraft}`} aria-hidden />

          <div className="flex flex-col gap-3 px-5 py-5">
            <div className="flex items-start gap-3">
              <span className="flex shrink-0 items-center justify-center">
                <MyIconAvatar size={48} bare />
              </span>
              <div className="flex min-w-0 flex-col gap-1.5 pt-1">
                {/* 2026-08-28: 「名前を10文字にしても...で切れず見れるように」の要望で、
                    長い名前ほど自動的にフォントサイズを一段階ずつ落として省略されないようにする。 */}
                <p
                  className={`truncate font-sans font-black text-[var(--ink)] ${nameSizeClass(displayName)}`}
                >
                  {displayName}
                </p>
                <span
                  className={`${styles.grainAccent} w-fit rounded-full px-3 py-1 font-sans text-xs font-bold text-[var(--paper)]`}
                >
                  段位：{rank.label}
                </span>
              </div>
            </div>

            {bio && <p className="text-sm leading-snug text-[var(--ink)]/85">{bio}</p>}

            <div className="border-t-2 border-dashed border-[var(--ink)]/25" aria-hidden />

            <div className="flex items-center justify-center gap-4">
              <Link href="/sns/u/me/following" className="flex items-center gap-1.5">
                <span className="font-sans text-base font-bold tabular-nums text-[var(--ink)]">
                  {followingAuthorIds.length}
                </span>
                <span className="font-sans text-xs text-[var(--ink)]/70 hover:underline">フォロー中</span>
              </Link>
              <span className="text-[var(--ink)]/25" aria-hidden>
                |
              </span>
              <Link href="/sns/u/me/followers" className="flex items-center gap-1.5">
                <span className="font-sans text-base font-bold tabular-nums text-[var(--ink)]">
                  {followerCount ?? "…"}
                </span>
                <span className="font-sans text-xs text-[var(--ink)]/70 hover:underline">フォロワー</span>
              </Link>
            </div>

            {/* 「段位・実績を見る」が参考画像では1行に収まっているのに対し、text-smだと
                この列幅では折り返ってしまっていたため、text-xs・px-2に詰めてnowrapにしている。 */}
            {isLoggedIn ? (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={onOpenStats}
                  className={`${styles.pressable} flex-1 whitespace-nowrap rounded-xl bg-[var(--ink)] px-2 py-2.5 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90`}
                >
                  段位・実績を見る
                </button>
                <button
                  type="button"
                  onClick={onOpenEdit}
                  className={`${styles.pressable} flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-[var(--ink)]/70 px-2 py-2.5 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/5`}
                >
                  <EditGlyph />
                  編集する
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => signInWithX()}
                className={`${styles.pressable} ${styles.grainAccent} w-full whitespace-nowrap rounded-xl px-2 py-2.5 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90`}
              >
                Xでログイン
              </button>
            )}
          </div>
        </div>

        <TicketStubColumn count={ticketCount} />
      </div>

      {/* 寄合券の残り枚数・回復までの目安時間。カードの外、右寄せの控えめな表示にしている。 */}
      <div className="flex items-center justify-end gap-3 px-1 font-sans text-xs text-[var(--ink)]/70">
        <span className="font-bold">
          寄合券　残り {ticketCount}/{MAX_TICKETS}
        </span>
        {ticketCount < MAX_TICKETS && nextTicketRecoveryAt ? (
          <span className="flex items-center gap-1">
            <ClockGlyph />
            次の回復まで{formatMinutesUntil(nextTicketRecoveryAt)}分
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <ClockGlyph />
            1時間で1枚回復
          </span>
        )}
      </div>
    </div>
  );
}

// 半券側：寄合券の残り枚数を表す、切り取り線4本で5分割したスタンプ欄。
// 「寄合券を使うとスタンプが消えるのではなく、そのチケットの部分ごと消えるように」の要望で、
// 消費済みのセルには紙（.grainPaper）を敷かず背景なしにする＝ページ本体の背景（クラフト紙）が
// そのまま透けて見える（.profileCardStub自体は背景を持たないコンテナで、overflow:hiddenと
// border-radiusだけを担う。角の丸みは一番上／一番下のセルが有効なときだけ自然に効く）。
// 「一番上から順に切られていく」の要望どおり、上からMAX_TICKETS-count個を空欄にし、
// 残り（下側）のcount個だけ紙とスタンプを表示する。回復すると上から順に埋まっていく。
// 各セルの区切り線は.scallopDividerHorizontal（縦長楕円の.scallopDividerを横向きにしたもの）。
// 左端には.scallopDividerLeft（本体側の.scallopDividerと同じ座標のleft版）を重ね、
// 「切り離される半券側の左端がまっすぐ」に見えないよう、両方の紙が嚙み合う見た目にする。
function TicketStubColumn({ count }: { count: number }) {
  return (
    <div className={styles.profileCardStub}>
      <div className={`${styles.scallopDividerLeft} ${styles.scallopKraft}`} aria-hidden />
      {/* 本体側（.scallopCapTop/.scallopCapBottom）と同じ丸い切り欠きを、半券（5分割の
          スタンプ欄）の左上・左下にも重ねる。1枚目セルの上角・5枚目セルの下角が
          本体側の右側の角と同じ丸みに揃う。 */}
      <div className={`${styles.scallopCapTopLeft} ${styles.scallopKraft}`} aria-hidden />
      <div className={`${styles.scallopCapBottomLeft} ${styles.scallopKraft}`} aria-hidden />
      {Array.from({ length: MAX_TICKETS }).map((_, i) => {
        const filled = i >= MAX_TICKETS - count;
        return (
          <div key={i} className="relative flex items-center justify-center">
            {i > 0 && (
              <div className={`${styles.scallopDividerHorizontal} ${styles.scallopKraft}`} aria-hidden />
            )}
            {filled && (
              <>
                <div className={`${styles.grainPaper} absolute inset-0`} aria-hidden />
                <div className="relative z-[1]">
                  {/* 2026-09-03: 5分割セルは.profileCardMainの高さ（bio欄が無いと
                      約200px程度）を必ず均等5等分した高さしか無く、実測で
                      1セルあたり最短約40pxしか無いことを確認した。52pxのままだと
                      枠からはみ出してoverflow:hiddenに切られ、「一番下の券だけ
                      小さい」ように見えていたため、確実に収まる大きさへ縮小した。 */}
                  <OgiriStamp size={34} />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// 半券に押された「OGIRI LIVE」の判子（スタンプ）風グラフィック。
// 実在しない印影素材をでっち上げず、SVGのtextPathで円弧に沿った文字を描く。
function OgiriStamp({ size = 76 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="text-[var(--accent)] opacity-60"
      style={{ transform: "rotate(-8deg)" }}
      aria-hidden
    >
      <defs>
        {/* 文字が外側の円からはみ出さないよう、外側(r=40)と内側(r=32)の輪の間の
            中間半径(r=34)に円弧を置き、「OGIRI LIVE」を完全に円の中に収める。 */}
        <path id="ogiriStampArc" d="M 17,58 A 34,34 0 1 1 83,58" fill="none" />
      </defs>
      <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="50" cy="50" r="32" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <text fill="currentColor" fontSize="8.5" fontWeight={700} letterSpacing="1">
        <textPath href="#ogiriStampArc" xlinkHref="#ogiriStampArc" startOffset="50%" textAnchor="middle">
          OGIRI LIVE
        </textPath>
      </text>
      <text x="50" y="63" textAnchor="middle" fontSize="12" fontWeight={700} fill="currentColor">
        ★ ★ ★
      </text>
    </svg>
  );
}
