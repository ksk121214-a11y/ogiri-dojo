"use client";

import Matter from "matter-js";
import { useCallback, useEffect, useRef, useState } from "react";

// サイバーポップな採点演出コンポーネント。お題（または回答）を表示する常設の
// 緑のボードそのもので、外部から渡されたscoreEvents（採点イベントの一覧）を見て、
// まだ玉を降らせていないイベント分だけ、点数の数だけ丸(ボール)をMatter.jsの
// 物理演算で降らせる。誰が押しても（=自分の採点でも、他人の採点がRealtime経由で
// scoreEventsに増えても）同じ経路で玉が増えるので、審査員・観客・回答者のどの画面でも
// 同じ見え方になる。resolvedになってから一呼吸(resolvedPopDelayMs)置くと、残っている
// 玉は「パァン」と弾けて消え、黄金の紙吹雪に変わる。
// 「評価終了→一呼吸→弾ける演出→（司会サーバーのrevealDelayMs分の間）→次の回答/
// 持ち時間再開」という一連の流れになるよう、resolvedPopDelayMsはrevealDelayMsより
// 十分短くしておくこと（呼び出し側のuseJudgingDisplayが、activeAnswerがnullになった
// 瞬間のレンダーでも即座に確定済みの回答を返すようになっているため、この遅延を
// 置いても弾ける前にroundKeyが切り替わって演出が消えることはない）。
// このボード自体は常設（画面が待機中でも判定中でも同じインスタンスのまま）なので、
// 採点ボタンはこのコンポーネントの外（呼び出し側）に置く。roundKeyが変わるたびに
// 玉のカウント・演出フラグだけをリセットする（ボックス自体は再マウントしない）。
// 物理演算・キャンバス描画は全てrAFループ内でrefから直接読み書きし、
// Reactの再レンダーはスコア表示の更新だけに限定している。

export type ScoreEvent = { id: string; points: 0 | 1 | 2 | 3 };

const MAX_BALLS_DEFAULT = 30;
// 確定した瞬間に即座に弾けさせず、一呼吸だけ置いてから弾けさせる。
const RESOLVED_POP_DELAY_DEFAULT_MS = 700;

const BALL_COLORS = [
  "#ffd700", // ゴールド
  "#ffcc33", // 山吹金
  "#f4c430", // サフラン金
  "#e6b422", // 古金
  "#fff2a8", // 淡いハイライト金
];

type Layout = {
  width: number;
  height: number;
  lineY: number;
  ballRadius: number;
};

type PoppingBall = {
  x: number;
  y: number;
  radius: number;
  color: string;
  startedAt: number;
};

type ConfettiPiece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
  startedAt: number;
};

const POP_DURATION_MS = 320;
const CONFETTI_DURATION_MS = 2200;
const GOLD_CONFETTI_COLORS = ["#ffd76a", "#fff1b8", "#ffb703", "#f6d77c"];

// 半径は「maxBalls個ぴったりでボックスが満杯になる」ように理論的に逆算した係数。
// 円のヘックス充填(高さ方向の段積み)で N個・半径rがおおよそ幅Wの箱を満たす条件から
// r ≈ W * sqrt(0.5625 / (3.46*N)) が導けるが、実測(N=30時にr=0.07W相当)に合わせて
// 係数0.3834（= 0.07 * sqrt(30)）にキャリブレーションしてある。これにより審査員が
// 少ない(maxBallsが小さい)組ほど玉が大きく、多い組ほど玉が小さくなり、
// どの人数でも「ちょうど満杯」に見える。
const BALL_RADIUS_COEFFICIENT = 0.3834;

function computeLayout(width: number, height: number, maxBalls: number): Layout {
  return {
    width,
    height,
    lineY: height * (1 / 3),
    ballRadius: (width * BALL_RADIUS_COEFFICIENT) / Math.sqrt(Math.max(1, maxBalls)),
  };
}

function createConfettiBurst(width: number): ConfettiPiece[] {
  return Array.from({ length: 60 }, () => ({
    x: width / 2 + (Math.random() - 0.5) * width * 0.6,
    y: 0,
    vx: (Math.random() - 0.5) * 0.12,
    vy: 0.12 + Math.random() * 0.18,
    rotation: Math.random() * Math.PI,
    rotationSpeed: (Math.random() - 0.5) * 0.008,
    size: 6 + Math.random() * 6,
    color: GOLD_CONFETTI_COLORS[Math.floor(Math.random() * GOLD_CONFETTI_COLORS.length)],
    startedAt: performance.now(),
  }));
}

