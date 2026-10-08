// /live-demo の動作モード。URLで切り替える（既定は開発確認モードで、従来の挙動のまま）。
//   /live-demo                    … 開発確認モード（従来の体験版）
//   /live-demo?mode=recording     … 動画撮影モード（本番standardと同じ時間・順序・演出。ローカル固定データのみ）
//   /live-demo?mode=recording&seed=xxx  … 種を変えると別の回答・得点・組分けになる（既定の種は固定）
//   /live-demo?mode=recording&hud=0     … 撮影用の操作パネルを隠す（撮影中に本番にないUIを映さないため）
// 本番（/live）はこの関数を使わない。動画撮影モードは本番DB・Realtime・ポイント等へ一切書き込まない。

export const DEFAULT_RECORDING_SEED = "bakusho-recording-1";

export interface LiveDemoMode {
  recording: boolean;
  seed: string;
  hud: boolean;
}

export function parseLiveDemoMode(search: string): LiveDemoMode {
  const params = new URLSearchParams(search);
  const recording = params.get("mode") === "recording";
  const rawSeed = params.get("seed")?.trim() ?? "";
  return {
    recording,
    seed: recording && rawSeed !== "" ? rawSeed : DEFAULT_RECORDING_SEED,
    hud: params.get("hud") !== "0",
  };
}

// 動画撮影モードの開始設定（自分の名前・お題・ボット回答の有無）。
// 本番DBやlocalStorageには保存しない。撮り直しでは同じ設定を使い、再読み込みで初期値へ戻る。
export const RECORDING_NAME_MAX_LENGTH = 12;
export const RECORDING_TOPIC_MAX_LENGTH = 60;
export const RECORDING_DEFAULT_NAME = "あなた";
export const RECORDING_DEFAULT_TOPIC = "新しい必殺技『座布団投げ』。どんな技？";

export interface RecordingSettings {
  displayName: string;
  topic: string;
  // 既定はOFF（ボットの回答を出さず、自分の回答だけで撮影を進める）
  botAnswers: boolean;
}

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  displayName: RECORDING_DEFAULT_NAME,
  topic: RECORDING_DEFAULT_TOPIC,
  botAnswers: false,
};

// 入力を安全な値へ整える。前後の空白を除き、空欄は既定値へ戻し、長すぎる入力は切り詰める。
// 表示はReactの文字列描画だけを使う（HTMLとして解釈しない）。
export function normalizeRecordingSettings(input: { displayName: string; topic: string; botAnswers: boolean }): RecordingSettings {
  const name = Array.from(input.displayName.trim()).slice(0, RECORDING_NAME_MAX_LENGTH).join("");
  const topic = Array.from(input.topic.trim()).slice(0, RECORDING_TOPIC_MAX_LENGTH).join("");
  return {
    displayName: name === "" ? RECORDING_DEFAULT_NAME : name,
    topic: topic === "" ? RECORDING_DEFAULT_TOPIC : topic,
    botAnswers: input.botAnswers,
  };
}

// 開始ボタンを押せるか（名前・お題が空欄なら開始させない。既定値へ戻す処理とは別に、画面で判定する）。
export function canStartRecording(input: { displayName: string; topic: string }): boolean {
  return input.displayName.trim() !== "" && input.topic.trim() !== "";
}
