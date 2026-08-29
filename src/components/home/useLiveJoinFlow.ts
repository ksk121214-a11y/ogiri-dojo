"use client";

import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { fetchActiveLive, fetchMyParticipant } from "@/store/useLiveFollowerStore";

// ホーム画面の「次回ライブ」チケット＋「参加する」ボタンの参加フロー状態管理。
// 既存の参加登録API（useLiveFollowerStore.joinLive）は/liveページの
// 「プレイヤーとして参加する／観客として参加する」ボタンでのみ呼ばれる設計のため、
// ホーム画面のボタン自体には元々どんな通信処理も無かった。「参加成功時だけ半券を
// 切り離す」を実現するため、ここでは「参加API」として現在のログインセッションを
// サーバーに問い合わせて検証する処理（supabase.auth.getUser）を新設し、これが
// 成功した場合だけ半券のアニメーションへ進む。
//
// 状態遷移：
// idle（通常）→ checking（通信中）→ detaching（アニメーション中）→ /liveへ遷移
//                                  \→ error（失敗、idleに戻る）
// joined（既にこのライブの参加者）→ クリックで即座に/liveへ遷移（アニメーションなし）
export type LiveJoinStatus = "idle" | "checking" | "detaching" | "error" | "joined";

export function useLiveJoinFlow() {
  const [status, setStatus] = useState<LiveJoinStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // 連打防止：非同期処理の完了を待たずに二重発火しないよう、state更新より確実な
  // refで即座にガードする（setStateは次のレンダーまで反映されないため）。
  const inFlightRef = useRef(false);

  // マウント時、現在ログイン中のユーザーが既にこのライブの参加者として登録済みかを
  // 確認する。参加済みなら最初から半券を外した状態で表示し、アニメーションはしない。
  useEffect(() => {
    let cancelled = false;

    const checkJoined = async () => {
      const authUser = useAuthStore.getState().user;
      if (!authUser) return;
      const live = await fetchActiveLive();
      if (!live || cancelled) return;
      const participant = await fetchMyParticipant(live.id, authUser.id);
      if (!cancelled && participant) setStatus("joined");
    };

    // useAuthStoreの初期化（supabase.auth.getSession()の解決）はアプリ起動時の
    // 非同期処理のため、マウント直後はloading=trueでuser==nullのことが多い。
    // ここで判定をそのまま実行すると「実際はログイン済みなのに毎回未参加扱いになる」
    // 不具合になるため、ロード完了を待ってから判定する。
    if (useAuthStore.getState().loading) {
      const unsubscribe = useAuthStore.subscribe((state) => {
        if (!state.loading) {
          unsubscribe();
          checkJoined();
        }
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    checkJoined();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleJoinClick = async () => {
    if (inFlightRef.current) return; // 連打防止：通信中・アニメーション中は無視
    if (status === "joined") {
      router.push("/live");
      return;
    }

    inFlightRef.current = true;
    setStatus("checking");
    setError(null);

    // 「参加API」：ログインセッションが有効かどうかをサーバーに問い合わせて確認する。
    // getSession()はローカルに保持しているトークンを返すだけだが、getUser()は
    // 実際にSupabaseへ問い合わせて検証するため、通信の成功/失敗が意味を持つ。
    const { data, error: authError } = await supabase.auth.getUser();

    if (authError || !data.user) {
      setError("ログイン状態を確認できませんでした。もう一度お試しください");
      setStatus("idle");
      inFlightRef.current = false;
      return;
    }

    // 通信成功。ここから先は半券の切り離しアニメーションへ（見た目はNextLiveTicket側）。
    setStatus("detaching");
  };

  // アニメーション終了（またはフォールバックタイマー）で呼ばれる。
  const handleAnimationEnd = () => {
    inFlightRef.current = false;
    router.push("/live");
  };

  return { status, error, handleJoinClick, handleAnimationEnd };
}
