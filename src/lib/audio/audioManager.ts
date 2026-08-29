// アプリ全体でただ1つだけ存在する音声管理のコア実装。
// ホーム画面（Stadium系）・ライブ画面（/live, /live-demo）の両方から共通で使われる。
//
// 設計方針：
// ・モジュールスコープのシングルトンとして実装する（Reactコンポーネントツリーの外）。
//   これにより、Next.jsのクライアント側画面遷移（Link遷移）でこのモジュール自体が
//   破棄・再評価されることはなく、「画面遷移でAudioManagerを作り直さない」という
//   要件を自然に満たす。React側にはsrc/components/app/AudioProvider.tsxという
//   薄いContextレイヤーを被せ、状態の購読だけをコンポーネントに提供する。
// ・BGMは引き続きHTMLAudioElement（<audio>相当）で扱う。ループ再生・
//   currentTimeによるシーク（ライブ中リロード後の途中再開）をシンプルに書けるため。
// ・SE（効果音）はWeb Audio APIのAudioBufferとして事前デコードし、
//   AudioBufferSourceNodeで都度再生する。ボタン連打で音が重なっても
//   （cloneNodeのようなハックなしで）自然に多重再生でき、レイテンシも小さい。
//   まだデコードが終わっていない/失敗した音は、フォールバックとしてHTMLAudioElementで
//   即時再生を試みる（「事前読み込みが間に合わなくても無音よりはマシ」の安全網）。
// ・play()が返すPromiseは必ず処理し、NotAllowedError等で失敗したら
//   needsAudioResumeをtrueにして、UI側（SoundSettingsToggle/SoundToggle）が
//   「BGMを再開」ボタンを出せるようにする。

import { BASE_PATH } from "@/lib/basePath";

// ============================================================
// BGM
// ============================================================

// 2026-08-30: waiting/live/homeを、出囃子(entrance)以外の3曲を大幅に軽量化した
// 差し替え版に更新（192kbps・15MB前後→128kbps・1.8MB前後）。next.config.tsで
// /sounds/*にimmutableな長期キャッシュを設定しているため、同じファイル名のまま
// 中身だけ差し替えると既にキャッシュ済みの端末に古い内容が残り続けてしまう。
// そのため上書きせず、ファイル名に-v2を付けた新しいパスにしている
// （entranceは今回差し替えていないため元のファイル名のまま）。
export const BGM_PATHS = {
  waiting: "/sounds/bgm/waiting-v2.mp3",
  entrance: "/sounds/bgm/entrance.mp3",
  live: "/sounds/bgm/live-v2.mp3",
  home: "/sounds/bgm/home-v2.mp3",
} as const;

export type BgmName = keyof typeof BGM_PATHS;

// 2026-08-29: 「bgmが全体的にデカすぎる、特にライブ中は結構下げて」の要望で全体を
// 引き下げた（waiting/entrance/home: 0.13→0.08→0.05、live: 0.06→0.025→0.012と
// 特に大きく下げる）。
const BGM_VOLUME: Record<BgmName, number> = {
  waiting: 0.05,
  entrance: 0.05,
  live: 0.012,
  home: 0.05,
};
const FADE_MS = 700;

// ============================================================
// SE
// ============================================================

export const SFX_PATHS = {
  buttonPress: "/sounds/button-press.mp3",
  countdownTick: "/sounds/countdown-tick.mp3",
  scoreReveal: "/sounds/score-reveal.mp3",
  perfect: "/sounds/perfect.mp3",
  curtainOpen: "/sounds/curtain-open.mp3",
  answerSubmit: "/sounds/answer-submit.mp3",
  spotlightIn: "/sounds/spotlight-in.mp3",
  bigLaugh: "/sounds/big-laugh.mp3",
  topicReveal: "/sounds/topic-reveal.mp3",
  groupResult: "/sounds/group-result.mp3",
  rankReveal: "/sounds/rank-reveal.mp3",
  masteryLevelup: "/sounds/mastery-levelup.mp3",
  startLive: "/sounds/start-live.mp3",
  joinAsPlayer: "/sounds/join-as-player.mp3",
  participantJoined: "/sounds/participant-joined.mp3",
  pageTurn: "/sounds/page-turn.wav",
  homeClick: "/sounds/home-click.mp3",
  // ホームの「次回ライブ」チケット、参加成功時に半券が切り離される演出用。
  ticketTear: "/sounds/ticket-tear.mp3",
} as const;

