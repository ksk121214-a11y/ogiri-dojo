"use client";

import { useEffect } from "react";

import { useLiveHostStore } from "@/store/useLiveHostStore";
import { useProfileStore } from "@/store/useProfileStore";

// 管理者(isHost)がアプリ内のどの画面にいても、ライブ進行
// （useLiveHostStore.init()が動かすsetInterval(advanceIfDue, 500)とRealtime購読）を
// 止めない・失っても復元できるようにするための常駐コントローラー。RootLayoutに置く。
//
// 【背景】以前はuseLiveHostStore.init()の呼び出しが/live/hostページ自身の
// useEffectだけに依存していた。同じ管理者が/admin/*等の別の管理画面へ移動したり、
// 別タブ・別ウィンドウで管理画面を開き直したりした際に進行が止まって見える
// ケースがあった（回答reveal・採点確定・フェーズ遷移が0秒のまま進まなくなる）。
//
// このコンポーネントをRootLayoutに常駐させ、isHostである間は表示中のページに
// 関係なく常にinit()を呼んでおくことで、「今どの画面が開かれているか」に
// ライブ進行処理が依存しないようにする。init()自体は冪等
// （呼ぶたびに既存のtickTimer/Realtime channelを一度破棄してから作り直すため、
// 二重に増殖しない。加えて短時間の重複呼び出しは同じPromiseに合流する。
// 詳細はuseLiveHostStore.tsのinitInFlight参照）ため、/live/hostページ自身が
// 引き続き呼んでいるinit()と衝突しない。
//
// 【視認できる形での期限超過リカバリ】タブがバックグラウンドから復帰した瞬間
// (visibilitychange)・ウィンドウにフォーカスが戻った瞬間(focus)・ブラウザの
// 進む/戻るでbfcacheから復元された瞬間(pageshow)・オンライン復帰時(online)に、
// 改めてinit()を呼び直す。ブラウザのタイマー抑制（バックグラウンドタブで
// setIntervalが間引かれる）や一時的な切断で取りこぼした進行を、DBの最新状態
// （phase_deadline等）から取り戻す（次のsetIntervalのtick、最大500ms後を
// 待たずに済む）。
//
// 【複数タブ対策】このコントローラー自体は「進行処理を動かすタブを増やす」側の
// 仕組みであり、複数の管理画面タブが同時に同じDB更新を試みても実害が出ないよう、
// useLiveHostStore.ts側の各更新（回答reveal・採点確定・フェーズ遷移）に
// 「今の状態と一致する行だけを更新する」ガードを入れてある（詳細は
// useLiveHostStore.tsのupdateLiveIfPhase・processRevealQueue・resolveIfDue参照）。
//
// 【残る制約】ブラウザタブを完全に閉じる・PCがスリープする等、JSの実行自体が
// 止まるケースまではカバーできない（サーバー側の完全自動進行ではないため）。
// 管理画面側（AdminShell）に注意文言を表示している。
export default function HostProgressController() {
  const isHost = useProfileStore((s) => s.profile?.isHost ?? false);
  const init = useLiveHostStore((s) => s.init);

  useEffect(() => {
    if (!isHost) return;
    init();

    const resume = () => {
      if (document.visibilityState !== "visible") return;
      init();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
    };
  }, [isHost, init]);

  return null;
}
