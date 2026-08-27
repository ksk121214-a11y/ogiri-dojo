"use client";

import { useEffect, useState } from "react";

import AudienceAnsweringViewPreview2 from "@/components/live-design-preview-2/AudienceAnsweringViewPreview2";
import FinalResultViewPreview2 from "@/components/live-design-preview-2/FinalResultViewPreview2";
import GroupResultViewPreview2 from "@/components/live-design-preview-2/GroupResultViewPreview2";
import LiveGroupingScreenPreview2 from "@/components/live-design-preview-2/LiveGroupingScreenPreview2";
import LiveOpeningScreenPreview2 from "@/components/live-design-preview-2/LiveOpeningScreenPreview2";
import LiveStageBackdropPreview2 from "@/components/live-design-preview-2/LiveStageBackdropPreview2";
import LiveStartScreenPreview2 from "@/components/live-design-preview-2/LiveStartScreenPreview2";
import LiveTopicRevealScreenPreview2 from "@/components/live-design-preview-2/LiveTopicRevealScreenPreview2";
import StageAnsweringViewPreview2 from "@/components/live-design-preview-2/StageAnsweringViewPreview2";
import ScreenShell from "@/components/live-demo/ScreenShell";
import { useLiveDesignPreviewStore2 } from "@/store/useLiveDesignPreviewStore2";

// /live/design-preview/ （1個目のデザイン確認、隠しURL）の別デザイン版。
// レイアウト・ゲームロジック（ストア・グリッド構成・実測サイズ計算など）は
// 1個目と完全に同じまま、見た目だけ大喜利素材2のネオン系アセットに差し替えている。
// どちらも隠しURLでナビからはリンクせず、比較検討用に並行して残す。
//
// 3組・1組5人(計15人、審査員兼観客は常に残り2組=10人)・組が終わるごとに
// 組結果発表・3組終わったら最終結果発表、という本番同様の流れは
// useLiveDesignPreviewStore2側のphase(live.current_phase)で管理しており、
// ここではそのphaseに応じて表示するビューを出し分けるだけ。
//
// 舞台(回答者)視点・客席(審査員)視点は、以前は手動ボタンで切り替えていたが、
// 本番は「今のターンが自分の組かどうか」で画面が自動的に決まるため、それに
// 合わせて自動切り替えにしている(ボタンは撤去)。
//
// 「ライブに参加」を押すと、スタート演出→組分け発表(自分がどの組か分かる)→
// お題大写し、という導入を経てから実際の回答受付(live)が始まる。導入演出の
// 間はuseLiveDesignPreviewStore2側もまだ回答受付の時計を動かしておらず
// (initPreviewは最初のターンのお題を用意するだけ)、導入が終わるタイミングで
// beginFirstTurn()を呼んで初めて締切のカウントが始まる。
const OPENING_DURATION_MS = 1400;
const GROUPING_DURATION_MS = 3200;
const TOPIC_REVEAL_DURATION_MS = 2200;

type Stage = "start" | "opening" | "grouping" | "topicReveal" | "live";

export default function LiveDesignPreview2Page() {
  const [stage, setStage] = useState<Stage>("start");
  // スタート画面で選んだ「自分の組の人数」。やり直す時も同じ人数で再現できるよう覚えておく。
  const [myGroupSize, setMyGroupSize] = useState(5);
  const initPreview = useLiveDesignPreviewStore2((s) => s.initPreview);
  const beginFirstTurn = useLiveDesignPreviewStore2((s) => s.beginFirstTurn);
  const resetPreview = useLiveDesignPreviewStore2((s) => s.resetPreview);
  const stopPreview = useLiveDesignPreviewStore2((s) => s.stopPreview);
  const phase = useLiveDesignPreviewStore2((s) => s.live?.current_phase);
  const groupResult = useLiveDesignPreviewStore2((s) => s.groupResult);
  const finalResult = useLiveDesignPreviewStore2((s) => s.finalResult);
  const myParticipant = useLiveDesignPreviewStore2((s) => s.myParticipant);
  const currentTurn = useLiveDesignPreviewStore2((s) => s.currentTurn);

  useEffect(() => {
    return () => stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runIntroSequence = () => {
    setStage("opening");
    setTimeout(() => {
      setStage("grouping");
      setTimeout(() => {
        setStage("topicReveal");
        setTimeout(() => {
          beginFirstTurn();
          setStage("live");
        }, TOPIC_REVEAL_DURATION_MS);
      }, GROUPING_DURATION_MS);
    }, OPENING_DURATION_MS);
  };

  const handleJoin = (groupSize: number) => {
    setMyGroupSize(groupSize);
    initPreview(groupSize);
    runIntroSequence();
  };

  const handleRestart = () => {
    resetPreview(myGroupSize);
    runIntroSequence();
  };

  // 今のターンが自分の組なら回答者(舞台)視点、それ以外の組なら審査員(客席)視点。
  // 本番同様、ここはユーザーが手動で切り替えるものではない。
  const isAnswererView = !!currentTurn && myParticipant?.group_id === currentTurn.group_id;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0d0a1a]">
      <div className="relative h-full w-full overflow-visible">
        {stage === "start" ? (
          <LiveStartScreenPreview2 onJoin={handleJoin} />
        ) : stage === "opening" ? (
          <LiveOpeningScreenPreview2 />
        ) : stage === "grouping" ? (
          <LiveGroupingScreenPreview2 />
        ) : stage === "topicReveal" ? (
          <LiveTopicRevealScreenPreview2 />
        ) : phase === "group_result" && groupResult ? (
          <>
            <LiveStageBackdropPreview2 />
            <ScreenShell className="!text-white">
              <GroupResultViewPreview2 data={groupResult} myParticipantId={myParticipant?.id ?? null} />
            </ScreenShell>
          </>
        ) : phase === "final_result" && finalResult ? (
          <>
            <LiveStageBackdropPreview2 />
            <ScreenShell className="!text-white">
              <FinalResultViewPreview2 data={finalResult} myParticipantId={myParticipant?.id ?? null} />
            </ScreenShell>
          </>
        ) : isAnswererView ? (
          <StageAnsweringViewPreview2 />
        ) : (
          <AudienceAnsweringViewPreview2 />
        )}

        {stage === "live" && (
          // 以前は舞台/客席の手動切替ボタンも含めて画面右下に置いていたが、
          // 「やり直す」だけになった後も同じ位置のままだと、ツッコミ/爆笑/拍手
          // ボタン行(客席視点、画面下端ぎりぎりまで伸びる)と重なってしまう。
          // 下部の操作ボタン群と衝突しない右上に移動する。
          <div className="fixed right-1 top-1 z-50 flex items-center gap-1 rounded bg-[#0d0a1a]/85 px-1.5 py-1 text-[10px] backdrop-blur-sm">
            <button
              type="button"
              onClick={handleRestart}
              className="rounded-full border border-white/30 px-2 py-0.5 font-sans text-white/70 transition hover:border-[#3b5bff] hover:text-[#7ab2ff]"
            >
              やり直す
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