export type SfxName = keyof typeof SFX_PATHS;

const SE_VOLUME = 0.45;

// ============================================================
// 状態
// ============================================================

export interface AudioManagerState {
  // AudioContextがrunning状態（ユーザー操作でアンロック済み）かどうか。
  audioUnlocked: boolean;
  // 主要な音声（ホームBGM・主要SE）の事前読み込みが完了したかどうか。
  audioReady: boolean;
  bgmEnabled: boolean;
  seEnabled: boolean;
  currentBgmTrack: BgmName | null;
  // play()がNotAllowedError等で失敗し、ユーザー操作による再開が必要な状態。
  needsAudioResume: boolean;
  // BGMファイルのダウンロード待ちで、まだ再生できる状態にない（UI側で「BGM準備中」を出す用）。
  bgmLoading: boolean;
}

const BGM_MUTE_STORAGE_KEY = "ogiri-bgm-muted"; // 既存キーそのまま維持（値の意味＝ミュートされているか）
const SE_MUTE_STORAGE_KEY = "ogiri-sfx-muted";

function readStoredMuted(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function hasStoredValue(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeStoredMuted(key: string, muted: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, muted ? "1" : "0");
  } catch {
    // localStorageが使えない環境（プライベートブラウズ等）でも音声機能自体は動かす。
  }
}

// 「ユーザー操作なしでBGMを強制的に再生し続ける実装にはしない」の要件のため、
// まだ一度もBGM確認モーダルで選択したことがない（＝保存値が無い）初回訪問時は、
// モーダルでONが押されるまでbgmEnabledをfalseのままにしておく
// （ページロード直後にAmbientBgmController等がplayBgmを呼んでも、実際の
// ダウンロード・再生は行われずpendingとして記録されるだけになる）。
// 2回目以降の訪問（保存値がある）は、その値を初期状態として引き継ぐ
// （前回ONだったユーザーが、モーダルが出るまでの一瞬だけ無音になるのを避けるため）。
let state: AudioManagerState = {
  audioUnlocked: false,
  audioReady: false,
  bgmEnabled: hasStoredValue(BGM_MUTE_STORAGE_KEY) ? !readStoredMuted(BGM_MUTE_STORAGE_KEY) : false,
  seEnabled: !readStoredMuted(SE_MUTE_STORAGE_KEY),
  currentBgmTrack: null,
  needsAudioResume: false,
  bgmLoading: false,
};

// 「1回のページ起動につき1回だけ」を保証するモジュールスコープのフラグ。
// ページのフルリロードでモジュールごと再評価されるためfalseに戻り、
// SPA遷移ではモジュールは再評価されないためtrueのまま維持される。
let hasShownBgmPromptThisBoot = false;

const listeners = new Set<(state: AudioManagerState) => void>();

function setState(patch: Partial<AudioManagerState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function getState(): AudioManagerState {
  return state;
}

export function subscribe(fn: (state: AudioManagerState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function hasShownBgmPrompt(): boolean {
  return hasShownBgmPromptThisBoot;
}

// AudioProvider側のuseEffectから呼ぶ。Strict Modeの「マウント→即破棄→再マウント」で
// 二重表示しないための仕組みの詳細はAudioProvider.tsx側のコメント参照。
export function markBgmPromptShown() {
  hasShownBgmPromptThisBoot = true;
}

export function unmarkBgmPromptShown() {
  hasShownBgmPromptThisBoot = false;
}

// ============================================================
// AudioContext（SEのデコード・再生、およびBGM/SEアンロックの基準として使う）
// ============================================================

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx) return audioCtx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null; // 極端に古いブラウザ用フォールバック（SFXフォールバック再生に切り替わる）
  audioCtx = new Ctor();
  audioCtx.addEventListener?.("statechange", () => {
    setState({ audioUnlocked: audioCtx?.state === "running" });
  });
  return audioCtx;
}

// ユーザー操作イベントの同期的なコールスタック内から呼ぶこと
// （BGM確認モーダルのONボタン・右上音声設定のBGM/SEトグル、両方のonClick冒頭）。
export function resumeAudioContext(): void {
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === "suspended") {
      ctx.resume()
        .then(() => setState({ audioUnlocked: true }))
        .catch((err) => {
          console.error("[audio] AudioContext resumeに失敗", err);
        });
    } else if (ctx.state === "running") {
      setState({ audioUnlocked: true });
    }
  }
  unlockAllBgm();
}

