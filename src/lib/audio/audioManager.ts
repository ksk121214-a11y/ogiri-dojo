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

export const BGM_PATHS = {
  waiting: "/sounds/bgm/waiting.mp3",
  entrance: "/sounds/bgm/entrance.mp3",
  live: "/sounds/bgm/live.mp3",
  home: "/sounds/bgm/home.mp3",
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
// 4曲ぶんのHTMLAudioElementをここで使い回す（bgmElements）ようにし、
// 「ユーザー操作の中で一度再生に成功した、まさにそのインスタンス」を
// 曲の切り替え時にもそのまま使い続ける。iOS Safari等は「新しく作った
// <audio>要素は個別に一度ユーザー操作の文脈で再生されないと自動再生が
// ブロックされ続ける」傾向があるため、切り替えのたびにnew Audio()していた
// 以前の実装では、事前アンロックが効かず毎回ブロックされていた。
const bgmElements = new Map<BgmName, HTMLAudioElement>();

function getOrCreateBgmElement(name: BgmName): HTMLAudioElement {
  let audio = bgmElements.get(name);
  if (!audio) {
    audio = new Audio(`${BASE_PATH}${BGM_PATHS[name]}`);
    audio.loop = true;
    audio.volume = 0;
    audio.preload = "auto";
    bgmElements.set(name, audio);
  }
  return audio;
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
  const audio = getOrCreateBgmElement(name);
  if (currentBgm?.name === name && !currentBgm.audio.paused) return; // 既に本再生中なら触らない
  const result = audio.play();
  if (result && typeof result.then === "function") {
    result
      .then(() => {
        if (currentBgm?.name !== name) {
          audio.pause();
          audio.currentTime = 0;
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

let currentBgm: { name: BgmName; audio: HTMLAudioElement } | null = null;
// bgmEnabled=falseの間に要求された曲名（有効化された瞬間にこれを再生する）。
let pendingBgmName: BgmName | null = null;
let pendingBgmStartAtMs: number | undefined;
const fadeTimers = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();

function fadeAudio(audio: HTMLAudioElement, from: number, to: number, ms: number, onDone?: () => void) {
  const existing = fadeTimers.get(audio);
  if (existing) clearInterval(existing);
  const steps = 20;
  const stepMs = ms / steps;
  let i = 0;
  audio.volume = from;
  const timer = setInterval(() => {
    i++;
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
    if (i >= steps) {
      clearInterval(timer);
      fadeTimers.delete(audio);
      audio.volume = to;
      onDone?.();
    }
  }, stepMs);
  fadeTimers.set(audio, timer);
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

function activateBgm(name: BgmName, startAtMs?: number) {
  if (currentBgm?.name === name) {
    if (currentBgm.audio.paused) attemptPlay(currentBgm.audio);
    return;
  }
  const prev = currentBgm;
  // 2026-08-29: 曲ごとに使い回すAudio要素（unlockAllBgmで事前アンロック済みの、
  // まさにそのインスタンス）を取得する。切り替えのたびにnew Audio()すると
  // アンロック実績が引き継がれず「毎回BGMを再開が必要」になってしまうため。
  const audio = getOrCreateBgmElement(name);

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

  currentBgm = { name, audio };
  attemptPlay(audio);
  fadeAudio(audio, 0, BGM_VOLUME[name], FADE_MS);

  if (prev && prev.audio !== audio) {
    fadeAudio(prev.audio, prev.audio.volume, 0, FADE_MS, () => {
      prev.audio.pause();
    });
  }
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

export function stopBgm(): void {
  pendingBgmName = null;
  pendingBgmStartAtMs = undefined;
  if (!currentBgm) return;
  const prev = currentBgm;
  currentBgm = null;
  setState({ currentBgmTrack: null, bgmLoading: false });
  fadeAudio(prev.audio, prev.audio.volume, 0, FADE_MS, () => {
    prev.audio.pause();
  });
}

// ブラウザの自動再生制限で鳴らせなかったBGMを、ユーザーの操作をきっかけに再試行する。
// 「BGMを再開」ボタン・ページ内最初のタップ、どちらからも呼べる。
export function retryCurrentBgm(): void {
  if (typeof window === "undefined") return;
  resumeAudioContext();
  if (currentBgm && currentBgm.audio.paused && state.bgmEnabled) {
    attemptPlay(currentBgm.audio);
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
  } else if (currentBgm) {
    const audio = currentBgm.audio;
    fadeAudio(audio, audio.volume, 0, FADE_MS, () => {
      audio.pause();
    });
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
