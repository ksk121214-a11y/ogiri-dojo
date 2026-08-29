"use client";

import { useEffect, useRef } from "react";

import { playSfx } from "@/lib/sfx";

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

// 2026-08-29:「参加する」成功時に右側の赤い半券が切り離されるアニメーションに対応。
// 本体（本券）と半券を独立したDOM要素に分離した（マイページの寄合券スタンプ欄と同じ
// .xxxRow/.xxxMain/.xxxStub構成、詳しくはStadiumHome.module.cssのコメント参照）。
// - stubVisible=false: 半券自体を描画しない（参加済みの場合、最初から外れた状態）
// - isDetaching=true: 半券に切り離しアニメーションのクラスを付け、終わったら
//   onDetachAnimationEndを呼ぶ（フォールバックタイマー込み、呼び出し元はuseLiveJoinFlow）
export default function NextLiveTicket({
  live,
  stubVisible = true,
  isDetaching = false,
  onDetachAnimationEnd,
}: {
  live: NextLiveInfo;
  stubVisible?: boolean;
  isDetaching?: boolean;
  onDetachAnimationEnd?: () => void;
}) {
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDetaching) return;

    // 半券が外れる瞬間に紙を切る音を鳴らす（SE設定がOFFならplaySfx内部で何もしない）。
    playSfx("ticketTear");

    // アニメーション終了イベント(onAnimationEnd)が何らかの理由で発火しなかった場合の
    // 保険。本体のアニメーションは700ms（nextLiveTicketStubDetach）なので少し余裕を
    // 持たせる。reduced-motion時はアニメーション自体が短い(150ms)ため、タイマーも短くする。
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(
      () => {
        onDetachAnimationEnd?.();
      },
      reduced ? 300 : 900,
    );
    fallbackTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      fallbackTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDetaching]);

  const handleAnimationEnd = () => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    onDetachAnimationEnd?.();
  };

  return (
    // 「次回ライブ」タグは内側の.nextLiveTicketMain（切り欠き演出のためoverflow:hiddenが
    // 掛かっている）の外側に置く。内側の子にすると上にはみ出した分がクリップされ
    // 半分隠れてしまうため。
    <div className="relative">
      <span className={`${styles.grainAccent} absolute -top-2.5 left-4 z-10 rounded-sm px-2 py-0.5 text-sm font-bold tracking-widest text-[var(--paper)] shadow-none`}>
        次回ライブ
      </span>

      <div className={styles.nextLiveTicketRow}>
        <div className={`${styles.nextLiveTicketMain} ${styles.grainPaper}`}>
          <div className={`${styles.scallopDivider} ${styles.scallopDark}`} aria-hidden />
          <div className={`${styles.scallopCapTop} ${styles.scallopDark}`} aria-hidden />
          <div className={`${styles.scallopCapBottom} ${styles.scallopDark}`} aria-hidden />

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
        </div>

        {/*
          添付の実物チケット画像に合わせたレイアウト：チケット番号を上に置き、その下は
          「大きく広げた縦棒バーコード」と「OGIRI LIVE＋星」を横並びにする
          （以前は縦一列にすべて積んでいたが、画像のように横に並べる形へ変更）。
          チケット番号・バーコード＋OGIRI LIVEの行、どちらもabsoluteにしてこの列の
          通常のフローから完全に外す。これにより、
          ①チケットの縦幅は左カラム（日付・時刻の情報）の高さだけで決まるようになり
            （半券側の中身に引っ張られて無駄に伸びない）、
          ②バーコード側はtop/left 50%＋translateで、その「チケットの縦幅」そのものの
            真ん中に正確に来る（チケット番号の分だけ上に寄る、ということが起きない）。
        */}
        {stubVisible && (
          <div
            className={`${styles.nextLiveTicketStub} ${styles.grainAccent} relative px-2 py-1.5 text-[var(--ink)] ${
              isDetaching ? styles.nextLiveTicketStubDetaching : ""
            }`}
            onAnimationEnd={isDetaching ? handleAnimationEnd : undefined}
          >
            {/*
              半券の左端にも本体側（.nextLiveTicketMain）の.scallopDividerと同じ
              座標のミシン目を重ねる（マイページのMyProfileTicket.tsxと同じ手法）。
              これが無いと、本体側だけギザギザで半券側の左端がまっすぐに見えてしまう。
            */}
            <div className={`${styles.scallopDividerLeft} ${styles.scallopDark}`} aria-hidden />
            {/* 本体側（.scallopCapTop/.scallopCapBottom）と同じ丸い切り欠きを、半券の
                左上・左下にも重ねる（本体の右側の角と同じ丸みに揃える）。 */}
            <div className={`${styles.scallopCapTopLeft} ${styles.scallopDark}`} aria-hidden />
            <div className={`${styles.scallopCapBottomLeft} ${styles.scallopDark}`} aria-hidden />

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
        )}
      </div>
    </div>
  );
}