// 2026-08-29: 「場面転換のたびにBGMを再開が必要になる」対策の核心部分。
// 4曲ぶんのHTMLAudioElementをここで使い回す（bgmNodes）ようにし、
// 「ユーザー操作の中で一度再生に成功した、まさにそのインスタンス」を
// 曲の切り替え時にもそのまま使い続ける。iOS Safari等は「新しく作った
// <audio>要素は個別に一度ユーザー操作の文脈で再生されないと自動再生が
// ブロックされ続ける」傾向があるため、切り替えのたびにnew Audio()していた
// 以前の実装では、事前アンロックが効かず毎回ブロックされていた。
//
// 2026-08-29追記:「スマホ実機だと音量が下がらない・重なって聞こえる」対策。
// iOS Safariは仕様上 <audio> の volume プロパティをサポートしておらず、
// JSから設定しても無視されて常に最大音量(1.0)固定になる（Apple公式ドキュメント・
// MDN互換性データで明記された既知の制限。PCのブラウザでは効くため気付きにくい）。
// このため、audio.volumeでの音量制御はやめ、SEと同じWeb Audio API経由
// （MediaElementSourceNode→GainNode→destination）に統一する。GainNodeの
// gain.valueによる音量制御はiOS Safariでも機能する。
interface BgmNodes {
  audio: HTMLAudioElement;
  // AudioContextが使えない極端に古い環境向けのフォールバックではnullのままにし、
  // その場合だけ従来通りaudio.volumeで制御する（get/setBgmVolume参照）。
  gain: GainNode | null;
}

const bgmNodes = new Map<BgmName, BgmNodes>();

function getOrCreateBgmNodes(name: BgmName): BgmNodes {
  let nodes = bgmNodes.get(name);
  if (nodes) return nodes;

  const audio = new Audio(`${BASE_PATH}${BGM_PATHS[name]}`);
  audio.loop = true;
  audio.preload = "auto";
  // 音量はGainNode側で制御するため、audio自体は最大のままにしておく
  // （iOS Safariはどのみちこの値を無視するので実害はない）。
  audio.volume = 1;

  let gain: GainNode | null = null;
  const ctx = getAudioContext();
  if (ctx) {
    try {
      const source = ctx.createMediaElementSource(audio);
      gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(ctx.destination);
    } catch (err) {
      // createMediaElementSourceは同じaudio要素に対して二重に呼べない等の制約があるが、
      // ここはMapで一意生成しているので通常は失敗しない。万一失敗したらvolumeへフォールバック。
      console.warn(`[audio] BGM用GainNode作成に失敗（volumeフォールバックへ切替）: ${name}`, err);
      gain = null;
      audio.volume = 0;
    }
  } else {
    audio.volume = 0; // AudioContext自体が使えない環境向けのフォールバック
  }

  nodes = { audio, gain };
  bgmNodes.set(name, nodes);
  return nodes;
}

function getBgmVolume(nodes: BgmNodes): number {
  return nodes.gain ? nodes.gain.gain.value : nodes.audio.volume;
}

function setBgmVolume(nodes: BgmNodes, v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  if (nodes.gain) {
    nodes.gain.gain.value = clamped;
  } else {
    nodes.audio.volume = clamped;
  }
}

