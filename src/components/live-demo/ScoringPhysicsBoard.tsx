"use client";

import Matter from "matter-js";
import { useCallback, useEffect, useRef, useState } from "react";

import { playSfx } from "@/lib/sfx";

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
  "#ff1744", // 赤
  "#ff6d00", // 橙
  "#ffea00", // 黄
  "#00e676", // 緑
  "#00e5ff", // 青緑
  "#0091ff", // 青
  "#6a5cff", // 藍
  "#e000ff", // 紫
  "#ff1493", // ピンク
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
  // 満点(maxBalls)到達での弾け＝isPerfect。虹色のまま弾ける通常時と違い、
  // 金色に染めた上でグロー(shadowBlur)を強めた特別な弾け方にする。
  isPerfect: boolean;
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

export const POP_DURATION_MS = 320;
const CONFETTI_DURATION_MS = 2200;
const GOLD_CONFETTI_COLORS = ["#ffd76a", "#fff1b8", "#ffb703", "#f6d77c"];
// 満点到達時、玉を虹色のまま弾けさせず全て金色に染める。
const PERFECT_BALL_COLOR = "#ffd700";
// 満点に達してから、積み上がった玉が虹色→金色に少しずつ変わりきるまでの時間。
// 満点＝弾ける、を即座につなげず、「溜まる→間を置いて金色に染まっていく→弾ける」と
// 一呼吸ずつ演出を挟むための猶予（誕生日会に近い盛り上げ方をイメージ）。
const GOLD_TRANSITION_MS = 900;
// 金色に染まりきってから、実際に弾けるまでのさらなる余韻。
const PERFECT_POP_HOLD_MS = 350;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(from: string, to: string, t: number): string {
  const [fr, fg, fb] = hexToRgb(from);
  const [tr, tg, tb] = hexToRgb(to);
  const r = Math.round(fr + (tr - fr) * t);
  const g = Math.round(fg + (tg - fg) * t);
  const b = Math.round(fb + (tb - fb) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

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

function createConfettiBurst(width: number, colors: string[], count = 60): ConfettiPiece[] {
  return Array.from({ length: count }, () => ({
    x: width / 2 + (Math.random() - 0.5) * width * 0.6,
    y: 0,
    vx: (Math.random() - 0.5) * 0.12,
    vy: 0.12 + Math.random() * 0.18,
    rotation: Math.random() * Math.PI,
    rotationSpeed: (Math.random() - 0.5) * 0.008,
    size: 6 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    startedAt: performance.now(),
  }));
}

export default function ScoringPhysicsBoard({
  topicBody,
  roundLabel,
  maxBalls = MAX_BALLS_DEFAULT,
  scoreEvents,
  resolved = false,
  confirmedPerfect = null,
  resolvedPopDelayMs = RESOLVED_POP_DELAY_DEFAULT_MS,
  roundKey = null,
  onBigLaugh,
  onPerfect,
  variant = "dojo",
}: {
  topicBody: string;
  roundLabel?: string;
  maxBalls?: number;
  scoreEvents: ScoreEvent[];
  resolved?: boolean;
  // 2026-09-03:「満点じゃないのに金になる」不具合対策。以前はresolved時の弾けが
  // 「このクライアントが積み上げたボール数(totalSpawned) >= 分母(maxBalls)」という
  // クライアントローカルな判定だけに頼っていた。分母自体は全端末共通になった
  // （0049）が、ボールのスポーンはRealtimeイベントの到着順序の影響を受けうるため、
  // 「今この端末に何個描画できているか」はまだ満点判定の正としては使えない。
  // resolved（採点確定）と同時に、呼び出し元がanswers.judge_count>0 &&
  // answers.top_score_votes===answers.judge_countというDBの確定値から渡せる場合は
  // それを優先する（true=満点確定／false=満点でないことが確定／null=まだ確定前
  // ＝満点到達によるボーナス演出用の従来のローカル判定にフォールバック）。
  confirmedPerfect?: boolean | null;
  // resolvedになってから実際に玉が弾けるまでの猶予（既定400ms＝一呼吸）。
  // その後「次の回答/持ち時間再開」までの約1.5秒の間は、この値ではなく
  // 呼び出し側（司会サーバー側のLIVE_ROOM_TIMING.revealDelayMs）が担う。
  resolvedPopDelayMs?: number;
  // 採点1回ぶんを識別するキー（例：回答ID）。変わるたびに玉のカウント・演出状態を
  // リセットする。ボード自体（キャンバス・お題文の場所）は常設で再マウントしない。
  roundKey?: string | null;
  onBigLaugh?: () => void;
  onPerfect?: () => void;
  // このファイルはlive-demo専用ではなく、本番のlive-room（StageAnsweringView/
  // AudienceAnsweringView）からも直接importされている共有コンポーネントのため、
  // 既存の呼び出し箇所（variant省略＝"dojo"）の見た目・サイズ決定方式は一切変えない。
  // variant="neon2"：design-preview-2（隠しURL /live/design-preview-2）と同じ白地・
  // 青枠デザインに切り替える。この場合、自分でaspect-videoを持たず親要素いっぱいに
  // 広がる（親側でfitAspectして正しい比率のbox幅・高さを渡す想定）。
  // 物理演算・玉の色・スコア判定ロジックはvariantに関わらず完全に同一。
  variant?: "dojo" | "neon2";
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
  // 直近に弾けたのが満点だったか。紙吹雪の色を「満点なら金色、それ以外は玉と同じ
  // 虹色」に出し分けるために使う（紙吹雪は玉が全て弾け終わってから作られるため、
  // 弾け中の色情報とは別に持っておく必要がある）。
  const lastPopWasPerfectRef = useRef(false);
  // 満点(maxBalls)に最初に到達した時刻。これを起点に、積み上がった玉を虹色→金色へ
  // 少しずつ染めるアニメーションと、実際に弾けるまでの一呼吸(PERFECT_POP_HOLD_MS)を計る。
  const perfectReachedAtRef = useRef<number | null>(null);
  const totalSpawnedRef = useRef(0);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // 2026-09-04:「予約済みボールを回答間で持ち越さない」対策。玉のスポーン
  // (spawnBallsForPoints)・重なり回避の再試行(trySpawnOneBall)のsetTimeoutだけを
  // 別のSetで管理し、roundKey切替時にここだけを狙ってキャンセルできるようにする
  // （timeoutsRefは採点確定(resolved)の弾けタイマーと共用のため、そちらは
  // 誤って巻き込まない）。
  const spawnTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const rafRef = useRef<number | null>(null);
  const prevWidthRef = useRef<number | null>(null);
  const prevHeightRef = useRef<number | null>(null);
  // 2026-08-30:「満点じゃないのに金になる／点数分の玉が出ない／玉が出ない時がある」
  // 対策。maxBallsは呼び出し元でeligibleJudgeCount（審査資格のある参加者数）から
  // 動的に計算されており、審査サイクルの最中にも参加者の入退室で変動しうる値。
  // 以前はpropsのmaxBallsが変わるたびにmaxBallsRef.currentを即座に上書きしていた
  // ため、「5人ぶん(15個)降っている途中で審査員が減ってmaxBallsが3に下がる」と
  // totalSpawnedRef(15) >= maxBallsRef(3) が真になり、実際は満点でないのに満点判定
  // されて弾け、かつ以降のspawnBallsForPointsはperfectTriggeredRef済みとして
  // 即座に捨てられる（＝以降の採点の玉が一切出ない）という不整合を起こしていた。
  // 1回答の審査サイクル中はmaxBallsを固定し、roundKeyが切り替わるタイミング
  // （＝次の回答の審査に移る瞬間）でだけ、その時点の最新値を取り込むようにする。
  const maxBallsRef = useRef(maxBalls);
  const latestMaxBallsPropRef = useRef(maxBalls);
  const onBigLaughRef = useRef(onBigLaugh);
  // 2026-09-03: 満点判定をDBの確定値に委ねるための参照（confirmedPerfect参照）。
  const confirmedPerfectRef = useRef<boolean | null>(confirmedPerfect);
  const spawnedEventIdsRef = useRef<Set<string>>(new Set());
  const prevRoundKeyRef = useRef<string | null>(null);

  const [layout, setLayout] = useState<Layout | null>(null);
  // 2026-09-03:「setTimeout内では古いlayoutではなく最新を使う」対策。
  // spawnBallsForPointsは玉ごとに数十〜数百msの遅延を挟んでMatter.jsへ追加するため、
  // 呼び出し時点でクロージャに閉じ込めたlayout(state)のままだと、その間にリサイズが
  // 起きた場合に古い壁の内側基準で座標を計算してしまい、新しい壁の外側に出現する
  // ことがあった。setTimeoutの中では常にこのrefの最新値を読む。
  const layoutRef = useRef<Layout | null>(null);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  // 2026-09-03:「別々に届くRealtimeイベント間でも玉の出現をずらす」対策。
  // 以前はこのuseEffect呼び出し（＝1回の描画バッチ）ごとに{current:0}を新しく
  // 作っていたため、scoreEventsが複数回に分けて（＝別々のRealtimeイベントの
  // 到着として）届くたびに連番が0へ戻り、直前のバッチでまだ発火していない
  // setTimeoutと同じタイミングで新しいバッチの玉が出現しうる状態だった。
  // 「次に玉を出現させてよい時刻」をコンポーネント生存期間を通して1本の
  // タイムライン(performance.now()基準)として持つことで、呼び出し元の
  // レンダーがいつ起きたかに関わらず一定間隔で出現をずらせるようにする。
  const nextSpawnAtRef = useRef(0);
  // 2026-09-04:「予約済みボールを回答間で持ち越さない」対策。roundKeyが切り替わっても、
  // 前の回答ぶんで既にsetTimeoutでスケジュール済みだった玉が後から発火し、新しい回答の
  // ボードに紛れ込んでいた（roundKey変更時のリセットは物理ワールドの玉やrefは戻すが、
  // 既に発行済みのsetTimeoutハンドル自体はキャンセルしていなかったため）。roundKeyが
  // 変わるたびに1増える世代IDを持たせ、スケジュール時点の世代を閉じ込めておいて、
  // 実際に発火した時点で世代が variable ズレていれば何もせず終了する。
  const generationRef = useRef(0);
  // spawnBallsForPoints呼び出し時点でのtotalSpawnedRef（=実際に追加済みの玉数）だけを
  // 見てremainingを計算すると、直前の呼び出しでスケジュール済み（まだ発火前）の玉を
  // 二重に数えてしまい、maxBallsを超えてスケジュールしうる。スケジュールした時点で
  // 即座に加算する「予約込みの個数」を別に持つ。
  const scheduledCountRef = useRef(0);
  // 2026-09-04:「空き位置探索を諦めて重ねて生成する」対策。ランダム位置＋
  // 既存ボールとの距離チェック＋リトライ、という方式は「何回失敗したら
  // 諦めるか」の閾値が必ず必要になり、閾値を超えると重ねて生成するしかなく
  // なる。決定的なスポーンレーン方式（幅を「直径以上」離れたレーンに分割し、
  // 生成するたびに次のレーンへ順送りする）に変更し、そもそも重なりうる
  // 候補を選ばないようにする（リトライ自体が不要になる）。
  const laneCursorRef = useRef(0);
  const [totalBalls, setTotalBalls] = useState(0);
  // "X / Y"表示のYも、ロジックと同じ固定値を見せる（propsのmaxBallsをそのまま
  // 表示すると、審査サイクル中に分母だけ動いて見える不整合になるため）。
  const [fixedMaxBalls, setFixedMaxBalls] = useState(maxBalls);

  useEffect(() => {
    latestMaxBallsPropRef.current = maxBalls;
  }, [maxBalls]);
  useEffect(() => {
    onBigLaughRef.current = onBigLaugh;
  }, [onBigLaugh]);
  useEffect(() => {
    confirmedPerfectRef.current = confirmedPerfect;
  }, [confirmedPerfect]);

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
      // 幅の変化率と同じ比率で既存ボールの半径をスケールし直すことで、
      // ボックスとボールの見た目の比率を常に一定に保つ（半径の計算式自体が
      // computeLayoutで幅基準になっているため、半径は幅の変化率だけを使う）。
      //
      // 2026-09-03:「リサイズ後にボールが枠を無視する／はみ出す」不具合対策。
      // 以前はy座標も幅の変化率(scaleX)でスケールしていたため、幅と高さが
      // 異なる比率で変化するリサイズ（アスペクト比が変わる場合。スマホの
      // キーボード表示・画面回転・親要素のレイアウト変化等）が起きると、
      // 縦方向の位置だけ実際の高さの変化と食い違って計算され、既存のボールが
      // 新しい壁の外（画面下端の外や、逆に浮いた位置）に取り残されることが
      // あった。x/yそれぞれの実際の変化率(scaleX/scaleY)で個別にスケールする。
      const prevWidth = prevWidthRef.current;
      const prevHeight = prevHeightRef.current;
      const widthChanged = prevWidth !== null && Math.abs(prevWidth - rect.width) > 0.5;
      const heightChanged = prevHeight !== null && Math.abs(prevHeight - rect.height) > 0.5;
      if (widthChanged || heightChanged) {
        const scaleX = prevWidth ? rect.width / prevWidth : 1;
        const scaleY = prevHeight ? rect.height / prevHeight : 1;
        for (const body of engine.world.bodies) {
          if (!body.circleRadius) continue;
          Matter.Body.scale(body, scaleX, scaleX);
          Matter.Body.setPosition(body, {
            x: body.position.x * scaleX,
            y: body.position.y * scaleY,
          });
        }
      }
      prevWidthRef.current = rect.width;
      prevHeightRef.current = rect.height;

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

      // 満点に達していて、まだ弾けていなければ、積み上がった玉を虹色→金色へ
      // 少しずつ染めていく（GOLD_TRANSITION_MSかけて進行度0→1）。
      const frameNow = performance.now();
      const isPerfectPending =
        totalSpawnedRef.current >= maxBallsRef.current && !perfectTriggeredRef.current;
      if (isPerfectPending && perfectReachedAtRef.current === null) {
        perfectReachedAtRef.current = frameNow;
      }
      const goldProgress =
        isPerfectPending && perfectReachedAtRef.current !== null
          ? Math.min(1, (frameNow - perfectReachedAtRef.current) / GOLD_TRANSITION_MS)
          : 0;

      // 降下中・堆積中のボール
      const engine = engineRef.current;
      if (engine) {
        for (const body of engine.world.bodies) {
          if (!body.circleRadius) continue;
          const baseColor = ballColorsRef.current.get(body.id) ?? "#ffffff";
          const color =
            goldProgress > 0 ? lerpColor(baseColor, PERFECT_BALL_COLOR, goldProgress) : baseColor;
          // shadowBlurはCanvas 2Dの中でも特に重い操作で、堆積中の玉すべてに毎フレーム
          // かけると（審査員が多い組では最大数十個）メインスレッドを圧迫し、setTimeout等の
          // 他の処理まで遅延させる原因になっていた（効果音が遅れて鳴る・演出が出ない等）。
          // グロー感は縁取り+中心のハイライトで代替し、shadowBlurは弾ける一瞬(popping)だけに絞る。
          ctx.beginPath();
          ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(
            body.position.x - body.circleRadius * 0.3,
            body.position.y - body.circleRadius * 0.3,
            body.circleRadius * 0.35,
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fill();

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
          ctx.arc(b.x, b.y, b.radius * (1 + t * (b.isPerfect ? 2.6 : 1.8)), 0, Math.PI * 2);
          ctx.fillStyle = b.color;
          ctx.shadowColor = b.color;
          ctx.shadowBlur = b.isPerfect ? 34 : 20;
          ctx.fill();
          ctx.restore();
          return t < 1;
        });
        if (poppingBallsRef.current.length === 0) {
          confettiRef.current = createConfettiBurst(
            l.width,
            lastPopWasPerfectRef.current ? GOLD_CONFETTI_COLORS : BALL_COLORS,
            lastPopWasPerfectRef.current ? 100 : 60,
          );
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
    const spawnTimeouts = spawnTimeoutsRef.current;
    return () => {
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
      for (const id of spawnTimeouts) clearTimeout(id);
      spawnTimeouts.clear();
    };
  }, []);

  // 残っている玉を「パァン」と弾けさせ、黄金の紙吹雪に変える（関数スタブ：本番演出を
  // より凝ったものに差し替えたい場合はここを拡張する）。満点に達した時と、
  // 採点が確定した(resolved)時の両方から呼ばれるが、二重発火はガードする。
  // 実際に満点(totalSpawnedRef.current >= maxBalls)に達している場合だけ、
  // 玉を虹色のまま弾けさせずPERFECT_BALL_COLOR(金色)に染めてグローを強める。
  const triggerPerfectEffect = useCallback(() => {
    if (perfectTriggeredRef.current) return;
    perfectTriggeredRef.current = true;
    const engine = engineRef.current;
    if (!engine) return;
    const balls = engine.world.bodies.filter((b) => b.circleRadius);
    if (balls.length === 0) {
      // 誰も点を入れず玉が1個も無い（0点）場合は、弾ける演出も音も鳴らさない
      // （「0ポイントなのに弾ける音がする」対策）。
      lastPopWasPerfectRef.current = false;
      onPerfect?.();
      return;
    }
    // 2026-09-03:「満点じゃないのに金になる」不具合対策。DBの確定値
    // (confirmedPerfectRef、answers.judge_count>0 && answers.top_score_votes===
    // answers.judge_countから呼び出し元が渡す)が分かっていればそれを最優先する。
    // まだ確定前（理論上の満点まで溜まった時点でのボーナス演出、resolved前）は
    // 従来通りローカルの積み上げ数で判定する。
    const isPerfectScore =
      confirmedPerfectRef.current ?? totalSpawnedRef.current >= maxBallsRef.current;
    poppingBallsRef.current = balls.map((b) => ({
      x: b.position.x,
      y: b.position.y,
      radius: b.circleRadius ?? 10,
      color: isPerfectScore
        ? PERFECT_BALL_COLOR
        : (ballColorsRef.current.get(b.id) ?? "#ffffff"),
      startedAt: performance.now(),
      isPerfect: isPerfectScore,
    }));
    Matter.Composite.remove(engine.world, balls);
    for (const b of balls) ballColorsRef.current.delete(b.id);
    lastPopWasPerfectRef.current = isPerfectScore;
    // 満点の弾けをより派手に：通常の大ウケフラッシュと同じ仕組みで画面を軽く光らせる。
    if (isPerfectScore) {
      flashAlphaRef.current = 1;
    }
    playSfx(isPerfectScore ? "perfect" : "scoreReveal");
    onPerfect?.();
  }, [onPerfect]);

  // ボードは常設なので、採点1回ぶん(roundKey)が切り替わるたびに玉のカウント・
  // 演出フラグだけをリセットする（キャンバス自体は再マウントしない＝常時設置のまま）。
  useEffect(() => {
    if (roundKey === prevRoundKeyRef.current) return;
    prevRoundKeyRef.current = roundKey;

    // 次の回答の審査に移るこのタイミングでだけ、maxBallsの最新値を取り込んで固定する。
    maxBallsRef.current = latestMaxBallsPropRef.current;
    setFixedMaxBalls(latestMaxBallsPropRef.current);

    spawnedEventIdsRef.current = new Set();
    totalSpawnedRef.current = 0;
    setTotalBalls(0);
    // 次の回答のキュー・タイマーを前の回答から持ち越さない（安全なリセット）。
    nextSpawnAtRef.current = 0;
    scheduledCountRef.current = 0;
    laneCursorRef.current = 0;
    // 2026-09-04:「予約済みボールを回答間で持ち越さない」対策。世代IDを進めて
    // おくことで、既に発行済み（キャンセルし損ねた場合も含む）のsetTimeout
    // コールバックが後から発火しても、古い世代だと分かって何もせず終了する
    // （二重の安全策）。加えて、まだ発火していないスポーン/リトライの
    // setTimeout自体もここで積極的にキャンセルする。
    generationRef.current += 1;
    for (const id of spawnTimeoutsRef.current) clearTimeout(id);
    spawnTimeoutsRef.current.clear();
    perfectTriggeredRef.current = false;
    perfectReachedAtRef.current = null;
    lineFlashedRef.current = false;
    flashAlphaRef.current = 0;
    poppingBallsRef.current = [];
    confettiRef.current = [];
    // 前の回答のconfirmedPerfectを次の回答へ持ち越さない（新しい回答自身の
    // resolved更新が来るまではnull＝未確定として扱う）。
    confirmedPerfectRef.current = null;

    const engine = engineRef.current;
    if (engine) {
      const balls = engine.world.bodies.filter((b) => b.circleRadius);
      Matter.Composite.remove(engine.world, balls);
      for (const b of balls) ballColorsRef.current.delete(b.id);
    }
  }, [roundKey]);

  // 理論上の満点まで溜まり、かつ全てのボールがほぼ静止したら弾けさせる（ボーナス演出）。
  // 静止した瞬間に即座に弾けさせず、金色に染まりきる(GOLD_TRANSITION_MS)のを見せた上で
  // さらに一呼吸(PERFECT_POP_HOLD_MS)置いてから弾けるようにする。
  useEffect(() => {
    if (totalBalls < fixedMaxBalls || perfectTriggeredRef.current) return;
    const checkInterval = setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const balls = engine.world.bodies.filter((b) => b.circleRadius);
      if (balls.length === 0) return;
      const allSettled = balls.every(
        (b) => Matter.Vector.magnitude(b.velocity) < 0.4,
      );
      if (!allSettled) return;
      const reachedAt = perfectReachedAtRef.current;
      if (
        reachedAt !== null &&
        performance.now() - reachedAt < GOLD_TRANSITION_MS + PERFECT_POP_HOLD_MS
      ) {
        return;
      }
      clearInterval(checkInterval);
      triggerPerfectEffect();
    }, 150);
    return () => clearInterval(checkInterval);
  }, [totalBalls, fixedMaxBalls, triggerPerfectEffect]);

  // 採点が確定した(resolved)瞬間に弾けさせる（既定では遅延0）。満点の場合は、
  // 金色に染まりきる猶予(GOLD_TRANSITION_MS+PERFECT_POP_HOLD_MS)が
  // resolvedPopDelayMsより短い呼び出し元でも、染まりきる前に弾けてしまわないよう
  // 追加で待つ（通常の呼び出し元はresolvedPopDelayMsの方が十分長いため実質発火しない）。
  useEffect(() => {
    if (!resolved) return;
    const timeouts = timeoutsRef.current;
    const t = setTimeout(() => {
      const isPerfectPending =
        totalSpawnedRef.current >= maxBallsRef.current && !perfectTriggeredRef.current;
      const reachedAt = perfectReachedAtRef.current;
      const remaining =
        isPerfectPending && reachedAt !== null
          ? GOLD_TRANSITION_MS + PERFECT_POP_HOLD_MS - (performance.now() - reachedAt)
          : 0;
      if (remaining > 0) {
        const t2 = setTimeout(() => triggerPerfectEffect(), remaining);
        timeouts.add(t2);
        return;
      }
      triggerPerfectEffect();
    }, resolvedPopDelayMs);
    timeouts.add(t);
    return () => {
      clearTimeout(t);
      timeouts.delete(t);
    };
  }, [resolved, resolvedPopDelayMs, triggerPerfectEffect]);

  // 自分自身をsetTimeoutの中から再帰的に呼ぶため、useCallbackの戻り値を直接
  // 名指しで参照すると「宣言前にアクセスしている」エラーになる。refに常に
  // 最新の関数を入れておき、再帰呼び出しはref経由で行う。
  const trySpawnOneBallRef = useRef<(generation: number) => void>(() => {});

  // 実際に1個の玉を追加する。generationは呼び出し（＝スケジュール）時点の
  // 世代を閉じ込めておき、実際に発火した時点で世代がズレていれば
  // （＝roundKeyが切り替わっていれば）何もしない。
  const trySpawnOneBall = useCallback((generation: number) => {
    // 2026-09-04:「roundKey切替時に持ち越さない」対策その1。世代が変わっていれば
    // このコールバックはもう無効（古い回答のぶん）なので、何もせず終了する。
    if (generation !== generationRef.current) return;
    // 2026-09-04:「resolved後・perfectTriggered後に予約済みcallbackが新しいボールを
    // 追加しない」対策。弾け演出が既に発生した後にスケジュール済みの玉が発火しても、
    // 弾けた後のボードに紛れ込ませない。
    if (perfectTriggeredRef.current) return;
    const currentEngine = engineRef.current;
    // 2026-09-03:「setTimeout内では古いlayoutではなく最新のlayoutRefを使う」対策。
    // 玉ごとに数十〜数百ms遅延するため、呼び出し時点でクロージャに閉じ込めた
    // layoutのままだと、その間にリサイズが起きた場合、古い壁の内側基準で
    // 座標を計算してしまい新しい壁の外側に出現することがあった。
    const currentLayout = layoutRef.current;
    if (!currentEngine || !currentLayout) return;
    const margin = currentLayout.ballRadius + 6;
    const minX = margin;
    const maxX = Math.max(margin, currentLayout.width - margin);
    const minGap = currentLayout.ballRadius * 2; // 直径以上の距離
    const usableWidth = Math.max(0, maxX - minX);
    const laneCount = Math.max(1, Math.floor(usableWidth / minGap) + 1);
    const laneStep = laneCount > 1 ? usableWidth / (laneCount - 1) : 0;
    const laneCenterX = (i: number) => (laneCount > 1 ? minX + i * laneStep : (minX + maxX) / 2);
    const spawnY = -currentLayout.ballRadius * 2 - Math.random() * 40;

    // 2026-09-05:「レーン数を超えると同じレーンを再利用し、そのレーンの
    // 既存ボールがまだ直径分落下していない場合に重なる」不具合対策。
    // 決定的なレーン割り当てを第一候補にしつつも、そのレーン（＋念のため
    // 他の全レーン）に既存ボールが直径未満の距離まで来ていないかを実際に
    // 確認してから採用する。既存ボールは常にスポーン地点(spawnY)付近に
    // いる時だけ危険なので、判定はスポーン地点からの2次元距離で行う。
    const existingBalls = currentEngine.world.bodies
      .filter((b) => b.circleRadius)
      .map((b) => ({ x: b.position.x, y: b.position.y }));

    let chosenX: number | null = null;
    let chosenLane = laneCursorRef.current % laneCount;
    for (let attempt = 0; attempt < laneCount; attempt++) {
      const candidateLane = (laneCursorRef.current + attempt) % laneCount;
      const jitter = laneCount > 1 ? (Math.random() - 0.5) * minGap * 0.25 : 0;
      const candidateX = Math.min(maxX, Math.max(minX, laneCenterX(candidateLane) + jitter));
      const tooClose = existingBalls.some(
        (b) => Math.hypot(b.x - candidateX, b.y - spawnY) < minGap,
      );
      if (!tooClose) {
        chosenX = candidateX;
        chosenLane = candidateLane;
        break;
      }
    }

    if (chosenX === null) {
      // 2026-09-05: 全レーンがまだ埋まっている（＝生成が短時間に集中し、
      // 前の玉がまだ落下しきっていない）。重ねて生成せず、世代・
      // perfectTriggeredのガードを保ったまま少し待って再試行する
      // （スポーン領域が空くまで延期する方式。無限に残り続けることはない：
      // roundKey切替でgenerationがズレる、または弾け演出でperfectTriggered
      // になった時点で次の発火は即座に何もせず終了する）。
      const retryId = setTimeout(
        () => {
          spawnTimeoutsRef.current.delete(retryId);
          trySpawnOneBallRef.current(generation);
        },
        50 + Math.random() * 40,
      );
      spawnTimeoutsRef.current.add(retryId);
      return;
    }

    laneCursorRef.current = chosenLane + 1;

    const ball = Matter.Bodies.circle(chosenX, spawnY, currentLayout.ballRadius, {
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
  }, []);
  useEffect(() => {
    trySpawnOneBallRef.current = trySpawnOneBall;
  }, [trySpawnOneBall]);

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

      // このroundKey（1回答の審査サイクル）中に固定したmaxBallsRef.currentで判定する。
      // propsのmaxBalls（審査員数の増減で動く）を直接使うと、審査中に上限が下がった
      // 瞬間、既に降らせた玉数との差分(remaining)が負になり、点数分の玉が出なくなる
      // 不整合が起きるため。
      // 2026-09-04:「現在のremaining計算では予約済み個数を考慮していない」対策。
      // totalSpawnedRef（実際にMatter.jsへ追加済みの数）だけを見ると、直前の
      // 呼び出しでスケジュール済み（まだ発火前でtotalSpawnedRefに未反映）の玉を
      // 二重に数えてしまい、maxBallsを超えてスケジュールしうる。「予約込みの
      // 個数」であるscheduledCountRefを基準にする。
      const remaining = maxBallsRef.current - scheduledCountRef.current;
      const count = Math.min(points, Math.max(0, remaining));
      if (count === 0) return true;

      const generation = generationRef.current;
      const STAGGER_MS = 80;
      const STAGGER_JITTER_MS = 90;
      for (let i = 0; i < count; i++) {
        // スケジュールした時点で即座に加算する（実際にMatter.jsへ追加されるのは
        // 後述のsetTimeout発火後だが、それまでの間も「予約済み」として数える）。
        scheduledCountRef.current += 1;
        // 2026-09-03:「scoreEvents全体・かつ別々に届くRealtimeイベント間でも
        // 共通のspawnキューを使い、同時出現を防ぐ」対策。以前はこのuseEffect
        // 呼び出し（＝1回の描画バッチ）ごとにリセットされる連番を使っており、
        // 別のバッチ（＝別のRealtimeイベントの到着）で届いた玉が、直前のバッチの
        // 玉とほぼ同時に出現しうる状態だった。コンポーネント生存期間を通して
        // 1本のタイムライン(nextSpawnAtRef、performance.now()基準)を進めることで、
        // どのタイミングで呼ばれても一定間隔を保てるようにする。
        const now = performance.now();
        const spawnAt = Math.max(now, nextSpawnAtRef.current);
        nextSpawnAtRef.current = spawnAt + STAGGER_MS + Math.random() * STAGGER_JITTER_MS;
        const delay = spawnAt - now;
        const id = setTimeout(() => {
          spawnTimeoutsRef.current.delete(id);
          trySpawnOneBall(generation);
        }, delay);
        spawnTimeoutsRef.current.add(id);
      }
      return true;
    },
    [layout, trySpawnOneBall],
  );

  // scoreEventsに新しく増えた分だけ玉を降らせる。誰の採点でも(自分の投票でも
  // 他人の採点がRealtime経由で増えた分でも)必ずここを通るので、全員の画面で同じ挙動になる。
  useEffect(() => {
    // 出現タイミングの直列化はspawnBallsForPoints内部のnextSpawnAtRef
    // （コンポーネント生存期間を通した1本のタイムライン）が担うため、
    // ここでバッチごとの連番を用意する必要はない。
    for (const ev of scoreEvents) {
      if (spawnedEventIdsRef.current.has(ev.id)) continue;
      if (spawnBallsForPoints(ev.points)) {
        spawnedEventIdsRef.current.add(ev.id);
      }
    }
  }, [scoreEvents, spawnBallsForPoints]);

  if (variant === "neon2") {
    return (
      <div ref={containerRef} className="relative h-full w-full">
        <div className="absolute inset-0 overflow-hidden rounded-[28px] border-[5px] border-[#3b5bff] bg-white shadow-[0_0_40px_rgba(59,91,255,0.45)]">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          <span className="absolute left-4 top-3 z-10 rounded-full bg-[#3b5bff] px-3 py-1 font-sans text-xs font-bold text-white shadow-[0_2px_8px_rgba(59,91,255,0.5)]">
            お題
          </span>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center">
            {roundLabel && (
              <p className="font-sans text-xs tracking-widest text-[#2a2a4a]/60">
                {roundLabel}
              </p>
            )}
            <p className="font-sans text-lg font-black leading-snug text-[#1a1a3a]">
              {topicBody}
            </p>
          </div>

          <div className="absolute bottom-2 right-2 rounded-full bg-[#1a1a3a]/85 px-3 py-1 font-sans text-xs font-bold tabular-nums text-[#ffcf4a]">
            {totalBalls} / {fixedMaxBalls}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative aspect-video w-full overflow-hidden rounded-2xl border-4 border-dojo-curtain-gold bg-dojo-washi-white shadow-[0_0_30px_rgba(232,184,76,0.35)]"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <span className="absolute left-3 top-2 font-sans text-sm font-bold text-dojo-ink sm:left-4 sm:top-3 sm:text-base">
        お題
      </span>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center sm:px-12">
        {roundLabel && (
          <p className="font-sans text-xs tracking-widest text-dojo-ink/60 sm:text-sm">
            {roundLabel}
          </p>
        )}
        <p className="font-sans text-2xl font-black leading-snug text-dojo-ink sm:text-3xl md:text-4xl">
          {topicBody}
        </p>
      </div>

      <div className="absolute bottom-2 right-2 rounded-full bg-dojo-stage-dark/80 px-3 py-1 font-sans text-xs font-bold tabular-nums text-dojo-curtain-gold">
        {totalBalls} / {fixedMaxBalls}
      </div>
    </div>
  );
}
