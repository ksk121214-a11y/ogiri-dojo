"use client";

import ScreenShell from "@/components/live-demo/ScreenShell";

// 観客参加ボタンを押した直後の、参加登録（join_live）完了までの短い表示。
// この間は押せる参加ボタンを出さない（同じ意思確認を二度させない）。
export default function AudienceEnteringScreen() {
  return (
    <ScreenShell>
      <p role="status" className="font-sans text-base font-bold text-white/90">
        観客席へ入場中…
      </p>
    </ScreenShell>
  );
}
