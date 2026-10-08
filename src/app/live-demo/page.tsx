"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import AudienceScreen from "@/components/live-demo/AudienceScreen";
import ClosedScreen from "@/components/live-demo/ClosedScreen";
import FinalResultScreen from "@/components/live-demo/FinalResultScreen";
import GroupResultScreen from "@/components/live-demo/GroupResultScreen";
import InterludeScreen from "@/components/live-demo/InterludeScreen";
import RecordingHud from "@/components/live-demo/RecordingHud";
import LaughEffectOverlay from "@/components/live-room/LaughEffectOverlay";
import OpeningScreen from "@/components/live-demo/OpeningScreen";
import SoundToggle from "@/components/live-demo/SoundToggle";
import StageScreen from "@/components/live-demo/StageScreen";
import StartScreen from "@/components/live-demo/StartScreen";
import TopicRevealScreen from "@/components/live-demo/TopicRevealScreen";
import { liveDemoReactionSource } from "@/lib/liveDemoReactionSource";
import { isMyGroupOnStage } from "@/lib/liveDemoSelectors";
import { LiveReactionSourceContext } from "@/lib/liveReactionSource";
import { playBgm, stopBgm } from "@/lib/bgm";
import { hasSeenCurtain } from "@/lib/curtainSeen";
import { DEFAULT_RECORDING_SETTINGS, parseLiveDemoMode, type RecordingSettings } from "@/lib/liveDemoMode";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// ライブ体験モック（/live-demo）：ダミーデータ・ローカル状態管理のみで進行するステートマシンのお試し実装。
// ?mode=recording は動画撮影モード。表示・演出・音・時間は本番と同じ部品・規則を使い、違いは次の3点だけ：
//   ①データ供給元（ローカルの固定ボット・固定種の乱数。Supabase・Realtime・サーバー時計を使わない）
//   ②保存（ポイント・熟練度・初回ライブ特典・DB書き込みを一切しない）
//   ③撮影用の操作（撮り直し・操作を隠す。hud=0で非表示）。撮影モードの文言は本番にあるものだけ。
// 詳細と検査は src/lib/liveDemoMode.ts・src/lib/__tests__/liveDemoRecordingMode.check.ts を参照。
// 本来はサーバ（Supabase Realtime）基準で全クライアントに同期する（仕様書 §1.4・§13）が、
// このモックでは1台のブラウザ内のタイマーで代用する。
export default function LiveDemoPage() {
  // 開発確認モード（既定）と動画撮影モード（?mode=recording）。URLは描画後に読む（静的書き出しとの不一致を避ける）
  // URLは変わらない前提で読む（subscribeは何もしない）。サーバー描画時は開発確認モードとして扱う。
  const search = useSyncExternalStore(
    () => () => {},
    () => window.location.search,
    () => "",
  );
  const mode = useMemo(() => parseLiveDemoMode(search), [search]);
  // 撮影用の操作パネルを「操作を隠す」で閉じた状態（再読み込みで URL の hud 設定に戻る）
  const [hudHidden, setHudHidden] = useState(false);
  // 撮影モードの開始設定（名前・お題・ボット回答）。撮り直しでも維持し、再読み込みで初期値へ戻る
  const [recordingSettings, setRecordingSettings] = useState<RecordingSettings>(DEFAULT_RECORDING_SETTINGS);
  const hudVisible = mode.hud && !hudHidden;
  const status = useLiveDemoStore((s) => s.status);
  const phase = useLiveDemoStore((s) => s.phase);
  const judging = useLiveDemoStore((s) => s.judging);
  const tick = useLiveDemoStore((s) => s.tick);
  const sendTsukkomi = useLiveDemoStore((s) => s.sendTsukkomi);
  const onStage = useLiveDemoStore(isMyGroupOnStage);
  const resetLive = useLiveDemoStore((s) => s.resetLive);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      tick(Date.now());
    }, 150);
    return () => clearInterval(id);
  }, [status, tick]);

  // BGM：待機画面開始のタイミングだけはCurtainOverlay.tsx側で「幕が開く音（琴の滑奏）」と
  // 同時に鳴らす（それより前は無音のまま）。ここではその後のフェーズ切り替えだけを扱う。
  // 出囃子(お題発表)→ライブ中(回答中のみ)→待機画面(組結果・最終結果)→閉幕したら完全停止。
  // openingはinterludeで既に鳴り始めている待機画面BGMの続きなので明示的な指定は不要
  // （何も指定しなければ直前の曲が鳴り続ける）。playBgm自体が「既に同じ曲なら何もしない」
  // ため、複数フェーズが同じ曲を共有していても曲が途切れず流れ続ける。
  useEffect(() => {
    if (phase === "topic_reveal") {
      playBgm("entrance");
    } else if (phase === "answering") {
      playBgm("live");
    } else if (phase === "group_result" || phase === "final_result") {
      playBgm("waiting");
    } else if (phase === "interlude" || phase === "opening") {
      // 本番（/live/page.tsx）と同じ規則：幕の演出を既に見ている2回目以降は、ここで待機BGMに切り替える。
      // 初回はCurtainOverlay（幕が開く音と同時）に任せる。撮り直しでも本番と同じ音になる。
      if (hasSeenCurtain()) playBgm("waiting");
    } else if (phase === "closed") {
      stopBgm();
    }
  }, [phase]);

  // ページ離脱時（ホームに戻る等）は必ずBGMを止める。/live/page.tsx（本番）と同じ保険で、
  // これが無いと「まだ鳴っていたライブ中BGM」がホームBGMと重なって鳴り続けてしまう。
  useEffect(() => {
    return () => {
      stopBgm();
    };
  }, []);

  // 客席のボット観客たちが、サイクル外でランダムに拍手する演出（純演出・スコア非加算 §4.4）。
  // 舞台・客席のどちらの画面を見ていても同じ客席の熱量が伝わるよう、画面に依存せずここで発生させる（§9）。
  useEffect(() => {
    if (status !== "running" || phase !== "answering" || judging) return;
    const id = setInterval(() => {
      // 拍手は時間で発生する純演出（得点・回答と無関係）。ゲームの種の乱数を使うと、
      // 実行ごとの時間のずれで後の組の結果が変わるため、ここだけは通常の乱数を使う
      if (Math.random() < 0.5) sendTsukkomi("clap", "👏");
    }, 1400);
    return () => clearInterval(id);
  }, [status, phase, judging, sendTsukkomi]);

  let content: React.ReactNode = null;
  if (status === "idle") {
    content = (
      <StartScreen
        key="start"
        mode={mode}
        settings={recordingSettings}
        onSettingsChange={setRecordingSettings}
      />
    );
  } else {
    switch (phase) {
      case "interlude":
        content = <InterludeScreen key="interlude" />;
        break;
      case "opening":
        content = <OpeningScreen key="opening" />;
        break;
      case "topic_reveal":
        content = <TopicRevealScreen key="topic_reveal" />;
        break;
      case "answering":
        content = onStage ? (
          <StageScreen key="stage" />
        ) : (
          <AudienceScreen key="audience" />
        );
        break;
      case "group_result":
        content = <GroupResultScreen key="group_result" />;
        break;
      case "final_result":
        content = <FinalResultScreen key="final_result" />;
        break;
      case "closed":
        content = <ClosedScreen key="closed" />;
        break;
      default:
        content = null;
    }
  }

  // 笑い・ツッコミの演出は実ライブと同じ部品（live-room）を、体験版のストアを取り出し口にして使う
  return (
    <LiveReactionSourceContext.Provider value={liveDemoReactionSource}>
      <main className="relative h-dvh w-full overflow-hidden bg-dojo-stage-dark">
        <AnimatePresence mode="wait">{content}</AnimatePresence>
        <LaughEffectOverlay />
        <SoundToggle />
        {mode.recording && hudVisible ? (
          <RecordingHud
            onReset={() => {
              stopBgm();
              resetLive();
            }}
            onHide={() => setHudHidden(true)}
          />
        ) : null}
      </main>
    </LiveReactionSourceContext.Provider>
  );
}
