import { ClockGlyph } from "./icons";
import styles from "./StadiumHome.module.css";

// 決め打ちのバーコード風の縦棒パターン（Math.randomはSSR/CSRの表示差異を招くため使わず、
// 見た目だけのランダム風の固定配列にしている）。
const BARCODE_PATTERN = [2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 1, 3, 2, 1, 4, 1, 2, 2, 1, 3];

export interface NextLiveInfo {
  ticketNo: string;
  year: string;
  month: string;
  day: string;
  weekday: string;
  time: string;
  reception: string;
}

// 次回ライブ告知のチケット風カード。CSS Gridで「本券／半券」の2カラムに分け、
// 画像は一切使わずCSS（丸い切り欠き・破線・バーコード）だけで表現する。
export default function NextLiveTicket({ live }: { live: NextLiveInfo }) {
  return (
    <div className={`${styles.ticket} relative`}>
      <span className="absolute -top-2.5 left-4 z-10 rounded-sm bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold tracking-widest text-[var(--paper)] shadow-none">
        次回ライブ
      </span>
      <div className={styles.notchTop} aria-hidden />
      <div className={styles.notchBottom} aria-hidden />

      <div className="flex flex-col gap-1 px-5 pt-6 pb-5">
        <p className="text-xs font-bold text-[var(--ink)]/60">{live.year}年</p>
        <p className="text-[2.75rem] font-black leading-none tracking-tight text-[var(--ink)] sm:text-6xl">
          {live.month}
          <span className="mx-0.5 text-xl font-bold sm:text-2xl">月</span>
          {live.day}
          <span className="mx-0.5 text-xl font-bold sm:text-2xl">日</span>
          <span className="ml-1 text-lg font-bold sm:text-xl">（{live.weekday}）</span>
        </p>
        <p className="mt-1 text-2xl font-black text-[var(--accent)] sm:text-3xl">
          {live.time} <span className="text-lg font-bold sm:text-xl">開演</span>
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs font-bold text-[var(--ink)]">
          <ClockGlyph />
          受付 {live.reception}
        </p>
      </div>

      <div className={`${styles.stubDivider} flex flex-col items-center justify-between gap-2 bg-[var(--accent)] px-2 py-4 text-[var(--paper)]`}>
        <span className="rounded-sm border border-[var(--paper)]/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
          {live.ticketNo}
        </span>

        <div className="flex h-16 items-end gap-[2px]" aria-hidden>
          {BARCODE_PATTERN.map((w, i) => (
            <span
              key={i}
              className={styles.barcodeBar}
              style={{ width: 1 + w * 0.6, height: "100%", background: "var(--paper)" }}
            />
          ))}
        </div>

        <span className="[writing-mode:vertical-rl] text-[10px] font-bold tracking-widest">
          OGIRI LIVE
        </span>
        <span className="text-xs" aria-hidden>★ ★</span>
      </div>
    </div>
  );
}
