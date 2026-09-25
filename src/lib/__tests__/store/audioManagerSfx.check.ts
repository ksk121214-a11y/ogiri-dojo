// 未実装SE（SFX_PATHS[name]===null）が、事前読み込み・再生・HTMLAudioフォールバックの
// 全経路でネットワーク要求・Audio生成・警告を出さないこと、実在SEは従来どおり読み込まれる
// ことを、本番のaudioManager.tsをそのまま動かして検証する（window・fetch・AudioContext・
// Audio・console.warnを偽物に差し替えて呼び出しを数える）。
import assert from "node:assert/strict";

const fetched: string[] = [];
const audioCreated: string[] = [];
const warns: unknown[][] = [];
let audioSupported = true;

const ctxs: Array<{ state: string }> = [];
class FakeAudioCtx {
  state = "running";
  currentTime = 0;
  destination = {};
  addEventListener() {}
  resume() { return Promise.resolve(); }
  static create() { const c = new FakeAudioCtx(); ctxs.push(c); return c; }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
  createBufferSource() { return { connect: () => ({ connect: () => ({}) }), start: () => {}, buffer: null }; }
  createGain() { return { gain: { value: 1 }, connect: () => ({}) }; }
}
class FakeAudio {
  paused = true; duration = NaN; currentTime = 0; volume = 1; preload = "";
  constructor(src: string) { audioCreated.push(src); }
  addEventListener() {}
  removeEventListener() {}
  cloneNode() { return new FakeAudio("clone"); }
  play() { return Promise.resolve(); }
}
const g = globalThis as unknown as Record<string, unknown>;
const win: Record<string, unknown> = {
  localStorage: { getItem: () => null, setItem: () => {} },
  addEventListener() {},
};
// audioManagerは `new Ctor()` するため、生成したインスタンスを記録するコンストラクタを渡す。
function TrackedCtx(): FakeAudioCtx {
  return FakeAudioCtx.create();
}
Object.defineProperty(win, "AudioContext", { get: () => (audioSupported ? TrackedCtx : undefined) });
g.window = win;
g.Audio = FakeAudio;
g.fetch = async (url: string) => {
  fetched.push(url);
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
};
console.warn = (...a: unknown[]) => void warns.push(a);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const am = require("@/lib/audio/audioManager") as typeof import("@/lib/audio/audioManager");

const UNIMPLEMENTED = ["countdownTick", "spotlightIn", "bigLaugh", "rankReveal", "masteryLevelup", "startLive"] as const;
const REAL = Object.keys(am.SFX_PATHS).filter((k) => am.SFX_PATHS[k as keyof typeof am.SFX_PATHS] !== null);
const flush = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  for (const n of UNIMPLEMENTED) assert.equal(am.SFX_PATHS[n], null, `${n}はnull（未実装）`);
  assert.equal(REAL.length, 12);

  // 1) preloadAllSfx：実在SEだけをfetchし、未実装は0回。audioReadyは完了する。
  am.preloadAllSfx();
  await flush();
  assert.equal(am.getState().audioReady, true, "未実装SEがあってもaudioReadyが完了する");
  assert.equal(fetched.length, REAL.length, "実在SEの数だけfetchする");
  for (const p of Object.values(am.SFX_PATHS)) if (p) assert.ok(fetched.some((u) => u.endsWith(p)), `実在SE ${p} は読み込まれる`);
  for (const bad of ["countdown-tick", "spotlight-in", "big-laugh", "rank-reveal", "mastery-levelup", "start-live"]) {
    assert.ok(!fetched.some((u) => u.includes(bad)), `${bad}をfetchしていない`);
  }
  assert.equal(warns.length, 0, "警告なし");

  // 2) preloadSfxOne：未実装はfetchせずok（失敗扱いにしない）。実在は従来どおり。
  const before = fetched.length;
  for (const n of UNIMPLEMENTED) assert.deepEqual(await am.preloadSfxOne(n), { ok: true });
  assert.equal(fetched.length, before);
  assert.deepEqual(await am.preloadSfxOne("buttonPress"), { ok: true });

  // 3) playSfx：Web Audio経路・フォールバック経路（AudioContext無し）・連打のいずれでも、
  //    未実装SEはfetch・Audio生成・警告が0回。
  for (let i = 0; i < 30; i++) for (const n of UNIMPLEMENTED) am.playSfx(n);
  await flush();
  assert.equal(fetched.length, before, "連打してもfetchが増えない");
  assert.equal(audioCreated.length, 0, "Audio生成0回");
  assert.equal(warns.length, 0);
  audioSupported = false; // AudioContext不可＝HTMLAudioフォールバック経路
  for (let i = 0; i < 30; i++) for (const n of UNIMPLEMENTED) am.playSfx(n, { offsetSec: 0.5 });
  await flush();
  assert.equal(audioCreated.length, 0, "フォールバック経路でもAudio生成0回");
  assert.equal(fetched.length, before);
  assert.equal(warns.length, 0);

  // 4) 実在SEは従来どおり：読込済みならWeb Audioで再生(Audio生成なし)、アンロック前などの
  //    フォールバックでは従来どおりAudioを生成する。
  am.playSfx("buttonPress");
  assert.equal(audioCreated.length, 0, "読込済みの実在SEはWeb Audioで再生");
  ctxs[0].state = "suspended";
  am.playSfx("buttonPress");
  assert.equal(audioCreated.filter((u) => u !== "clone").length, 1, "実在SEはフォールバックで従来どおりAudio生成");
  assert.ok(audioCreated[0].endsWith("/sounds/button-press.mp3"));
  console.log("PASS: 未実装SEはpreload/play/フォールバック/連打のいずれでもfetch・Audio生成・警告が0回、実在SEは従来どおり");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