// BGM確認モーダルのON・音声設定のBGM/SEオン、いずれかのユーザー操作の中で、
// 今後使う可能性のある全てのBGM（waiting/entrance/live/home）を無音のまま
// こっそり一度再生→即一時停止しておく。これにより、後でフェーズ切り替え等
// ユーザー操作を伴わないタイミングでactivateBgmが同じインスタンスのplay()を
// 呼んでも、既に許可された実績があるとみなされブロックされにくくなる。
// 失敗しても致命的ではなく、通常のneedsAudioResume経由の再試行フローに任せる。
const unlockedBgmNames = new Set<BgmName>();

function unlockBgmElement(name: BgmName): void {
  if (typeof window === "undefined" || unlockedBgmNames.has(name)) return;
  unlockedBgmNames.add(name);
  const nodes = getOrCreateBgmNodes(name);
  if (currentBgm?.name === name && !currentBgm.nodes.audio.paused) return; // 既に本再生中なら触らない
  const result = nodes.audio.play();
  if (result && typeof result.then === "function") {
    result
      .then(() => {
        if (currentBgm?.name !== name) {
          nodes.audio.pause();
          nodes.audio.currentTime = 0;
        }
      })
      .catch(() => {
        // アンロックできなくても致命的ではない（unlockedBgmNamesから外し、
        // 次回のユーザー操作でもう一度試せるようにする）。
        unlockedBgmNames.delete(name);
      });
  }
}

function unlockAllBgm(): void {
  (Object.keys(BGM_PATHS) as BgmName[]).forEach(unlockBgmElement);
}

// ============================================================
// SE：AudioBufferへの事前デコード
// ============================================================

const sfxBuffers = new Map<SfxName, AudioBuffer>();
const sfxLoadPromises = new Map<SfxName, Promise<void>>();
// AudioContextが使えない/デコードに失敗した音源のフォールバック再生用（HTMLAudioElement方式）。
const sfxFallbackCache = new Map<SfxName, HTMLAudioElement>();

