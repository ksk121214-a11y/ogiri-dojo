import { ClockGlyph } from "./icons";
import styles from "./StadiumHome.module.css";

// 決め打ちのバーコード風の縦棒パターン（Math.randomはSSR/CSRの表示差異を招くため使わず、
// 見た目だけのランダム風の固定配列にしている）。
// 添付の実物チケット画像に合わせ、縦棒を大きく広げて使う。
// 半券の幅は104px固定（px-2の内側で約88px）で、右にOGIRI LIVEの縦書きも並べるため、
// バーコード自体の横幅は60px前後に収まるよう本数・太さを調整している。
const BARCODE_PATTERN = [2, 1, 3, 1, 4, 2, 1, 3, 1, 2, 4, 1, 2];
const BARCODE_BAR_GAP = 1.5;
const barcodeBarWidth = (w: number) => 1 + w * 0.55;
// 「広げて」の要望で、以前より縦にしっかり伸ばした高さにする。
const BARCODE_HEIGHT = 150;

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
          {/* 前回の文字拡大で1行に収まらず折り返っていたため、この行だけ一段階小さくして1行に戻す。 */}
          <p className="mt-1 flex items-center gap-1 whitespace-nowrap text-xs font-bold text-[var(--ink)]">
            <ClockGlyph />
            受付 {live.reception}
          </p>
        </div>

        {/*
          添付の実物チケット画像に合わせたレイアウト：チケット番号を上に置き、その下は
          「大きく広げた縦棒バーコード」と「OGIRI LIVE＋星」を横並びにする
          （以前は縦一列にすべて積んでいたが、画像のように横に並べる形へ変更）。
        */}
        <div className={`${styles.stubDivider} flex flex-col items-center gap-3 bg-[var(--accent)] px-2 py-3 text-[var(--ink)]`}>
          <span className="shrink-0 rounded-sm border border-[var(--ink)]/70 px-1.5 py-0.5 text-xs font-bold tabular-nums">
            {live.ticketNo}
          </span>

          <div className="flex items-stretch justify-center gap-2">
            <div className="flex items-stretch" style={{ height: BARCODE_HEIGHT, gap: BARCODE_BAR_GAP }} aria-hidden>
              {BARCODE_PATTERN.map((w, i) => (
                <span
                  key={i}
                  className={styles.barcodeBar}
                  style={{ width: barcodeBarWidth(w), background: "var(--ink)" }}
                />
              ))}
            </div>

            <div className="flex flex-col items-center justify-between" style={{ height: BARCODE_HEIGHT }}>
              <span className="[writing-mode:vertical-rl] text-xs font-bold tracking-widest">
                OGIRI LIVE
              </span>
              <span className="flex flex-col items-center gap-1 text-sm leading-none" aria-hidden>
                <span>★</span>
                <span>★</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
