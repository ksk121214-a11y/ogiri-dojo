"use client";

import type { CSSProperties } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ClockGlyph, HistoryClockGlyph } from "./icons";
import XShareButton from "@/components/app/XShareButton";
import type { LiveScheduleDate, LiveTicketInfo } from "@/data/liveScheduleData";
import { APP_NAME } from "@/lib/appInfo";
import { useSnsStore } from "@/store/useSnsStore";
import styles from "./StadiumHome.module.css";

// ライブ予定ページ（/live-schedule）専用の3種類のチケットカード。
// 「前回」は「今回のチケットの半券（赤い部分）が切り取られた」見た目にしたいという
// 要望のため、「今回」「次回」と同じ.ticketの2カラムグリッド構造をそのまま使い、
// 半券側だけ何も貼らずページの背景（コンクリート）を透かして見せている
// （本券側=.tornTicketMainだけが独立した丸角＋切り欠き付きのカード）。
// 「今回」「次回」は本券＋半券に、境界線（連続した丸い切り欠き＝.scallopDivider）と
// バーコード＋OGIRI LIVEのスタンプ風グラフィックを添える。
// 背景がホーム（黒）ではなく明るいコンクリートのため、切り欠きの質感は
// .scallopConcreteを使い、ページの背景色と馴染むようにしている。
// ホームのNextLiveTicketとは見た目の要件が違う（インラインのアクションボタンを
// チケット内に置く、タグ文言・色が3種類で異なる等）ため、既存コンポーネントを
// 分岐だらけにするのではなく専用コンポーネントとして分離した。

// 本券と半券の境界線の位置。半券幅104pxのため 104-5=99px
// （計算根拠はNextLiveTicket側と同じ。詳しくはStadiumHome.module.cssの.scallopDivider参照）。
const SCALLOP_STYLE = { "--scallop-right": "99px" } as CSSProperties;
// 「前回」は半券が無い（=.tornTicketMainという単独カードの右端そのものが境界線）ため、
// .scallopDividerの既定値（-5px、カード自身の外周用）をそのまま使えばよく、上書き不要。

const BARCODE_PATTERN = [
  2, 1, 3, 1, 2, 4, 1, 3, 1, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 1, 3, 2, 1, 4, 2, 1,
];
const BARCODE_HEIGHT = 76;
const BARCODE_WIDTH = 38;

function DateLine({ date, timeTone }: { date: LiveScheduleDate; timeTone: "accent" | "ink" }) {
  return (
    <>
      <p className="text-sm font-bold text-[var(--ink)]/60">{date.year}年</p>
      <p className="whitespace-nowrap text-3xl font-black leading-none tracking-tight text-[var(--ink)]">
        {date.month}
        <span className="text-base font-bold">月</span>
        {date.day}
        <span className="text-base font-bold">日</span>
        <span className="ml-0.5 text-sm font-bold">（{date.weekday}）</span>
      </p>
      <p
        className={`mt-0.5 text-2xl font-black ${
          timeTone === "accent" ? "text-[var(--accent)]" : "text-[var(--ink)]"
        }`}
      >
        {date.time}
      </p>
    </>
  );
}

