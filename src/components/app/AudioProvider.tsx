"use client";

import { createContext, useContext, useEffect, useState } from "react";

import * as audioManager from "@/lib/audio/audioManager";
import type { AudioManagerState } from "@/lib/audio/audioManager";

import BgmConsentModal from "./BgmConsentModal";

// アプリ全体の音声状態（AudioManagerState）をコンポーネントツリーに配布するだけの
// 薄いContextレイヤー。実体（AudioContext・BGMプレイヤー・SEバッファ等）は
// すべてsrc/lib/audio/audioManager.tsのモジュールスコープに存在し、
// このProvider自体が破棄・再生成されても実体には影響しない。
// ルートレイアウト（src/app/layout.tsx）にホーム画面・ライブ画面をまたいで
// 1回だけ配置する。
const AudioStateContext = createContext<AudioManagerState | null>(null);

export function useAudioState(): AudioManagerState {
  const ctx = useContext(AudioStateContext);
  if (!ctx) {
    throw new Error("useAudioState must be used within <AudioProvider>");
  }
  return ctx;
}

export default function AudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AudioManagerState>(() => audioManager.getState());
  const [showBgmPrompt, setShowBgmPrompt] = useState(false);

  useEffect(() => {
    return audioManager.subscribe(setState);
  }, []);

  // ホーム画面・ライブ画面で使う音声を、実際に鳴らす前に事前読み込みしておく。
  useEffect(() => {
    audioManager.preloadAllSfx();
  }, []);

  // 「初回アクセス・ブラウザ更新直後に1回だけ表示、SPA遷移では出さない、
  // React Strict Modeでも二重表示しない」を満たすためのロジック。
  //
  // hasShownBgmPromptThisBoot（audioManager内のモジュール変数）はページの
  // フルリロードでリセットされ、SPA遷移では保持され続けるため、これだけで
  // 「1ブート1回・リロードで再表示」の条件はほぼ満たせる。
  //
  // 残るStrict Modeの二重実行対策として、このeffectが「一時的に破棄される
  // 1回目の実行」なのか「実際に生き残る実行」なのかは事前に区別できないため、
  // 自分がフラグを立てた場合はクリーンアップで一旦戻す、という
  // Reactが推奨する「Effectは2回実行されても副作用が正しく収束するように書く」
  // パターンを使う。本番（Strict Modeなし）ではこのeffectは1回しか実行されず、
  // クリーンアップはAudioProvider自体がアンマウントされる時（通常起こらない）
  // にしか走らないため実害はない。
  useEffect(() => {
    let flaggedByThisRun = false;
    if (!audioManager.hasShownBgmPrompt()) {
      audioManager.markBgmPromptShown();
      flaggedByThisRun = true;
      // マウント時に一度だけモーダル表示を確定させるための意図的な同期setState
      // （起動ごとに1回だけ、という要件上ここでしか判定できない）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowBgmPrompt(true);
    }
    return () => {
      if (flaggedByThisRun) {
        audioManager.unmarkBgmPromptShown();
      }
    };
  }, []);

  return (
    <AudioStateContext.Provider value={state}>
      {children}
      {showBgmPrompt && <BgmConsentModal onDone={() => setShowBgmPrompt(false)} />}
    </AudioStateContext.Provider>
  );
}
