// アプリ全体でただ1つだけ存在する音声管理のコア実装。
// ホーム画面（Stadium系）・ライブ画面（/live, /live-demo）の両方から共通で使われる。
//
// 設計方針：
// ・モジュールスコープのシングルトンとして実装する（Reactコンポーネントツリーの外）。
//   これにより、Next.jsのクライアント側画面遷移（Link遷移）でこのモジュール自体が
//   破棄・再評価されることはなく、「画面遷移でAudioManagerを作り直さない」という
//   要件を自然に満たす。React側にはsrc/components/app/AudioProvider.tsxという
//   薄いContextレイヤーを被せ、状態の購読だけをコンポーネントに提供する。
// ・BGMはAudioBufferSourceNode（source.loop=true）で扱う。デコード済みバッファの
//   先頭へサンプル単位で正確にループするため、<audio loop>で生じがちな
//   ループの継ぎ目の無音ギャップが原理的に発生しない（詳細は下のBGMセクション参照）。
//   AudioContextが使えない極端に古い環境向けにのみ、従来どおりHTMLAudioElementに
//   フォールバックする。
// ・SE（効果音）はWeb Audio APIのAudioBufferとして事前デコードし、
//   AudioBufferSourceNodeで都度再生する。ボタン連打で音が重なっても
//   （cloneNodeのようなハックなしで）自然に多重再生でき、レイテンシも小さい。
//   まだデコードが終わっていない/失敗した音は、フォールバックとしてHTMLAudioElementで
//   即時再生を試みる（「事前読み込みが間に合わなくても無音よりはマシ」の安全網）。
// ・play()が返すPromiseは必ず処理し、NotAllowedError等で失敗したら
//   needsAudioResumeをtrueにして、UI側（SoundSettingsToggle/SoundToggle）が
//   「BGMを再開」ボタンを出せるようにする。

import { decideBgmCorrection, type BgmCorrectionResult } from "@/lib/bgmCorrection";
import { decideBgmRetry, decideBgmStart, registerMetadataListenerOnce, resolveBgmOffsetSec, resolveFallbackSeekSec } from "@/lib/bgmStartPlan";
import { createBgmStartIntent } from "@/lib/bgmStartIntent";
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
// 2026-08-30: 「BGMをほんの少しだけ音量上げて」の要望で、下げすぎだった分を
// ごくわずかに戻した（waiting/entrance/home: 0.05→0.06、live: 0.012→0.015）。
// 2026-08-30（2回目）: 続けて「ほんの少しだけ」の追加要望があったため、
// もう一段階だけ引き上げた（waiting/entrance/home: 0.06→0.07、live: 0.015→0.018）。
const BGM_VOLUME: Record<BgmName, number> = {
  waiting: 0.07,
  entrance: 0.07,
  live: 0.018,
  home: 0.07,
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

// 2026-08-30: 「効果音をほんの少しだけ下げて」の要望でごくわずかに引き下げた。
// 2026-08-30（2回目）: 続けて「ほんの少しだけ」の追加要望があったため、もう一段階下げた。
const SE_VOLUME = 0.33;

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
  // 4曲ぶんのデコードをこの時点で先んじて開始しておく（実際に鳴らすのは
  // activateBgmが呼ばれた時）。AudioBufferSourceNodeはデコード済みバッファが
  // 無いとstartできないため、ユーザー操作の直後にリクエストしておくことで、
  // 実際の場面転換でplayBgmが呼ばれる頃にはデコードが完了している可能性を上げる。
  (Object.keys(BGM_PATHS) as BgmName[]).forEach((name) => {
    const playback = getOrCreateBgmPlayback(name);
    ensureBgmDecoded(playback, name);
  });
}

