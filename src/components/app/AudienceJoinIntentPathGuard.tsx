"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { isLiveParticipantPath } from "@/lib/liveParticipantPath";
import { useAudienceJoinIntentStore } from "@/store/useAudienceJoinIntentStore";
import { useConsentGateStore } from "@/store/useConsentGateStore";

// 観客参加の意図（useAudienceJoinIntentStore）の「ページ離脱で破棄する」処理を、
// /liveページ自身のコンポーネントではなく、ここ（ConsentRequiredGateの外側、常時マウント）で行う。
//
// 理由：ConsentRequiredGateは同意確認が終わるまでの間（checking等）、配下のchildren（/liveの
// ページ本体を含む）を一時的にアンマウントする設計になっている（未同意状態での操作を防ぐための
// 既存の安全策）。ゲスト観客ボタン押下→匿名認証成功の直後は、authUserのid変化によりまさに
// この一時アンマウントが起きる。意図の破棄を/live側コンポーネントのアンマウント時に行うと、
// この正規の一時アンマウントでも意図が誤って破棄され、同意・認証が成功していても観客登録
// （join_live）が一度も実行されない不具合になる（本番テストライブで確認済み）。
// pathnameは一時アンマウントの間は変わらないため、ここで「実際に/liveを離れた」場合だけ
// 破棄すれば、上記の誤破棄を避けつつ、真のページ離脱時の破棄は維持できる。
export default function AudienceJoinIntentPathGuard() {
  const pathname = usePathname();
  const wasOnLiveRef = useRef(isLiveParticipantPath(pathname));

  useEffect(() => {
    const onLiveNow = isLiveParticipantPath(pathname);
    if (wasOnLiveRef.current && !onLiveNow) {
      useAudienceJoinIntentStore.getState().discard();
      // 開いたままのゲスト用同意モーダルも閉じる（ページ離脱後に匿名認証を始めさせない）。
      const gate = useConsentGateStore.getState();
      if (gate.pendingModal?.kind === "guest") gate.cancel();
    }
    wasOnLiveRef.current = onLiveNow;
  }, [pathname]);

  return null;
}