// src/components/live-demo/ScoringPhysicsBoard.tsxのデザイン確認用コピー。
// ウィンドウを広げてもスマホサイズの見た目を保ちたいため、sm:以上の文字拡大は
// 行わない（本体との差分はこの1点のみ）。
export default function ScoringPhysicsBoardPreview({
  topicBody,
  roundLabel,
  maxBalls = MAX_BALLS_DEFAULT,
  scoreEvents,
  resolved = false,
  resolvedPopDelayMs = RESOLVED_POP_DELAY_DEFAULT_MS,
  roundKey = null,
  onBigLaugh,
  onPerfect,
}: {
  topicBody: string;
  roundLabel?: string;
  maxBalls?: number;
  scoreEvents: ScoreEvent[];
  resolved?: boolean;
  // resolvedになってから実際に玉が弾けるまでの猶予（既定400ms＝一呼吸）。
  // その後「次の回答/持ち時間再開」までの約1.5秒の間は、この値ではなく
  // 呼び出し側（司会サーバー側のLIVE_ROOM_TIMING.revealDelayMs）が担う。
  resolvedPopDelayMs?: number;
  // 採点1回ぶんを識別するキー（例：回答ID）。変わるたびに玉のカウント・演出状態を
  // リセットする。ボード自体（キャンバス・お題文の場所）は常設で再マウントしない。
  roundKey?: string | null;
  onBigLaugh?: () => void;
  onPerfect?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const boundsRef = useRef<Matter.Body[]>([]);
  const ballColorsRef = useRef<Map<number, string>>(new Map());
  const poppingBallsRef = useRef<PoppingBall[]>([]);
  const confettiRef = useRef<ConfettiPiece[]>([]);
  const flashAlphaRef = useRef(0);
  const lineFlashedRef = useRef(false);
  const perfectTriggeredRef = useRef(false);
  const totalSpawnedRef = useRef(0);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const rafRef = useRef<number | null>(null);
  const prevWidthRef = useRef<number | null>(null);
  const maxBallsRef = useRef(maxBalls);
  const onBigLaughRef = useRef(onBigLaugh);
  const spawnedEventIdsRef = useRef<Set<string>>(new Set());
  const prevRoundKeyRef = useRef<string | null>(null);

  const [layout, setLayout] = useState<Layout | null>(null);
  const [totalBalls, setTotalBalls] = useState(0);

  useEffect(() => {
    maxBallsRef.current = maxBalls;
    // maxBalls（審査員数由来の理論上限）が変わったら、新しく降らせる玉の半径にも
    // 反映されるようlayoutを更新する（既存の玉のサイズは変えない）。
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) return;
    setLayout(computeLayout(rect.width, rect.height, maxBalls));
  }, [maxBalls]);
  useEffect(() => {
    onBigLaughRef.current = onBigLaugh;
  }, [onBigLaugh]);

  // コンテナのリサイズに追従して物理ワールドの境界を再構築する。
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const engine = Matter.Engine.create();
    engine.gravity.y = 1;
    engineRef.current = engine;
    const runner = Matter.Runner.create();
    runnerRef.current = runner;
    Matter.Runner.run(runner, engine);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rebuildBounds = (l: Layout) => {
      Matter.Composite.remove(engine.world, boundsRef.current);
      const wallThickness = 24;
      const ground = Matter.Bodies.rectangle(
        l.width / 2,
        l.height + wallThickness / 2,
        l.width * 2,
        wallThickness,
        { isStatic: true },
      );
      const leftWall = Matter.Bodies.rectangle(
        -wallThickness / 2,
        l.height / 2,
        wallThickness,
        l.height * 2,
        { isStatic: true },
      );
      const rightWall = Matter.Bodies.rectangle(
        l.width + wallThickness / 2,
        l.height / 2,
        wallThickness,
        l.height * 2,
        { isStatic: true },
      );
      boundsRef.current = [ground, leftWall, rightWall];
      Matter.Composite.add(engine.world, boundsRef.current);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const l = computeLayout(rect.width, rect.height, maxBallsRef.current);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 既存のボールはMatter.jsの剛体として固定px半径を持っているため、
      // 何もしないとコンテナが縮んでも元のpxサイズのままになり、
      // 「ボックスに対するボールの相対サイズ」が画面サイズによってズレてしまう。
      // 幅の変化率と同じ比率で既存ボールの半径・座標をスケールし直すことで、
      // ボックスとボールの見た目の比率を常に一定に保つ。
      const prevWidth = prevWidthRef.current;
      if (prevWidth && Math.abs(prevWidth - rect.width) > 0.5) {
        const scale = rect.width / prevWidth;
        for (const body of engine.world.bodies) {
          if (!body.circleRadius) continue;
          Matter.Body.scale(body, scale, scale);
          Matter.Body.setPosition(body, {
            x: body.position.x * scale,
            y: body.position.y * scale,
          });
        }
      }
      prevWidthRef.current = rect.width;

      rebuildBounds(l);
      setLayout(l);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const draw = () => {
      const l = computeLayout(
        container.clientWidth,
        container.clientHeight,
        maxBallsRef.current,
      );
      ctx.clearRect(0, 0, l.width, l.height);

      // 大ウケライン（理論上の最大得点の2/3ライン）：見た目の線は非表示。判定にのみ使う。
      const bigLaughThreshold = maxBallsRef.current * (2 / 3);

      // 降下中・堆積中のボール
      const engine = engineRef.current;
      if (engine) {
        for (const body of engine.world.bodies) {
          if (!body.circleRadius) continue;
          const color = ballColorsRef.current.get(body.id) ?? "#ffffff";
          ctx.save();
          ctx.beginPath();
          ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 14;
          ctx.fill();
          ctx.restore();

          if (
            !lineFlashedRef.current &&
            totalSpawnedRef.current > bigLaughThreshold &&
            body.position.y - body.circleRadius <= l.lineY
          ) {
            lineFlashedRef.current = true;
            flashAlphaRef.current = 1;
            onBigLaughRef.current?.();
          }
        }
      }

      // 弾けるボール（満点 or 確定時の演出）
      if (poppingBallsRef.current.length > 0) {
        const now = performance.now();
        poppingBallsRef.current = poppingBallsRef.current.filter((b) => {
          const t = Math.min(1, (now - b.startedAt) / POP_DURATION_MS);
          ctx.save();
          ctx.globalAlpha = 1 - t;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius * (1 + t * 1.8), 0, Math.PI * 2);
          ctx.fillStyle = b.color;
          ctx.shadowColor = b.color;
          ctx.shadowBlur = 20;
          ctx.fill();
          ctx.restore();
          return t < 1;
        });
        if (poppingBallsRef.current.length === 0) {
          confettiRef.current = createConfettiBurst(l.width);
        }
      }

      // 黄金の紙吹雪
      if (confettiRef.current.length > 0) {
        const now = performance.now();
        confettiRef.current = confettiRef.current.filter((c) => {
          const t = (now - c.startedAt) / CONFETTI_DURATION_MS;
          if (t >= 1) return false;
          const x = c.x + c.vx * (now - c.startedAt);
          const y = c.y + c.vy * (now - c.startedAt);
          const rotation = c.rotation + c.rotationSpeed * (now - c.startedAt);
          ctx.save();
          ctx.globalAlpha = 1 - t;
          ctx.translate(x, y);
          ctx.rotate(rotation);
          ctx.fillStyle = c.color;
          ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
          ctx.restore();
          return true;
        });
      }

      // 画面フラッシュ
      if (flashAlphaRef.current > 0) {
        ctx.save();
        ctx.globalAlpha = flashAlphaRef.current;
        ctx.fillStyle = "#fff6d8";
        ctx.fillRect(0, 0, l.width, l.height);
        ctx.restore();
        flashAlphaRef.current = Math.max(0, flashAlphaRef.current - 0.045);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    const timeouts = timeoutsRef.current;
    return () => {
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
    };
  }, []);

  // 残っている玉を「パァン」と弾けさせ、黄金の紙吹雪に変える（関数スタブ：本番演出を
  // より凝ったものに差し替えたい場合はここを拡張する）。満点に達した時と、
  // 採点が確定した(resolved)時の両方から呼ばれるが、二重発火はガードする。
  const triggerPerfectEffect = useCallback(() => {
    if (perfectTriggeredRef.current) return;
    perfectTriggeredRef.current = true;
    const engine = engineRef.current;
    if (!engine) return;
    const balls = engine.world.bodies.filter((b) => b.circleRadius);
    poppingBallsRef.current = balls.map((b) => ({
      x: b.position.x,
      y: b.position.y,
      radius: b.circleRadius ?? 10,
      color: ballColorsRef.current.get(b.id) ?? "#ffffff",
      startedAt: performance.now(),
    }));
    Matter.Composite.remove(engine.world, balls);
    for (const b of balls) ballColorsRef.current.delete(b.id);
    onPerfect?.();
  }, [onPerfect]);

  // ボードは常設なので、採点1回ぶん(roundKey)が切り替わるたびに玉のカウント・
  // 演出フラグだけをリセットする（キャンバス自体は再マウントしない＝常時設置のまま）。
  useEffect(() => {
    if (roundKey === prevRoundKeyRef.current) return;
    prevRoundKeyRef.current = roundKey;

    spawnedEventIdsRef.current = new Set();
    totalSpawnedRef.current = 0;
    setTotalBalls(0);
    perfectTriggeredRef.current = false;
    lineFlashedRef.current = false;
    flashAlphaRef.current = 0;
    poppingBallsRef.current = [];
    confettiRef.current = [];

    const engine = engineRef.current;
    if (engine) {
      const balls = engine.world.bodies.filter((b) => b.circleRadius);
      Matter.Composite.remove(engine.world, balls);
      for (const b of balls) ballColorsRef.current.delete(b.id);
    }
  }, [roundKey]);

  // 理論上の満点まで溜まり、かつ全てのボールがほぼ静止したら弾けさせる（ボーナス演出）。
  useEffect(() => {
    if (totalBalls < maxBalls || perfectTriggeredRef.current) return;
    const checkInterval = setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const balls = engine.world.bodies.filter((b) => b.circleRadius);
      if (balls.length === 0) return;
      const allSettled = balls.every(
        (b) => Matter.Vector.magnitude(b.velocity) < 0.4,
      );
      if (allSettled) {
        clearInterval(checkInterval);
        triggerPerfectEffect();
      }
    }, 150);
    return () => clearInterval(checkInterval);
  }, [totalBalls, maxBalls, triggerPerfectEffect]);

  // 採点が確定した(resolved)瞬間に弾けさせる（既定では遅延0）。
  useEffect(() => {
    if (!resolved) return;
    const t = setTimeout(() => {
      triggerPerfectEffect();
    }, resolvedPopDelayMs);
    return () => clearTimeout(t);
  }, [resolved, resolvedPopDelayMs, triggerPerfectEffect]);

  // 戻り値は「このイベントを既読(=二度と処理しない)にしてよいか」。
  // engine/layoutがまだ準備できていないタイミング(マウント直後、layoutのstate
  // 更新前)でscoreEventsに複数件が既に入っていると、falseを返さずに既読にして
  // しまうと、その分の玉が永久に降ってこなくなる（layoutが後から用意できても
  // 再試行されないため）。false時は呼び出し側で既読登録せず、layoutが整って
  // spawnBallsForPointsの参照が変わった時に自動的に再試行されるようにする。
  const spawnBallsForPoints = useCallback(
    (points: 0 | 1 | 2 | 3): boolean => {
      const engine = engineRef.current;
      const l = layout;
      if (perfectTriggeredRef.current) return true;
      if (!engine || !l) return false;

      const remaining = maxBalls - totalSpawnedRef.current;
      const count = Math.min(points, Math.max(0, remaining));
      if (count === 0) return true;

      for (let i = 0; i < count; i++) {
        const delay = i * (80 + Math.random() * 90);
        const id = setTimeout(() => {
          timeoutsRef.current.delete(id);
          const currentEngine = engineRef.current;
          if (!currentEngine) return;
          const margin = l.ballRadius + 6;
          const x = margin + Math.random() * (l.width - margin * 2);
          const y = -l.ballRadius * 2 - Math.random() * 40;
          const ball = Matter.Bodies.circle(x, y, l.ballRadius, {
            restitution: 0.45,
            friction: 0.08,
            frictionAir: 0.003,
          });
          Matter.Body.setVelocity(ball, { x: (Math.random() - 0.5) * 1.5, y: 0 });
          ballColorsRef.current.set(
            ball.id,
            BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)],
          );
          Matter.Composite.add(currentEngine.world, ball);
          totalSpawnedRef.current += 1;
          setTotalBalls(totalSpawnedRef.current);
        }, delay);
        timeoutsRef.current.add(id);
      }
      return true;
    },
    [layout, maxBalls],
  );

  // scoreEventsに新しく増えた分だけ玉を降らせる。誰の採点でも(自分の投票でも
  // 他人の採点がRealtime経由で増えた分でも)必ずここを通るので、全員の画面で同じ挙動になる。
  useEffect(() => {
    for (const ev of scoreEvents) {
      if (spawnedEventIdsRef.current.has(ev.id)) continue;
      if (spawnBallsForPoints(ev.points)) {
        spawnedEventIdsRef.current.add(ev.id);
      }
    }
  }, [scoreEvents, spawnBallsForPoints]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-2xl border-4 border-dojo-curtain-gold bg-dojo-washi-white shadow-[0_0_30px_rgba(232,184,76,0.35)]"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <span className="absolute left-3 top-2 font-sans text-sm font-bold text-dojo-ink">
        お題
      </span>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center">
        {roundLabel && (
          <p className="font-sans text-xs tracking-widest text-dojo-ink/60">
            {roundLabel}
          </p>
        )}
        <p className="font-sans text-lg font-black leading-snug text-dojo-ink">
          {topicBody}
        </p>
      </div>

      <div className="absolute bottom-2 right-2 rounded-full bg-dojo-stage-dark/80 px-3 py-1 font-sans text-xs font-bold tabular-nums text-dojo-curtain-gold">
        {totalBalls} / {maxBalls}
      </div>
    </div>
  );
}
