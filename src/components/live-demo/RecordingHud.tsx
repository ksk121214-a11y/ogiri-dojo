"use client";

// 動画撮影モード専用の操作パネル。/live-demo?mode=recording のときだけ表示する。
// 「撮り直す」は体験版を開演前の状態へ戻す（同じ種なら同じ内容で再開される）。
// 「操作を隠す」は ?hud=0 と同じで、撮影中に本番にないボタンや文字を映さないためのもの。
// 位置は画面の左上（送信ボタン・回答欄と重ならないように）。隠した後は URL を ?hud=1 にするか、
// ページを開き直すと再び表示される。
export default function RecordingHud({
  onReset,
  onHide,
}: {
  onReset: () => void;
  onHide: () => void;
}) {
  return (
    <div
      data-recording-hud
      className="pointer-events-auto absolute left-3 top-[max(12px,env(safe-area-inset-top))] z-50 flex gap-2 rounded-full bg-black/60 px-3 py-1.5 font-sans text-xs text-white backdrop-blur"
    >
      <button type="button" onClick={onReset} className="rounded-full border border-white/40 px-3 py-1.5 font-bold">
        撮り直す
      </button>
      <button type="button" onClick={onHide} className="rounded-full border border-white/40 px-3 py-1.5 font-bold">
        操作を隠す
      </button>
    </div>
  );
}
