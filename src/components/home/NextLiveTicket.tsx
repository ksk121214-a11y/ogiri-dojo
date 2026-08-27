import { ClockGlyph } from "./icons";
import styles from "./StadiumHome.module.css";

// 決め打ちのバーコード風の縦棒パターン（Math.randomはSSR/CSRの表示差異を招くため使わず、
// 見た目だけのランダム風の固定配列にしている）。
// 添付の実物チケット画像に合わせ、縦棒を大きく広げて使う。
// 半券の幅は104px固定（px-2の内側で約88px）で、右にOGIRI LIVEの縦書きも並べるため、
// バーコード自体の横幅は60px前後に収まるよう本数・太さを調整している。
// 「線をもっと細かく」の要望で本数を増やし、隙間も詰めて密なバーコードにしている。
const BARCODE_PATTERN = [
  2, 1, 3, 1, 2, 4, 1, 3, 1, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 1, 3, 2, 1, 4, 2, 1,
];
const BARCODE_BAR_GAP = 1;
// 「広げて」の要望で一度150にしたが、「チケットを少しだけ縦幅狭くして」の要望で
// 128→108と詰め、「バーコードが上の数字と被ってる」の指摘でさらに92に詰めて
// チケット番号バッジとの間隔を確保した。
const BARCODE_HEIGHT = 92;
// 「サイズ感はそのまま、縦線→横線に」の要望で、枠の縦横サイズ自体は変えず
// （旧・縦棒バーコードの実測サイズ≒幅46px×高さ150px）、中の線の向きだけ横に変える。
const BARCODE_WIDTH = 46;

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
      <span className={`${styles.grainAccent} absolute -top-2.5 left-4 z-10 rounded-sm px-2 py-0.5 text-sm font-bold tracking-widest text-[var(--paper)] shadow-none`}>
        次回ライブ
      </span>

      <div className={`${styles.ticket} ${styles.grainPaper}`}>
        <div className={styles.notchTop} aria-hidden />
        <div className={styles.notchBottom} aria-hidden />

        {/* 「チケットを少しだけ縦幅狭くして」の要望で、文字は拡大しつつ上下の余白は詰めている。 */}
        <div className="flex flex-col gap-0 px-5 pt-3 pb-2">
          <p className="text-base font-bold text-[var(--ink)]/60">{live.year}年</p>
          <p className="whitespace-nowrap text-5xl font-black leading-none tracking-tight text-[var(--ink)]">
            {live.month}
            <span className="text-xl font-bold">月</span>
            {live.day}
            <span className="text-xl font-bold">日</span>
            <span className="ml-0.5 text-base font-bold">（{live.weekday}）</span>
          </p>
          <p className="mt-0.5 text-4xl font-black text-[var(--accent)]">
            {live.time} <span className="text-2xl font-bold">開演</span>
          </p>
          {/* 前回の文字拡大で1行に収まらず折り返っていたため、この行だけ一段階小さくして1行に戻す。 */}
          <p className="flex items-center gap-1 whitespace-nowrap text-sm font-bold text-[var(--ink)]">
            <ClockGlyph />
            受付 {live.reception}
          </p>
        </div>

        {/*
          添付の実物チケット画像に合わせたレイアウト：チケット番号を上に置き、その下は
          「大きく広げた縦棒バーコード」と「OGIRI LIVE＋星」を横並びにする
          （以前は縦一列にすべて積んでいたが、画像のように横に並べる形へ変更）。
        */}
        {/*
          チケット番号・バーコード＋OGIRI LIVEの行、どちらもabsoluteにしてこの列の
          通常のフローから完全に外す。これにより、
          ①チケットの縦幅は左カラム（日付・時刻の情報）の高さだけで決まるようになり
            （半券側の中身に引っ張られて無駄に伸びない）、
          ②バーコード側はtop/left 50%＋translateで、その「チケットの縦幅」そのものの
            真ん中に正確に来る（チケット番号の分だけ上に寄る、ということが起きない）。
        */}
        <div className={`${styles.stubDivider} ${styles.grainAccent} relative px-2 py-1.5 text-[var(--ink)]`}>
          <span className="absolute top-1.5 left-1/2 shrink-0 -translate-x-1/2 rounded-sm border border-[var(--ink)]/70 px-1.5 py-0.5 text-sm font-bold tabular-nums">
            {live.ticketNo}
          </span>

          {/* 「バーコードを少しだけ下げて」の要望で、真ん中(50%)から少しだけ下にずらしている。 */}
          <div
            className="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-2"
            style={{ top: "calc(50% + 10px)" }}
          >
            {/*
              枠のサイズ(46×150)は維持しつつ、中身を縦棒(幅が違う棒を横に並べる)から
              横棒(高さが違う棒を縦に積む)に変更。各棒はflexGrowでパターンの数値に
              比例した高さになるようにし、合計がちょうど枠の高さに収まるようにする。
            */}
            <div
              className="flex flex-col items-stretch"
              style={{ width: BARCODE_WIDTH, height: BARCODE_HEIGHT, gap: BARCODE_BAR_GAP }}
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

            {/*
              高さをBARCODE_HEIGHTに固定してitems-stretchの行に置くと、縦書きの
              「OGIRI LIVE」が収まりきらず2列に折り返ってしまうため、この一角だけは
              高さを固定せず自然な高さのまま中央揃えにする（行全体はitems-center）。
            */}
            <div className="flex flex-col items-center justify-center gap-1">
              <span className="[writing-mode:vertical-rl] text-xs leading-none font-bold tracking-normal">
                OGIRI LIVE
              </span>
              <span className="flex flex-col items-center gap-0.5 text-xs leading-none" aria-hidden>
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