// 半券（バーコード＋チケット番号＋SAMPLE）。stubClassで本券の色味（赤テクスチャ／黒テクスチャ）を切り替える。
// ticketNoがnull（=その表示先にまだライブ予定が割り当てられていない「準備中」）の場合も、
// 半券自体（赤/黒の色分けされた部分）は常に表示したままにし、番号欄だけ空にする
// （2026-08-30：運営者専用管理画面の追加。準備中でもチケットの型は崩さない要望）。
function TicketStub({ ticketNo, stubClass }: { ticketNo: string | null; stubClass: string }) {
  return (
    <div className={`${stubClass} relative px-2 py-1.5 text-[var(--ink)]`}>
      {ticketNo && (
        <span className="absolute top-1.5 left-1/2 shrink-0 -translate-x-1/2 rounded-sm border border-[var(--ink)]/70 px-1.5 py-0.5 text-xs font-bold tabular-nums">
          {ticketNo}
        </span>
      )}
      <div
        className="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1.5"
        style={{ top: "calc(50% + 8px)" }}
      >
        <div
          className="flex flex-col items-stretch"
          style={{ width: BARCODE_WIDTH, height: BARCODE_HEIGHT, gap: 1 }}
          aria-hidden
        >
          {BARCODE_PATTERN.map((w, i) => (
            <span
              key={i}
              className={styles.barcodeBar}
              style={{ flexGrow: w, flexBasis: 0, background: "var(--ink)" }}
            />
          ))}
        </div>
        <div className="flex flex-col items-center justify-center gap-1">
          <span className="[writing-mode:vertical-rl] text-[11px] leading-none font-bold tracking-normal">
            SAMPLE
          </span>
          <span className="flex flex-col items-center gap-0.5 text-[11px] leading-none" aria-hidden>
            <span>★</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// dateがnull（=「前回のライブ」がまだ割り当てられていない）場合も、チケットの枠自体は
// そのまま保ち、中身だけ「準備中」表示に差し替える。
export function PreviousLiveCard({ date }: { date: LiveScheduleDate | null }) {
  const router = useRouter();

  // 「前回のライブ」はライブ予定管理側の表示専用データ(live_schedule_entries)から
  // 来ており、特定のlives.id/sns_live_results.idとの紐付けを持たないため、その1件の
  // 結果詳細へは飛ばせない。代わりにマイページの寄合帳「ライブ結果」タブへ飛ばす
  // （タブの選択状態はuseSnsStoreに永続化済みのため、遷移前にセットしておけば
  // マイページ側で自動的にそのタブが開いた状態になる）。
  const handleShowResults = () => {
    useSnsStore.getState().setFeedTab("results");
    router.push("/mypage");
  };

  return (
    <div className={styles.tornTicketRow}>
      <div
        className={`${styles.tornTicketMain} ${styles.grainPaper} flex items-center gap-2.5 px-5 py-4 text-[var(--ink)]`}
      >
        <div className={`${styles.scallopDivider} ${styles.scallopConcrete}`} aria-hidden />
        <div className={`${styles.scallopCapTop} ${styles.scallopConcrete}`} aria-hidden />
        <div className={`${styles.scallopCapBottom} ${styles.scallopConcrete}`} aria-hidden />

        <span className="flex shrink-0 items-center justify-center rounded-full bg-[var(--ink)]/8 p-2 text-[var(--ink)]/70">
          <HistoryClockGlyph />
        </span>
        <div className="min-w-0 flex-1">
          <span className="inline-block rounded-sm bg-[var(--ink)]/10 px-2 py-0.5 font-sans text-xs font-bold text-[var(--ink)]/60">
            前回のライブ
          </span>
          {date ? (
            <>
              <p className="mt-1 whitespace-nowrap font-sans text-xl font-black text-[var(--ink)]">
                {date.year}年{date.month}月{date.day}日（{date.weekday}）
              </p>
              <p className="font-sans text-base font-black text-[var(--ink)]/70">{date.time}</p>
            </>
          ) : (
            <p className="mt-1 font-sans text-base font-black text-[var(--ink)]">準備中です</p>
          )}
        </div>
      </div>

      {/* 半券があった場所。何も貼らず、ページの背景（コンクリート）をそのまま見せる。 */}
      <div className="flex flex-col items-center justify-center gap-1.5 px-1">
        <span className="rounded-sm bg-[var(--ink)]/12 px-2 py-1 font-sans text-[11px] font-bold text-[var(--ink)]/60">
          終了
        </span>
        {date ? (
          <button
            type="button"
            onClick={handleShowResults}
            className="whitespace-nowrap rounded-md border border-[var(--ink)]/25 px-2 py-1 font-sans text-[11px] font-bold text-[var(--ink)]/70 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            結果を見る ›
          </button>
        ) : (
          <span className="cursor-not-allowed whitespace-nowrap rounded-md border border-[var(--ink)]/25 px-2 py-1 font-sans text-[11px] font-bold text-[var(--ink)]/35">
            結果を見る ›
          </span>
        )}
      </div>
    </div>
  );
}

// 2026-08-30: 予定がまだ準備されていない（管理画面でライブが作成されていない）
// 場合の「準備中です」を、チケットの枠（scallop装飾・質感）はそのまま保ちつつ
// 中身だけ差し替えて表示する共通パーツ。
function PreparingTicketBody({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-5 py-8 text-center">
      <p className="font-sans text-lg font-black leading-snug text-[var(--ink)]">
        {label}
        <br />
        現在準備中です
      </p>
    </div>
  );
}

export function CurrentLiveCard({
  live,
  reception,
}: {
  // liveがnullの場合は、まだ今回のライブが準備されていない状態。
  live: LiveTicketInfo | null;
  reception?: string;
}) {
  return (
    <div className="relative">
      <span
        className={`${styles.grainAccent} absolute -top-2.5 left-4 z-10 rounded-sm px-2 py-0.5 text-sm font-bold tracking-widest text-[var(--paper)] shadow-none`}
      >
        今回のライブ
      </span>

      <div className={`${styles.ticket} ${styles.grainPaper}`}>
        <div className={`${styles.scallopDivider} ${styles.scallopConcrete}`} style={SCALLOP_STYLE} aria-hidden />
        <div className={`${styles.scallopCapTop} ${styles.scallopConcrete}`} style={SCALLOP_STYLE} aria-hidden />
        <div className={`${styles.scallopCapBottom} ${styles.scallopConcrete}`} style={SCALLOP_STYLE} aria-hidden />

        {live && reception ? (
          <div className="flex flex-col gap-0.5 px-5 pt-4 pb-3">
            <p className="font-sans text-sm font-black text-[var(--accent)]">大喜利ライブ</p>
            <DateLine date={live} timeTone="accent" />
            <p className="mt-0.5 flex items-center gap-1 whitespace-nowrap font-sans text-xs font-bold text-[var(--ink)]">
              <ClockGlyph />
              受付 {reception}
            </p>
            {/* 2026-08-30:「参加するを押したら参加してしまう」対策。ここから直接
                /liveへ遷移すると、ホームの正式な入場フロー（useLiveJoinFlow、
                半券アニメーション等）を経ずにいきなり参加扱いになってしまうため、
                ホームへ誘導し、そちらの「参加する」から正式に入場してもらう。 */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link
                href="/"
                className={`${styles.pressable} ${styles.grainAccent} w-fit px-4 py-1.5 font-sans text-sm font-bold text-[var(--paper)] transition hover:opacity-90`}
              >
                参加する
              </Link>
              <XShareButton
                context="live_schedule"
                label="Xで告知する"
                text={`${live.month}月${live.day}日（${live.weekday}）${live.time}〜、${APP_NAME}のオンライン大喜利ライブ大会があります。\n#${APP_NAME}`}
              />
            </div>
          </div>
        ) : (
          <PreparingTicketBody label="今回のライブは" />
        )}
        {/* 2026-08-30: 準備中（liveが未割当）でも、チケットの型（赤い半券部分）は
            常に表示したままにする。番号欄だけ空にする。 */}
        <TicketStub ticketNo={live?.ticketNo ?? null} stubClass={styles.grainAccent} />
      </div>
    </div>
  );
}

export function UpcomingLiveCard({ live }: { live: LiveTicketInfo | null }) {
  return (
    <div className="relative">
      <span className="absolute -top-2.5 left-4 z-10 rounded-sm bg-[var(--stub-gray)] px-2 py-0.5 text-sm font-bold tracking-widest text-[var(--paper)] shadow-none">
        次回のライブ
      </span>

      <div className={`${styles.ticket} ${styles.grainPaper}`}>
        <div className={`${styles.scallopDivider} ${styles.scallopConcrete}`} style={SCALLOP_STYLE} aria-hidden />
        <div className={`${styles.scallopCapTop} ${styles.scallopConcrete}`} style={SCALLOP_STYLE} aria-hidden />
        <div className={`${styles.scallopCapBottom} ${styles.scallopConcrete}`} style={SCALLOP_STYLE} aria-hidden />

        {live ? (
          <div className="flex flex-col gap-0.5 px-5 pt-4 pb-3">
            <DateLine date={live} timeTone="ink" />
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-sm bg-[var(--ink)]/10 px-2 py-1 font-sans text-[11px] font-bold text-[var(--ink)]/60">
                開催予定
              </span>
              {/* こちらもまだ詳細画面が無いため、押せる体裁のリンクにはせず控えめな表示のみに留める。 */}
              <span className="cursor-not-allowed border border-[var(--ink)]/25 px-2.5 py-1 font-sans text-xs font-bold text-[var(--ink)]/35">
                詳細を見る ›
              </span>
            </div>
          </div>
        ) : (
          <PreparingTicketBody label="次回ライブは" />
        )}
        {/* 2026-08-30: 準備中（liveが未割当）でも、チケットの型（黒い半券部分）は
            常に表示したままにする。番号欄だけ空にする。 */}
        <TicketStub ticketNo={live?.ticketNo ?? null} stubClass={styles.grainDarkGray} />
      </div>
    </div>
  );
}
