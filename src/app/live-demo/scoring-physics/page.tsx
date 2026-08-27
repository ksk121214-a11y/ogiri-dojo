"use client";

import { useState } from "react";

import ScoreButtons from "@/components/live-demo/ScoreButtons";
import ScoringPhysicsBoard, { type ScoreEvent } from "@/components/live-demo/ScoringPhysicsBoard";

const JUDGE_COUNT_PRESETS = [2, 3, 5, 10];

// ScoringPhysicsBoardの単体確認用ページ。実アプリではボードは常設で、
// scoreEventsはuseLiveFollowerStoreのactiveAnswerScoresから作るが、
// ここではボタン操作をそのままscoreEventsに積むことで、審査員1人ぶんの
// 操作を手元で確認できるようにする。「次のラウンドへ」でroundKeyを変えて
// ボードが常設のままカウントだけリセットされることも確認できる。
// 審査員人数プリセットで、人数比に合わせて玉の大きさが変わることも確認できる。
export default function ScoringPhysicsPreviewPage() {
  const [judgeCount, setJudgeCount] = useState(10);
  const [roundIndex, setRoundIndex] = useState(0);
  const [scoreEvents, setScoreEvents] = useState<ScoreEvent[]>([]);
  const [resolved, setResolved] = useState(false);
  const [myScore, setMyScore] = useState<0 | 1 | 2 | 3 | null>(null);

  const maxBalls = judgeCount * 3;
  const totalBalls = scoreEvents.reduce((sum, e) => sum + e.points, 0);
  const roundKey = `round-${roundIndex}`;

  const handleScore = (points: 0 | 1 | 2 | 3) => {
    if (myScore !== null || resolved) return;
    setMyScore(points);
    setScoreEvents((prev) => [...prev, { id: `${roundKey}-${prev.length}`, points }]);
  };

  const handleNextRound = () => {
    setRoundIndex((i) => i + 1);
    setScoreEvents([]);
    setResolved(false);
    setMyScore(null);
  };

  const handleJudgeCountChange = (count: number) => {
    setJudgeCount(count);
    handleNextRound();
  };

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-[#050308] px-4 py-10">
      <p className="font-sans text-xs tracking-widest text-white/50">
        ScoringPhysicsBoard プレビュー（{roundKey} ・ 審査員{judgeCount}人 ・ 満杯{maxBalls}点）
      </p>
      <div className="flex gap-2">
        {JUDGE_COUNT_PRESETS.map((count) => (
          <button
            key={count}
            type="button"
            onClick={() => handleJudgeCountChange(count)}
            className={`rounded-full border px-3 py-1.5 font-sans text-xs transition ${
              judgeCount === count
                ? "border-[#fff23c] text-[#fff23c]"
                : "border-white/30 text-white/60 hover:text-white"
            }`}
          >
            審査員{count}人（満杯{count * 3}点）
          </button>
        ))}
      </div>
      <div className="w-full max-w-2xl space-y-3">
        <ScoringPhysicsBoard
          topicBody="このあと衝撃の展開が待っている宿題の内容とは？"
          roundLabel="第1周 ・ 1組目"
          maxBalls={maxBalls}
          scoreEvents={scoreEvents}
          resolved={resolved}
          roundKey={roundKey}
        />
        <div className="rounded-2xl border border-white/20 bg-white/5 p-4 text-center">
          <p className="font-sans text-xs text-white/50">審査中の回答（ダミー）</p>
          <p className="mt-1 font-sans text-lg font-bold text-white">
            冷蔵庫を開けたら中から見つかった衝撃の宿題
          </p>
        </div>
        <ScoreButtons isJudge myScore={myScore} resolved={resolved} onScore={handleScore} />
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setResolved(true)}
          disabled={resolved || totalBalls === 0}
          className="rounded-full border border-white/40 px-4 py-2 font-sans text-xs text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          採点を締め切る（{totalBalls}点で確定）
        </button>
        <button
          type="button"
          onClick={handleNextRound}
          className="rounded-full border border-white/40 px-4 py-2 font-sans text-xs text-white"
        >
          次のラウンドへ（ボードは常設のまま）
        </button>
      </div>
    </main>
  );
}
