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
    // 「次回ライブ」タグは内側の.ticket（切り欠き演出のためoverflow:hiddenが掛かっている）の
    // 外側に置く。.ticketの子にすると上にはみ出した分がクリップされ半分隠れてしまうため。
    <div className="relative">
      <span className="absolute -top-2.5 left-4 z-10 rounded-sm bg-[var(--accent)] px-2 py-0.5 text-xs font-bold tracking-widest text-[var(--paper)] shadow-none">
        次回ライブ
      </span>

      <div className={styles.ticket}>
        <div className={styles.notchTop} aria-hidden />
        <div className={styles.notchBottom} aria-hidden />

        <div className="flex flex-col gap-1 px-5 pt-5 pb-4">
          <p className="text-sm font-bold text-[var(--ink)]/60">{live.year}年</p>
          <p className="text-[2.75rem] font-black leading-none tracking-tight text-[var(--ink)] sm:text-6xl">
            {live.month}
            <span className="mx-0.5 text-2xl font-bold sm:text-3xl">月</span>
            {live.day}
            <span className="mx-0.5 text-2xl font-bold sm:text-3xl">日</span>
            <span className="ml-1 text-xl font-bold sm:text-2xl">（{live.weekday}）</span>
          </p>
          <p className="mt-1 text-3xl font-black text-[var(--accent)] sm:text-4xl">
            {live.time} <span className="text-xl font-bold sm:text-2xl">開演</span>
          </p>
          <p className="mt-1 flex items-center gap-1 text-sm font-bold text-[var(--ink)]">
            <ClockGlyph />
            受付 {live.reception}
          </p>
        </div>

        {/*
          バーコードはflex-1で縦方向に伸ばし、チケット番号・「OGIRI LIVE」の縦書き・星の
          間を埋めるように配置する。バー自体は縦棒だが、以前は高さを64pxに固定していたため
          横長の帯に見えていた。左カラムの高さいっぱいに伸ばして「縦長」の帯にする。
        */}
        <div className={`${styles.stubDivider} flex flex-col items-center gap-2 bg-[var(--accent)] px-2 py-4 text-[var(--paper)]`}>
          <span className="shrink-0 rounded-sm border border-[var(--paper)]/60 px-1.5 py-0.5 text-xs font-bold tabular-nums">
            {live.ticketNo}
          </span>

          <div className="flex w-full flex-1 items-stretch justify-center gap-[2px]" aria-hidden>
            {BARCODE_PATTERN.map((w, i) => (
              <span
                key={i}
                className={styles.barcodeBar}
                style={{ width: 1 + w * 0.6, background: "var(--paper)" }}
              />
            ))}
          </div>

          <span className="shrink-0 [writing-mode:vertical-rl] text-xs font-bold tracking-widest">
            OGIRI LIVE
          </span>
          <span className="shrink-0 text-sm" aria-hidden>★ ★</span>
        </div>
      </div>
    </div>
  );
}
