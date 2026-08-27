"use client";

import { useEffect, useState } from "react";

import AudienceAnsweringViewPreview from "@/components/live-design-preview/AudienceAnsweringViewPreview";
import StageAnsweringViewPreview from "@/components/live-design-preview/StageAnsweringViewPreview";
import { useLiveDesignPreviewStore } from "@/store/useLiveDesignPreviewStore";

// リハに向けたデザイン確認専用ページ（隠しURL、ナビからはリンクしない）。
// 本番の /live/answering と全く同じ見た目のコンポーネント（StageAnsweringViewPreview /
// AudienceAnsweringViewPreview）を、Supabase接続なしのローカルモックストアで動かす。
// ここで詰めた見た目（玉が落ちる演出等）は、固まったタイミングで本番の
// StageAnsweringView.tsx / AudienceAnsweringView.tsx に手動で反映する運用。
export default function LiveDesignPreviewPage() {
  const [view, setView] = useState<"stage" | "audience">("stage");
  const initPreview = useLiveDesignPreviewStore((s) => s.initPreview);
  const resetPreview = useLiveDesignPreviewStore((s) => s.resetPreview);
  const stopPreview = useLiveDesignPreviewStore((s) => s.stopPreview);

  useEffect(() => {
    initPreview();
    return () => stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // 舞台の台座グラフィックは意図的にコンテナ幅より横に大きく作られており(122%)、
    // 縦方向は overflow-visible にして絶対に切れないようにする必要がある一方、
    // 横方向にpage自体がスクロール可能になってしまうと、実機でスワイプした際に
    // 中央にあるはずの舞台が画面内で左右にズレて見えてしまう。
    // overflow-xだけ/overflow-yだけを個別のhidden/visibleにすると、Safariでは
    // 「片方がvisible・もう片方がvisibleでない」場合にvisible側が実質autoとして
    // 扱われる仕様があり以前これでハマったため、同じ要素内でx/yを混在させない。
    // その代わり、この外側divではx/yとも hidden にして横方向のはみ出しだけを
    // 実際に切り、内側のdiv（本来の舞台コンテンツ）はx/yともvisibleのまま保ち、
    // 縦方向の見切れは起きない（内側のdivの高さがh-dvhで外側と同じため、外側の
    // overflow-hiddenは縦方向には何もクリップしない）。
    <div className="relative h-dvh w-full overflow-hidden bg-dojo-stage-dark">
      <div className="relative h-full w-full overflow-visible">
        {view === "stage" ? <StageAnsweringViewPreview /> : <AudienceAnsweringViewPreview />}
        {/*
          操作バーは上部だとお題ボードの邪魔になるため、画面右下に小さく置く
          (以前デバッグ用に置いていたbuild:fix18表示の場所に統合)。
          本番コンポーネント（ScreenShell）は常にh-dvh固定のため、操作バーぶんの高さを
          コンテンツ側に確保させようとするとレイアウトが破綻する。バーは画面に重ねるoverlayにして、
          コンテンツ側の見た目（ScreenShell含む）は本番と完全に同一のまま一切変更しない。
        */}
        <div className="fixed bottom-1 right-1 z-50 flex items-center gap-1 rounded bg-dojo-backstage-navy/85 px-1.5 py-1 text-[10px] backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setView("stage")}
            className={`rounded-full px-2 py-0.5 font-sans font-bold transition ${
              view === "stage"
                ? "bg-dojo-curtain-gold text-dojo-stage-dark"
                : "text-dojo-washi-white/70 hover:text-dojo-washi-white"
            }`}
          >
            舞台
          </button>
          <button
            type="button"
            onClick={() => setView("audience")}
            className={`rounded-full px-2 py-0.5 font-sans font-bold transition ${
              view === "audience"
                ? "bg-dojo-curtain-gold text-dojo-stage-dark"
                : "text-dojo-washi-white/70 hover:text-dojo-washi-white"
            }`}
          >
            客席
          </button>
          <button
            type="button"
            onClick={resetPreview}
            className="rounded-full border border-dojo-gray-purple/50 px-2 py-0.5 font-sans text-dojo-washi-white/70 transition hover:border-dojo-curtain-gold hover:text-dojo-curtain-gold"
          >
            やり直す
          </button>
        </div>
      </div>
    </div>
  );
}
