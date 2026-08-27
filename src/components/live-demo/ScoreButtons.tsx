"use client";

import { playSfx } from "@/lib/sfx";
import TimerRing from "./TimerRing";

// ScoringPhysicsBoard（常設の採点ボード）用の採点ボタン。ボードは常設で場所を
// 動かせないため、ボタンはボードの外（回答表示の下）に独立して置けるよう別コンポーネントにした。
// ここでの操作はonScore経由で外部（ストア）に伝わるだけで、実際に玉を降らせるのは
// ScoringPhysicsBoard側がscoreEventsの変化を見て行う。
// 採点タイマーはボタン列の横（0点バツ〜3点玉みっつの並びの隣）に置く。

const SCORE_BUTTONS: { points: 0 | 1 | 2 | 3 }[] = [
  { points: 0 },
  { points: 1 },
  { points: 2 },
  { points: 3 },
];

// scaleUp: sm以上の画面幅でボタンを一段階大きくするか。design-preview側は
// ウィンドウを広げてもスマホサイズの見た目を保ちたいためfalseを渡す
// (本番は何も渡さないためデフォルトtrueのまま今まで通り)。
export default function ScoreButtons({
  isJudge,
  myScore,
  resolved = false,
  disabled = false,
  onScore,
  remainingMs,
  totalMs,
  scaleUp = true,
}: {
  isJudge: boolean;
  myScore: 0 | 1 | 2 | 3 | null;
  resolved?: boolean;
  disabled?: boolean;
  onScore?: (points: 0 | 1 | 2 | 3) => void;
  remainingMs?: number;
  totalMs?: number;
  scaleUp?: boolean;
}) {
  const showTimer = remainingMs !== undefined && totalMs !== undefined;

  // 審査対象外（isJudge=false）の場合は文言を出さない。舞台視点ではタイマーを
  // 送信ボタンの横に別途表示するため、ここでは何も描画しない。
  if (!isJudge) {
    return null;
  }

  const buttonsDisabled = resolved || myScore !== null || disabled;

  return (
    <div className="flex items-center justify-center gap-4">
      {SCORE_BUTTONS.map((btn) => (
        <button
          key={btn.points}
          type="button"
          disabled={buttonsDisabled}
          onClick={() => {
            playSfx("buttonPress");
            onScore?.(btn.points);
          }}
          className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-dojo-washi-white transition hover:scale-105 hover:bg-white/15 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 ${
            scaleUp ? "sm:h-16 sm:w-16" : ""
          } ${
            myScore === btn.points
              ? "border-[#fff23c] bg-white/20 ring-2 ring-[#fff23c]"
              : "border-dojo-washi-white/70 bg-white/5"
          }`}
        >
          <ScoreIcon points={btn.points} scaleUp={scaleUp} />
        </button>
      ))}
      {showTimer && <TimerRing remainingMs={remainingMs!} totalMs={totalMs!} size={44} />}
    </div>
  );
}

function ScoreIcon({ points, scaleUp }: { points: 0 | 1 | 2 | 3; scaleUp: boolean }) {
  const dotSize = scaleUp ? "h-2.5 w-2.5 sm:h-3 sm:w-3" : "h-2.5 w-2.5";
  if (points === 0) {
    return (
      <svg viewBox="0 0 24 24" className={scaleUp ? "h-6 w-6 sm:h-7 sm:w-7" : "h-6 w-6"}>
        <line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="19" y1="5" x2="5" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (points === 1) {
    return <span className={`block rounded-full bg-current ${dotSize}`} />;
  }
  if (points === 2) {
    return (
      <span className="flex items-center gap-2">
        <span className={`block rounded-full bg-current ${dotSize}`} />
        <span className={`block rounded-full bg-current ${dotSize}`} />
      </span>
    );
  }
  return (
    <span className="flex flex-col items-center gap-1.5">
      <span className={`block rounded-full bg-current ${dotSize}`} />
      <span className="flex gap-2">
        <span className={`block rounded-full bg-current ${dotSize}`} />
        <span className={`block rounded-full bg-current ${dotSize}`} />
      </span>
    </span>
  );
}