// 2026-08-30:「BGMがループする瞬間にちょっとした間が空く」対策。
// HTMLAudioElementの<audio loop>によるループは、MP3のフレーム構造
// （LAMEエンコーダが付与するエンコーダディレイ/パディング=いわゆるpriming/
// remainderサンプル）や、ブラウザ内部の再生バッファの継ぎ目の影響を受けやすく、
// 完全に無音の隙間なく繋がらないことがある。実機で検証したところ、
// Web AudioのdecodeAudioData()は（Chromiumで）priming/remainderを含まない
// 正確な長さのAudioBufferを返すことを確認できたため、BGMの再生方式自体を
// HTMLAudioElement(<audio loop>)からAudioBufferSourceNode(source.loop=true)に
// 置き換える。AudioBufferSourceNodeのループはサンプル単位で正確にバッファの
// 先頭に戻るため、デコード結果に無音が含まれていなければギャップは原理的に発生しない。
//
// 2026-08-29:「スマホ実機だと音量が下がらない・重なって聞こえる」対策で導入した
// GainNode経由の音量制御（iOS Safariは<audio>のvolumeプロパティを無視するため）は
// そのまま維持する。
//
// 2026-08-29の「場面転換のたびにBGMを再開が必要になる」対策（個別のAudio要素ごとに
// 一度ユーザー操作の文脈で再生実績を作っておく）は、AudioBufferSourceNode方式では
// 不要になる：iOS Safari等の自動再生ブロックは「AudioContext自体がuser gestureで
// runningになっているか」で判定されており、個々のsourceの実績とは無関係なため、
// resumeAudioContext()でAudioContextさえ起こしておけば、以降いつ新しいsourceを
// start()しても問題なく鳴る。そのため、以前あった「4曲を無音で一度再生しておく」
// unlockBgmElement/unlockAllBgmの仕組みは撤去した。
//
// AudioContext自体が使えない極端に古い環境向けには、従来どおりHTMLAudioElement
// （volumeで音量制御、ループにギャップが残る）にフォールバックする。
interface BgmPlayback {
  // Web Audio API方式（通常はこちら）。
  buffer: AudioBuffer | null;
  gain: GainNode | null;
  source: AudioBufferSourceNode | null;
  // 現在の再生位置(秒)を計算するための基準値。isPlaying中は
  // (ctx.currentTime - contextTimeAtStart + offsetAtStart) % buffer.duration が現在位置。
  offsetAtStart: number;
  contextTimeAtStart: number;
  isPlaying: boolean;
  loadPromise: Promise<void> | null;
  // AudioContextが使えない環境向けのフォールバック。
  fallbackAudio: HTMLAudioElement | null;
  // フォールバック：メタデータ待ちのloadedmetadataリスナーが登録済みか（重複登録・二重再生の防止）。
  metadataWaiting?: boolean;
}

const bgmPlaybacks = new Map<BgmName, BgmPlayback>();

function getOrCreateBgmPlayback(name: BgmName): BgmPlayback {
  let playback = bgmPlaybacks.get(name);
  if (playback) return playback;

  const ctx = getAudioContext();
  if (ctx) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    playback = {
      buffer: null,
      gain,
      source: null,
      offsetAtStart: 0,
      contextTimeAtStart: 0,
      isPlaying: false,
      loadPromise: null,
      fallbackAudio: null,
    };
  } else {
    // フォールバック：従来どおりHTMLAudioElement+loopで（ギャップは残るが無音よりまし）。
    const audio = new Audio(`${BASE_PATH}${BGM_PATHS[name]}`);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    playback = {
      buffer: null,
      gain: null,
      source: null,
      offsetAtStart: 0,
      contextTimeAtStart: 0,
      isPlaying: false,
      loadPromise: null,
      fallbackAudio: audio,
    };
  }
  bgmPlaybacks.set(name, playback);
  ensureBgmDecoded(playback, name);
  return playback;
}

