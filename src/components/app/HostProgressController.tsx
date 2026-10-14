"use client";

import { useEffect } from "react";

import {
  attachHostProgressSession,
  createHostAutoWriter,
  getBrowserLockManager,
  hostIdentityMatches,
} from "@/lib/hostAutoWriter";
import { useAuthStore } from "@/store/useAuthStore";
import {
  catchUpHostAutoProgress,
  startHostAutoProgress,
  stopHostAutoProgress,
  useLiveHostStore,
  waitHostAutoWritesIdle,
} from "@/store/useLiveHostStore";
import { useProfileStore } from "@/store/useProfileStore";

// 管理者(isHost)がアプリ内のどの画面にいても、ライブ進行を止めない・失っても
// 復元できるようにするための常駐コントローラー。RootLayoutに置く。
//
// 【背景】以前はuseLiveHostStore.init()の呼び出しが/live/hostページ自身の
// useEffectだけに依存していた。同じ管理者が/admin/*等の別の管理画面へ移動したり、
// 別タブ・別ウィンドウで管理画面を開き直したりした際に進行が止まって見える
// ケースがあった（回答reveal・採点確定・フェーズ遷移が0秒のまま進まなくなる）。
//
// 【責務の分離（2026-10-15、2A.2b-W1）】RootLayoutに常駐するため、管理者が複数タブを
// 開くとタブごとにこのコントローラーが動く。以前は各タブがinit()のtickで自動進行RPCを
// 送っていたため、次の2つに分けた。
// - 読み取り側（全adminタブ）：init()によるスナップショット取得・Realtime購読・
//   読み取り維持tick。表示・「最新状態を取得」・手動の司会操作はこれまでどおり全タブで使える。
// - 自動writer（1タブだけ）：Web Locksのexclusive lockを取得したvisibleなタブだけが
//   最新状態を取り直してから自動進行timer(advanceIfDue)を動かす。hidden・pagehide・
//   logout・isHost剥奪・unmountでticketを無効化してlockを返し、待機中の別タブが引き継ぐ。
//   Web Locks非対応のブラウザでは自動進行を起動しない（fail-closed）。
// 詳細はsrc/lib/hostAutoWriter.ts・useLiveHostStore.tsのstartHostAutoProgress参照。
//
// 【視認できる形での期限超過リカバリ】visibilitychange（visible復帰）・focus・pageshow
// （bfcache復元）・online では、読み取り側をinit()で再確認し、lockの取得も（重複なく）試みる。
//
// 【残る制約】ブラウザタブを完全に閉じる・PCがスリープする等、JSの実行自体が
// 止まるケースまではカバーできない（全タブがhiddenの間は自動writerが0件になる）。
// 観客・回答者側の補助tick(advance_live_progress_if_due)は別系統で、この制御の対象外。
//
// 【停止処理】isHostがfalseになった時（ログアウト・権限剥奪）・利用者が切り替わった時、
// およびeffect cleanup時に、writerを停止（ticket無効化・lock待機のabort・lock解放）してから
// useLiveHostStore.stopHostProgress()でtimer・Realtime channels・進行用の状態を片付ける。
export default function HostProgressController() {
  const isHost = useProfileStore((s) => s.profile?.isHost ?? false);
  const userId = useProfileStore((s) => s.profile?.id ?? null);
  const init = useLiveHostStore((s) => s.init);

  useEffect(() => {
    if (!isHost || !userId) return;
    const writer = createHostAutoWriter({
      locks: getBrowserLockManager(),
      isVisible: () => document.visibilityState === "visible",
      verifyHost: async () => {
        const profile = useProfileStore.getState().profile;
        return hostIdentityMatches(userId, {
          authUserId: useAuthStore.getState().user?.id ?? null,
          profileId: profile?.id ?? null,
          isHost: profile?.isHost ?? false,
        });
      },
      catchUp: catchUpHostAutoProgress,
      startAutoTimer: startHostAutoProgress,
      stopAutoTimer: stopHostAutoProgress,
      waitWritesIdle: waitHostAutoWritesIdle,
      onStatus: (status) => useLiveHostStore.setState({ autoProgressStatus: status }),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    });
    return attachHostProgressSession({
      targets: { doc: document, win: window },
      writer,
      startRead: () => {
        void init();
      },
      stopAll: () => useLiveHostStore.getState().stopHostProgress(),
    });
  }, [isHost, userId, init]);

  return null;
}