async function loadSfx(name: SfxName): Promise<void> {
  if (sfxBuffers.has(name)) return;
  const existing = sfxLoadPromises.get(name);
  if (existing) return existing;

  const promise = (async () => {
    const ctx = getAudioContext();
    if (!ctx) return; // フォールバック方式のみで運用
    try {
      const res = await fetch(`${BASE_PATH}${SFX_PATHS[name]}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      sfxBuffers.set(name, audioBuffer);
    } catch (err) {
      // 音源ファイル未配置（意図的に未実装のSE）・ネットワーク断・デコード失敗、
      // いずれも致命的にはせず、ログに残してplaySfx側のフォールバックに任せる。
      console.warn(`[audio] SE事前読み込み失敗: ${name}`, err);
    }
  })();
  sfxLoadPromises.set(name, promise);
  return promise;
}

// ホーム画面・ライブ画面で実際に使う音を、鳴らす前に一括で事前読み込みする。
// 呼び出しは何度でも安全（loadSfx自体が二重ロードを防ぐ）。
export function preloadAllSfx(): void {
  if (typeof window === "undefined") return;
  const names = Object.keys(SFX_PATHS) as SfxName[];
  Promise.allSettled(names.map((name) => loadSfx(name))).then(() => {
    setState({ audioReady: true });
  });
}

// 2026-08-29: ライブ待機画面の素材事前読み込み進捗表示（useLiveAssetPreload）から、
// 1件ずつ「成功したか」を確認しながら読み込むために使う。loadSfx自体はvoidを返し
// 失敗してもconsole.warnするだけの設計（呼び出し側のフォールバック前提）だが、
// ここでは進捗表示・自動リトライのために成否を判定できるようにする。
// 既にsfxBuffersにキャッシュ済みなら（loadSfx内部の判定で）再ダウンロードしない。
export async function preloadSfxOne(name: SfxName): Promise<{ ok: boolean }> {
  await loadSfx(name);
  return { ok: sfxBuffers.has(name) };
}

// 同じく、指定したBGMが実際に鳴らせる状態（canplaythrough）になるまで待つ。
// 実際には鳴らさない（volumeやplay()には触れない）。既に十分バッファ済みなら
// 即座に解決する。preload="auto"は生成時に設定済みのため、ここでload()を
// 明示的に呼ぶ必要はない（呼ぶと、既に別の理由で再生が始まっていた場合に
// 再生位置がリセットされてしまうため、あえて呼ばない）。
export function preloadBgmOne(name: BgmName): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ ok: false });
      return;
    }
    const nodes = getOrCreateBgmNodes(name);
    if (nodes.audio.readyState >= 3) {
      resolve({ ok: true });
      return;
    }
    const cleanup = () => {
      nodes.audio.removeEventListener("canplaythrough", onReady);
      nodes.audio.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve({ ok: true });
    };
    const onError = () => {
      cleanup();
      resolve({ ok: false });
    };
    nodes.audio.addEventListener("canplaythrough", onReady, { once: true });
    nodes.audio.addEventListener("error", onError, { once: true });
  });
}

function playSfxFallback(name: SfxName) {
  if (typeof window === "undefined") return;
  let base = sfxFallbackCache.get(name);
  if (!base) {
    base = new Audio(`${BASE_PATH}${SFX_PATHS[name]}`);
    base.preload = "auto";
    sfxFallbackCache.set(name, base);
  }
  const node = base.cloneNode(true) as HTMLAudioElement;
  node.volume = SE_VOLUME;
  node.play().catch(() => {
    // 音源ファイル未配置・自動再生制限などで失敗しても無視する（致命的ではない）。
  });
}

// ボタンを押した直後に呼ぶ想定。Supabase送信やawaitより前に呼ぶこと
// （呼び出し側のルールは各コンポーネントのonClick実装を参照）。
export function playSfx(name: SfxName): void {
  if (typeof window === "undefined" || !state.seEnabled) return;

  // SEはユーザー操作（クリック）の文脈で呼ばれるため、この呼び出し自体をアンロックの
  // 契機として使う。ここでresumeを試みても間に合わない場合はフォールバック再生に回る。
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().then(() => setState({ audioUnlocked: true })).catch(() => {});
  }

  const buffer = sfxBuffers.get(name);
  if (!buffer || !ctx || ctx.state !== "running") {
    // まだデコード完了していない、またはAudioContextが使えない/アンロック前 → フォールバック。
    playSfxFallback(name);
    loadSfx(name); // 次回以降のためにバックグラウンドで読み込みを進めておく
    return;
  }

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = SE_VOLUME;
    source.connect(gain).connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.warn(`[audio] SE再生に失敗（フォールバックへ切替）: ${name}`, err);
    playSfxFallback(name);
  }
}

// ============================================================
// BGM
// ============================================================

let currentBgm: { name: BgmName; nodes: BgmNodes } | null = null;
// bgmEnabled=falseの間に要求された曲名（有効化された瞬間にこれを再生する）。
let pendingBgmName: BgmName | null = null;
let pendingBgmStartAtMs: number | undefined;
const fadeTimers = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();

function fadeBgm(nodes: BgmNodes, from: number, to: number, ms: number, onDone?: () => void) {
  const existing = fadeTimers.get(nodes.audio);
  if (existing) clearInterval(existing);
  const steps = 20;
  const stepMs = ms / steps;
  let i = 0;
  setBgmVolume(nodes, from);
  const timer = setInterval(() => {
    i++;
    setBgmVolume(nodes, from + (to - from) * (i / steps));
    if (i >= steps) {
      clearInterval(timer);
      fadeTimers.delete(nodes.audio);
      setBgmVolume(nodes, to);
      onDone?.();
    }
  }, stepMs);
  fadeTimers.set(nodes.audio, timer);
}

// audio.play()が返すPromiseを必ず処理する。失敗時はneedsAudioResumeを立てて
// UI（音声設定メニュー内の「BGMを再開」）から再試行できるようにする。
function attemptPlay(audio: HTMLAudioElement) {
  const result = audio.play();
  if (result && typeof result.then === "function") {
    result
      .then(() => setState({ needsAudioResume: false }))
      .catch((err) => {
        console.warn("[audio] BGM再生に失敗（ユーザー操作での再開待ち）", err);
        setState({ needsAudioResume: true });
      });
  }
}

// 2026-08-29:「その場所専用のBGMは、その場所以外では絶対に鳴らさない」という
// 要件のため、直前のcurrentBgm（1曲）だけに頼らず、bgmNodesにある「keepName以外の
// 全ての曲」を対象に、鳴っているものは必ずフェードアウト・停止する。画面側の
// クリーンアップ漏れ等で万一取り残しがあっても、activateBgmが呼ばれるたびに
// 確実に一本化されるため、複数の場所のBGMが同時に鳴り続ける事態を構造的に防げる
// （currentBgmという単一ポインタだけに頼ると、ポインタが指していない
// “取り残し”を検知できない）。
function fadeOutAllBgmExcept(keepName: BgmName): void {
  bgmNodes.forEach((otherNodes, otherName) => {
    if (otherName === keepName) return;
    if (!otherNodes.audio.paused) {
      fadeBgm(otherNodes, getBgmVolume(otherNodes), 0, FADE_MS, () => {
        otherNodes.audio.pause();
      });
    }
  });
}

function activateBgm(name: BgmName, startAtMs?: number) {
  if (currentBgm?.name === name) {
    if (currentBgm.nodes.audio.paused) attemptPlay(currentBgm.nodes.audio);
    // 2026-08-29:「同じ曲のまま」の要求でも、必ず正しい音量へ向けてフェードし直す。
    // これが無いと2つのバグが起きる：
    // ①一時停止中（OFF等でvolumeを0までフェードダウン済み）の曲をそのままplay()する
    //   だけだと、無音のまま再生され続ける（「場面転換でBGMが鳴らない」の原因）。
    // ②再生中でも、直前にstopBgm/OFF等で「0へ向かうフェードアウト」がまだ進行中
    //   （700ms経ちきっておらずpause前）の状態でONに戻すと、ここで何もしないと
    //   古いフェードアウトタイマーが生き続けて音が消えていき、最後にpauseされて
    //   しまう（「素早くOFF→ONにすると音が鳴らなくなる」バグ）。
    // fadeBgm自体が「同じaudio要素への新しいフェード要求は、進行中の古いタイマーを
    // clearIntervalしてから開始する」ため、狙った音量へ向けて上書きできる。
    fadeBgm(currentBgm.nodes, getBgmVolume(currentBgm.nodes), BGM_VOLUME[name], FADE_MS);
    // 「同じ曲のまま」の場合でも、他に取り残された曲が無いかは必ず確認する。
    fadeOutAllBgmExcept(name);
    return;
  }
  fadeOutAllBgmExcept(name);

  // 2026-08-29: 曲ごとに使い回すAudio要素（unlockAllBgmで事前アンロック済みの、
  // まさにそのインスタンス）を取得する。切り替えのたびにnew Audio()すると
  // アンロック実績が引き継がれず「毎回BGMを再開が必要」になってしまうため。
  const nodes = getOrCreateBgmNodes(name);
  const audio = nodes.audio;

  setState({ currentBgmTrack: name, bgmLoading: true });

  const clearLoading = () => setState({ bgmLoading: false });
  if (audio.readyState >= 3) {
    // 事前アンロック等で既にロード済みなら、イベントを待たず即座に解除する。
    clearLoading();
  } else {
    audio.addEventListener("canplaythrough", clearLoading, { once: true });
    audio.addEventListener("error", clearLoading, { once: true });
  }

  // ライブ中のリロード後、経過時間に対応する位置から再開するための指定。
  // durationが判明してから設定しないとブラウザによってはseekが無視されるため
  // loadedmetadataを待つ（ループ再生のため経過時間を曲の長さで割った余りを使う）。
  const seekTo = (ms: number) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (ms / 1000) % audio.duration;
    }
  };
  if (startAtMs != null && startAtMs > 0) {
    if (audio.readyState >= 1) {
      seekTo(startAtMs);
    } else {
      audio.addEventListener("loadedmetadata", () => seekTo(startAtMs), { once: true });
    }
  } else {
    // 使い回すインスタンスは前回停止した位置が残っているため、指定が無ければ
    // 必ず頭から鳴らす（同じ曲に戻ってきた時に中途半端な位置から始まらないように）。
    try {
      audio.currentTime = 0;
    } catch {
      // まだメタデータが読めていない場合は無視してよい（0を指すのが既定のため）。
    }
  }

  currentBgm = { name, nodes };
  attemptPlay(audio);
  fadeBgm(nodes, 0, BGM_VOLUME[name], FADE_MS);
}

// 画面側（AmbientBgmController・/live・/live-demo・CurtainOverlay）が
// 「今この曲を鳴らしたい」と宣言するための関数。bgmEnabled=falseの間は
// 実際のダウンロード・再生を行わず、要求だけを覚えておく
// （有効化された瞬間にpendingの曲を再生する）。
export function playBgm(name: BgmName, opts?: { startAtMs?: number }): void {
  if (typeof window === "undefined") return;
  pendingBgmName = name;
  pendingBgmStartAtMs = opts?.startAtMs;

  if (!state.bgmEnabled) {
    setState({ currentBgmTrack: name });
    return;
  }
  activateBgm(name, opts?.startAtMs);
}

// 2026-08-29:「BGMが重なって鳴る／OFFにしても止まらない」対策。currentBgmという
// 単一のポインタだけを頼りに止めていると、画面側のクリーンアップ漏れ等で
// bgmNodes内の別の曲が再生されたまま取り残された場合に、そのゾンビ再生を
// 止める手段が無くなってしまう。ここでは「実際に鳴っている（pausedでない）
// 全ての曲」を対象に確実にフェードアウト・停止する防御的な実装にする。
function fadeOutAndPauseAllBgmNodes(): void {
  bgmNodes.forEach((nodes) => {
    if (!nodes.audio.paused) {
      fadeBgm(nodes, getBgmVolume(nodes), 0, FADE_MS, () => {
        nodes.audio.pause();
      });
    }
  });
}

export function stopBgm(): void {
  pendingBgmName = null;
  pendingBgmStartAtMs = undefined;
  currentBgm = null;
  setState({ currentBgmTrack: null, bgmLoading: false });
  fadeOutAndPauseAllBgmNodes();
}

// ブラウザの自動再生制限で鳴らせなかったBGMを、ユーザーの操作をきっかけに再試行する。
// 「BGMを再開」ボタン・ページ内最初のタップ、どちらからも呼べる。
export function retryCurrentBgm(): void {
  if (typeof window === "undefined") return;
  resumeAudioContext();
  if (currentBgm && currentBgm.nodes.audio.paused && state.bgmEnabled) {
    attemptPlay(currentBgm.nodes.audio);
    fadeBgm(currentBgm.nodes, getBgmVolume(currentBgm.nodes), BGM_VOLUME[currentBgm.name], FADE_MS);
  }
}

// ============================================================
// 設定変更（右上の音声マーク・BGM確認モーダル、共通で使う）
// ============================================================

export function setBgmEnabled(next: boolean): void {
  setState({ bgmEnabled: next });
  writeStoredMuted(BGM_MUTE_STORAGE_KEY, !next);

  if (next) {
    if (pendingBgmName) {
      activateBgm(pendingBgmName, pendingBgmStartAtMs);
    }
  } else {
    // currentBgmだけでなく、万一取り残されて鳴っている曲があっても確実に止める
    // （stopBgmと同じ防御的ヘルパーを使う。ただしcurrentBgm自体は保持し、
    // 再度ONにした時に続きから再開できるようにする＝stopBgmとの違い）。
    fadeOutAndPauseAllBgmNodes();
  }
}

export function setSeEnabled(next: boolean): void {
  setState({ seEnabled: next });
  writeStoredMuted(SE_MUTE_STORAGE_KEY, !next);
}

export function isBgmEnabled(): boolean {
  return state.bgmEnabled;
}

export function isSeEnabled(): boolean {
  return state.seEnabled;
}