// バッファをデコードして再生可能な状態にしておく（未デコードなら開始、二重デコード防止）。
function ensureBgmDecoded(playback: BgmPlayback, name: BgmName): Promise<void> {
  if (playback.fallbackAudio || playback.buffer) return Promise.resolve();
  if (playback.loadPromise) return playback.loadPromise;
  const ctx = getAudioContext();
  const promise = (async () => {
    if (!ctx) return;
    try {
      const res = await fetch(`${BASE_PATH}${BGM_PATHS[name]}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      playback.buffer = await ctx.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.warn(`[audio] BGM事前読み込み失敗: ${name}`, err);
    }
  })();
  playback.loadPromise = promise;
  return promise;
}

function getBgmVolume(playback: BgmPlayback): number {
  if (playback.gain) return playback.gain.gain.value;
  return playback.fallbackAudio?.volume ?? 0;
}

function setBgmVolume(playback: BgmPlayback, v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  if (playback.gain) {
    playback.gain.gain.value = clamped;
  } else if (playback.fallbackAudio) {
    playback.fallbackAudio.volume = clamped;
  }
}

function isBgmPaused(playback: BgmPlayback): boolean {
  if (playback.fallbackAudio) return playback.fallbackAudio.paused;
  return !playback.isPlaying;
}

// 現在の再生位置（秒、0〜buffer.duration未満）。フォールバック時はcurrentTimeそのもの。
function getBgmOffsetSec(playback: BgmPlayback, ctx: AudioContext | null): number {
  if (playback.fallbackAudio) return playback.fallbackAudio.currentTime;
  if (!playback.buffer) return 0;
  if (!playback.isPlaying || !ctx) return playback.offsetAtStart;
  const elapsed = ctx.currentTime - playback.contextTimeAtStart;
  return (playback.offsetAtStart + elapsed) % playback.buffer.duration;
}

// 指定オフセット(秒)からAudioBufferSourceNodeで再生を開始する（既存のsourceがあれば
// 差し替える）。source.loop=trueにより、デコード済みバッファの先頭へサンプル単位で
// 正確にループするため、<audio loop>のようなギャップが生じない。
function startBgmSource(playback: BgmPlayback, ctx: AudioContext, offsetSec: number): void {
  if (!playback.buffer || !playback.gain) return;
  if (playback.source) {
    try {
      playback.source.stop();
    } catch {
      // 既に停止済み等は無視してよい。
    }
    playback.source.disconnect();
  }
  const source = ctx.createBufferSource();
  source.buffer = playback.buffer;
  source.loop = true;
  source.connect(playback.gain);
  const safeOffset = playback.buffer.duration > 0 ? offsetSec % playback.buffer.duration : 0;
  source.start(0, Math.max(0, safeOffset));
  playback.source = source;
  playback.offsetAtStart = Math.max(0, safeOffset);
  playback.contextTimeAtStart = ctx.currentTime;
  playback.isPlaying = true;
}

// 現在の再生位置を記録しつつ停止する（次にstartBgmSourceする時、続きから再開できるように）。
function pauseBgmSource(playback: BgmPlayback, ctx: AudioContext | null): void {
  if (playback.fallbackAudio) {
    playback.fallbackAudio.pause();
    return;
  }
  if (!playback.isPlaying) return;
  const offset = getBgmOffsetSec(playback, ctx);
  if (playback.source) {
    try {
      playback.source.stop();
    } catch {
      // 無視してよい。
    }
    playback.source.disconnect();
    playback.source = null;
  }
  playback.offsetAtStart = offset;
  playback.isPlaying = false;
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

// 同じく、指定したBGMのデコードが完了する（=いつでもgaplessに再生開始できる）まで
// 待つ。実際には鳴らさない。フォールバック（AudioContext不可）時はcanplaythroughを待つ。
export async function preloadBgmOne(name: BgmName): Promise<{ ok: boolean }> {
  if (typeof window === "undefined") return { ok: false };
  const playback = getOrCreateBgmPlayback(name);
  if (playback.fallbackAudio) {
    const audio = playback.fallbackAudio;
    if (audio.readyState >= 3) return { ok: true };
    return new Promise((resolve) => {
      const cleanup = () => {
        audio.removeEventListener("canplaythrough", onReady);
        audio.removeEventListener("error", onError);
      };
      const onReady = () => {
        cleanup();
        resolve({ ok: true });
      };
      const onError = () => {
        cleanup();
        resolve({ ok: false });
      };
      audio.addEventListener("canplaythrough", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
    });
  }
  await ensureBgmDecoded(playback, name);
  return { ok: playback.buffer !== null };
}

// 2026-09-06:「お題発表の拍手が、遅れて画面を開くと先頭から再生されて終了時刻がずれる」
// 不具合対応。offsetSec（秒）を指定すると、音源の途中（経過分）から再生を始められる。
// 呼び出し側(TopicRevealView.tsx)がphase_deadline基準で「本来ならもう何秒経過しているべきか」
// を計算し、その分をoffsetSecとして渡すことで、再生開始が遅れても本来の終了時刻に揃う。
function playSfxFallback(name: SfxName, offsetSec = 0) {
  if (typeof window === "undefined") return;
  let base = sfxFallbackCache.get(name);
  if (!base) {
    base = new Audio(`${BASE_PATH}${SFX_PATHS[name]}`);
    base.preload = "auto";
    sfxFallbackCache.set(name, base);
  }
  const node = base.cloneNode(true) as HTMLAudioElement;
  node.volume = SE_VOLUME;
  if (offsetSec > 0) {
    // durationが未取得（メタデータ読み込み前）の場合はそのまま先頭から。
    // 致命的ではないため、取得できた場合だけ安全な範囲にクランプして反映する。
    const duration = node.duration;
    node.currentTime = Number.isFinite(duration) && duration > 0 ? Math.min(offsetSec, duration) : offsetSec;
  }
  node.play().catch(() => {
    // 音源ファイル未配置・自動再生制限などで失敗しても無視する（致命的ではない）。
  });
}

// ボタンを押した直後に呼ぶ想定。Supabase送信やawaitより前に呼ぶこと
// （呼び出し側のルールは各コンポーネントのonClick実装を参照）。
// opts.offsetSecを指定すると、音源の途中（経過分）から再生を始める
// （playSfxFallbackのコメント参照。省略時は0＝常に先頭からで、既存の呼び出し箇所
// 20箇所以上には一切影響しない）。
export function playSfx(name: SfxName, opts?: { offsetSec?: number }): void {
  if (typeof window === "undefined" || !state.seEnabled) return;
  const offsetSec = Math.max(0, opts?.offsetSec ?? 0);

  // SEはユーザー操作（クリック）の文脈で呼ばれるため、この呼び出し自体をアンロックの
  // 契機として使う。ここでresumeを試みても間に合わない場合はフォールバック再生に回る。
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().then(() => setState({ audioUnlocked: true })).catch(() => {});
  }

  const buffer = sfxBuffers.get(name);
  if (!buffer || !ctx || ctx.state !== "running") {
    // まだデコード完了していない、またはAudioContextが使えない/アンロック前 → フォールバック。
    playSfxFallback(name, offsetSec);
    loadSfx(name); // 次回以降のためにバックグラウンドで読み込みを進めておく
    return;
  }

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = SE_VOLUME;
    source.connect(gain).connect(ctx.destination);
    // AudioBufferSourceNode.start(when, offset)のoffset（バッファ内の再生開始位置、秒）。
    // buffer.durationを超える値を渡すと例外になるため安全にクランプする。
    const safeOffset = buffer.duration > 0 ? Math.min(offsetSec, buffer.duration) : 0;
    source.start(0, safeOffset);
  } catch (err) {
    console.warn(`[audio] SE再生に失敗（フォールバックへ切替）: ${name}`, err);
    playSfxFallback(name, offsetSec);
  }
}

// ============================================================
// BGM
// ============================================================

let currentBgm: { name: BgmName; playback: BgmPlayback } | null = null;
// 「今この曲を、この位置から鳴らしたい」最新の意図。bgmEnabled=falseの間や読込中は、
// ここへ保存された曲・位置が有効化時・読込完了時に使われる（bgmStartIntent.ts参照）。
const bgmIntent = createBgmStartIntent();
const fadeTimers = new Map<BgmPlayback, ReturnType<typeof setInterval>>();

function fadeBgm(playback: BgmPlayback, from: number, to: number, ms: number, onDone?: () => void) {
  const existing = fadeTimers.get(playback);
  if (existing) clearInterval(existing);
  const steps = 20;
  const stepMs = ms / steps;
  let i = 0;
  setBgmVolume(playback, from);
  const timer = setInterval(() => {
    i++;
    setBgmVolume(playback, from + (to - from) * (i / steps));
    if (i >= steps) {
      clearInterval(timer);
      fadeTimers.delete(playback);
      setBgmVolume(playback, to);
      onDone?.();
    }
  }, stepMs);
  fadeTimers.set(playback, timer);
}

// 指定オフセット(秒)から再生を試みる。失敗（AudioContextが依然suspended等）時は
// needsAudioResumeを立てて、UI（音声設定メニュー内の「BGMを再開」）から再試行できるようにする。
function attemptStartBgm(
  playback: BgmPlayback,
  offsetSec: number,
  opts?: { userGesture?: boolean },
) {
  if (playback.fallbackAudio) {
    const audio = playback.fallbackAudio;
    const play = () => {
      try {
        const result = audio.play();
        if (result && typeof result.then === "function") {
          result
            .then(() => setState({ needsAudioResume: false }))
            .catch((err) => {
              console.warn("[audio] BGM再生に失敗（ユーザー操作での再開待ち）", err);
              setState({ needsAudioResume: true });
            });
        }
      } catch (err) {
        console.warn("[audio] BGM再生に失敗（ユーザー操作での再開待ち）", err);
        setState({ needsAudioResume: true });
      }
    };
    // 8回目レビュー対応：offsetSecをcurrentTimeへ反映してから再生する（durationでmodulo、
    // 負数・NaN・Infinityは防御）。メタデータ未取得なら、loadedmetadata後に「その時点の
    // 最新のbgmIntent位置」を再計算して反映する。待機中に曲変更・OFF・stop・ページ離脱が
    // あった場合は古い処理で再生しない。同じplaybackへのリスナーは重複登録しない。
    const seek = resolveFallbackSeekSec(offsetSec, audio.duration);
    if (seek !== null) {
      try {
        audio.currentTime = seek;
      } catch {
        // 設定できない場合は現在位置のまま再生する。
      }
      play();
      return;
    }
    // 9回目レビュー対応：ユーザー操作(タップ/「BGMを再開」)による再開では、メタデータ未取得でも
    // そのイベント内で同期的にplay()を試す（loadedmetadata後のplay()はイベントの外になり、
    // ブラウザの自動再生制限で再び拒否され得るため）。メタデータ待機中(metadataWaiting)の
    // 再タップも、この同期playを試すため無視されない。位置は取得後にseekで最新位置へ合わせる。
    if (opts?.userGesture) play();
    // 待機フラグの確認とtrueへの設定はリスナー登録の前に行う（registerMetadataListenerOnce）。
    registerMetadataListenerOnce(
      playback,
      (onLoaded) => audio.addEventListener("loadedmetadata", onLoaded, { once: true }),
      () => {
        if (currentBgm?.playback !== playback) return; // 曲変更・stop後
        if (
          decideBgmStart({
            intentCurrent: bgmIntent.name !== null,
            nameMatches: bgmIntent.name === currentBgm.name,
            enabled: state.bgmEnabled,
            alreadyPlaying: false, // 再生中でも位置の補正は行う（二重play回避は下のpausedで判断）
          }) !== "start"
        ) {
          return;
        }
        const latest = resolveFallbackSeekSec(
          resolveBgmOffsetSec(bgmIntent.startAtMs, audio.duration, offsetSec),
          audio.duration,
        );
        if (latest !== null) {
          try {
            audio.currentTime = latest;
          } catch {
            // 無視してよい。
          }
        }
        // ユーザー操作中のplay()が成功して既に再生中なら、二重にplay()しない（位置だけ補正）。
        // 失敗して停止したままなら、ここで再試行する（失敗時はneedsAudioResume=trueで次のタップを待つ）。
        if (audio.paused) play();
      },
    );
    return;
  }
  const ctx = getAudioContext();
  if (!ctx || !playback.buffer) return;
  startBgmSource(playback, ctx, offsetSec);
  if (ctx.state === "running") {
    setState({ needsAudioResume: false });
  } else {
    // AudioContextがまだユーザー操作でアンロックされていない。resumeを試み、
    // それでも失敗するようならUI側から再試行できるようにする。
    ctx.resume()
      .then(() => setState({ needsAudioResume: false }))
      .catch(() => setState({ needsAudioResume: true }));
  }
}

// 2026-08-29:「その場所専用のBGMは、その場所以外では絶対に鳴らさない」という
// 要件のため、直前のcurrentBgm（1曲）だけに頼らず、bgmPlaybacksにある
// 「keepName以外の全ての曲」を対象に、鳴っているものは必ずフェードアウト・停止する。
// 画面側のクリーンアップ漏れ等で万一取り残しがあっても、activateBgmが呼ばれるたびに
// 確実に一本化されるため、複数の場所のBGMが同時に鳴り続ける事態を構造的に防げる
// （currentBgmという単一ポインタだけに頼ると、ポインタが指していない
// “取り残し”を検知できない）。
function fadeOutAllBgmExcept(keepName: BgmName): void {
  bgmPlaybacks.forEach((otherPlayback, otherName) => {
    if (otherName === keepName) return;
    if (!isBgmPaused(otherPlayback)) {
      fadeBgm(otherPlayback, getBgmVolume(otherPlayback), 0, FADE_MS, () => {
        pauseBgmSource(otherPlayback, getAudioContext());
      });
    }
  });
}

function activateBgm(name: BgmName) {
  const myGen = bgmIntent.gen;
  // 読込・メタデータ待ちの完了時に、開始時の引数ではなく最新の希望開始位置を読む。
  const latestStartAtMs = () =>
    bgmIntent.isCurrent(myGen) && bgmIntent.name === name ? bgmIntent.startAtMs : undefined;
  if (currentBgm?.name === name) {
    if (isBgmPaused(currentBgm.playback)) {
      // 7回目レビュー対応：OFF→ON再開は、古い停止位置ではなく意図(intent)の「今この
      // 瞬間の有効な位置」（基準＋経過）から始める（無ければ従来どおり停止位置）。
      const pb = currentBgm.playback;
      const durationSec = pb.fallbackAudio ? pb.fallbackAudio.duration : (pb.buffer?.duration ?? 0);
      const fallbackSec = getBgmOffsetSec(pb, getAudioContext());
      attemptStartBgm(
        pb,
        bgmIntent.name === name ? resolveBgmOffsetSec(bgmIntent.startAtMs, durationSec, fallbackSec) : fallbackSec,
      );
    }
    // 2026-08-29:「同じ曲のまま」の要求でも、必ず正しい音量へ向けてフェードし直す。
    // これが無いと2つのバグが起きる：
    // ①一時停止中（OFF等でvolumeを0までフェードダウン済み）の曲をそのまま再生する
    //   だけだと、無音のまま再生され続ける（「場面転換でBGMが鳴らない」の原因）。
    // ②再生中でも、直前にstopBgm/OFF等で「0へ向かうフェードアウト」がまだ進行中
    //   （700ms経ちきっておらず停止前）の状態でONに戻すと、ここで何もしないと
    //   古いフェードアウトタイマーが生き続けて音が消えていき、最後に止まって
    //   しまう（「素早くOFF→ONにすると音が鳴らなくなる」バグ）。
    // fadeBgm自体が「同じplaybackへの新しいフェード要求は、進行中の古いタイマーを
    // clearIntervalしてから開始する」ため、狙った音量へ向けて上書きできる。
    fadeBgm(currentBgm.playback, getBgmVolume(currentBgm.playback), BGM_VOLUME[name], FADE_MS);
    // 「同じ曲のまま」の場合でも、他に取り残された曲が無いかは必ず確認する。
    fadeOutAllBgmExcept(name);
    return;
  }
  fadeOutAllBgmExcept(name);

  const playback = getOrCreateBgmPlayback(name);
  setState({ currentBgmTrack: name, bgmLoading: true });
  const clearLoading = () => setState({ bgmLoading: false });

  if (playback.fallbackAudio) {
    // AudioContextが使えない環境向けのフォールバック：従来どおりHTMLAudioElement。
    const audio = playback.fallbackAudio;
    if (audio.readyState >= 3) {
      clearLoading();
    } else {
      audio.addEventListener("canplaythrough", clearLoading, { once: true });
      audio.addEventListener("error", clearLoading, { once: true });
    }
    currentBgm = { name, playback };
    attemptStartBgm(playback, (latestStartAtMs() ?? 0) / 1000);
    fadeBgm(playback, 0, BGM_VOLUME[name], FADE_MS);
    return;
  }

  // Web Audio API方式：デコード済みバッファが無ければ、揃うまで待ってから再生する
  // （AudioBufferSourceNodeはバッファが無いとstartできないため）。
  const startWhenReady = () => {
    // 待っている間に、この要求が既に追い越されていないか確認する
    // （別の曲へ切り替わった／再びOFFになった等）。
    // 7回目レビュー対応：読込完了時にも最新のbgmEnabledを再確認する。読込中にOFFに
    // された場合は再生・フェードインを行わない（デコード済みの音源と最新の希望位置は
    // 保持し、ONにした時に初めて再生する）。bgmLoadingも残さない。
    const startDecision = decideBgmStart({
      intentCurrent: bgmIntent.isCurrent(myGen),
      nameMatches: bgmIntent.name === name,
      enabled: state.bgmEnabled,
      alreadyPlaying: !isBgmPaused(playback),
    });
    if (startDecision === "skip_stale") return;
    if (startDecision !== "start") {
      clearLoading();
      return;
    }
    const offsetSec = resolveBgmOffsetSec(latestStartAtMs(), playback.buffer?.duration ?? 0, 0);
    currentBgm = { name, playback };
    attemptStartBgm(playback, offsetSec);
    fadeBgm(playback, 0, BGM_VOLUME[name], FADE_MS);
    clearLoading();
  };

  if (playback.buffer) {
    startWhenReady();
  } else {
    currentBgm = { name, playback };
    ensureBgmDecoded(playback, name).then(startWhenReady);
  }
}

// 6回目レビュー対応：サーバー時計の同期後に、BGMを正しい位置へ補正する。結果を理由つきで
// 返す（bgmCorrection.ts）。OFF・読込中でも、正しい将来の開始位置を意図(intent)へ保存し
// （queued）、実際の再生開始時にその最新値が使われる。補正済み判断は呼び出し側plannerが
// この結果を見て行う。
export function correctBgmPosition(name: BgmName, targetMs: number, toleranceMs = 1500): BgmCorrectionResult {
  if (typeof window === "undefined") return "not_ready";
  const cur = currentBgm && currentBgm.name === name ? currentBgm.playback : null;
  const ctx = getAudioContext();
  let position: { durationMs: number; currentPosMs: number } | null = null;
  let loading = false;
  if (cur) {
    if (cur.fallbackAudio) {
      const d = cur.fallbackAudio.duration;
      if (Number.isFinite(d) && d > 0) {
        position = { durationMs: d * 1000, currentPosMs: cur.fallbackAudio.currentTime * 1000 };
      } else loading = true;
    } else if (cur.buffer && ctx && cur.buffer.duration > 0) {
      position = { durationMs: cur.buffer.duration * 1000, currentPosMs: getBgmOffsetSec(cur, ctx) * 1000 };
    } else loading = true;
  }
  const decision = decideBgmCorrection(
    {
      plannedName: bgmIntent.name,
      enabled: state.bgmEnabled,
      currentName: currentBgm?.name ?? null,
      loading,
      position,
    },
    name,
    targetMs,
    toleranceMs,
  );
  if (decision.effect === "seek" && cur && position) {
    const target = (((targetMs % position.durationMs) + position.durationMs) % position.durationMs) / 1000;
    if (cur.fallbackAudio) {
      cur.fallbackAudio.currentTime = target;
    } else if (ctx && cur.buffer) {
      if (cur.isPlaying) startBgmSource(cur, ctx, target);
      else cur.offsetAtStart = target;
    }
  }
  if (decision.result === "corrected" || decision.result === "within_tolerance" || decision.result === "queued") {
    // ON/OFFの切り替えや再開でも、古い位置(0秒等)へ戻らないよう最新値を保存する。
    bgmIntent.updateStart(name, targetMs);
  }
  return decision.result;
}

// 画面側（AmbientBgmController・/live・/live-demo・CurtainOverlay）が
// 「今この曲を鳴らしたい」と宣言するための関数。bgmEnabled=falseの間は
// 実際のダウンロード・再生を行わず、要求だけを覚えておく
// （有効化された瞬間にpendingの曲を再生する）。
export function playBgm(name: BgmName, opts?: { startAtMs?: number }): void {
  if (typeof window === "undefined") return;
  bgmIntent.request(name, opts?.startAtMs);

  if (!state.bgmEnabled) {
    setState({ currentBgmTrack: name });
    return;
  }
  activateBgm(name);
}

// 2026-08-29:「BGMが重なって鳴る／OFFにしても止まらない」対策。currentBgmという
// 単一のポインタだけを頼りに止めていると、画面側のクリーンアップ漏れ等で
// bgmPlaybacks内の別の曲が再生されたまま取り残された場合に、そのゾンビ再生を
// 止める手段が無くなってしまう。ここでは「実際に鳴っている（一時停止でない）
// 全ての曲」を対象に確実にフェードアウト・停止する防御的な実装にする。
function fadeOutAndPauseAllBgmNodes(): void {
  bgmPlaybacks.forEach((playback) => {
    if (!isBgmPaused(playback)) {
      fadeBgm(playback, getBgmVolume(playback), 0, FADE_MS, () => {
        pauseBgmSource(playback, getAudioContext());
      });
    }
  });
}

export function stopBgm(): void {
  bgmIntent.clear();
  currentBgm = null;
  setState({ currentBgmTrack: null, bgmLoading: false });
  fadeOutAndPauseAllBgmNodes();
}

// ブラウザの自動再生制限で鳴らせなかったBGMを、ユーザーの操作をきっかけに再試行する。
// 「BGMを再開」ボタン・ページ内最初のタップ、どちらからも呼べる。
export function retryCurrentBgm(): void {
  if (typeof window === "undefined") return;
  // 9回目レビュー対応：再開が必要か（stalledか）は、AudioContextをresumeする「前」の状態で
  // 判定する（先にresumeするとctx.stateがrunningになり、suspended中に古い位置で作られた
  // sourceを作り直さず終わってしまうため）。手順は
  //   1) resume前の状態で再開要否を判定 → 2) 必要なら最新位置からsourceを作り直す
  //   3) AudioContextをresume
  // の順。attemptStartBgm(Web Audio)内にもresumeがあるが、resume()は冪等で、needsAudioResume
  // の成功/失敗管理は従来どおりそちらが行う。currentBgmが無い場合も、効果音等のために
  // AudioContextをアンロックする従来の目的は維持する（3)は常に実行）。
  const ctx = getAudioContext();
  const cur = currentBgm;
  const decision = cur
    ? decideBgmRetry({
        enabled: state.bgmEnabled,
        hasCurrent: true,
        paused: isBgmPaused(cur.playback),
        webAudioStalled: !cur.playback.fallbackAudio && cur.playback.isPlaying && !!ctx && ctx.state !== "running",
      })
    : "skip";
  if (decision === "restart" && cur) {
    const pb = cur.playback;
    const durationSec = pb.fallbackAudio ? pb.fallbackAudio.duration : (pb.buffer?.duration ?? 0);
    const fallbackSec = getBgmOffsetSec(pb, ctx);
    // ユーザー操作経路：HTMLAudioはこのイベント内で同期的にplay()を試す。
    attemptStartBgm(
      pb,
      bgmIntent.name === cur.name ? resolveBgmOffsetSec(bgmIntent.startAtMs, durationSec, fallbackSec) : fallbackSec,
      { userGesture: true },
    );
    fadeBgm(pb, getBgmVolume(pb), BGM_VOLUME[cur.name], FADE_MS);
  }
  resumeAudioContext();
}

// ============================================================
// 設定変更（右上の音声マーク・BGM確認モーダル、共通で使う）
// ============================================================

export function setBgmEnabled(next: boolean): void {
  setState({ bgmEnabled: next });
  writeStoredMuted(BGM_MUTE_STORAGE_KEY, !next);

  if (next) {
    if (bgmIntent.name) {
      activateBgm(bgmIntent.name as BgmName);
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
