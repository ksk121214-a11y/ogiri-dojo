"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useRouter } from "next/navigation";

import { clearLiveEntry, getLiveEntry, hasEnteredLive, setLiveEntry } from "@/lib/liveEntryStorage";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { fetchActiveLive, fetchMyParticipant } from "@/store/useLiveFollowerStore";

// ホーム画面の「次回ライブ」チケット＋「参加する」ボタンの入場フロー状態管理。
//
// 「入場」と「参加登録（joinLive）」は別の概念として扱う：
// - 入場＝ホーム画面で赤い半券を切って待機画面（/live）へ進んだという事実。
//   実際のプレイヤー/観客登録（useLiveFollowerStore.joinLive、participantsテーブルへの
//   insert）は、/live側で役割を選んだ時に初めて行われる。ホーム画面からjoinLiveは
//   呼ばない（joinLiveは既存どおり/live側の役割選択でのみ呼ばれる）。
// - 半券が切れた状態（＝入場済み状態）は、まだ役割未選択のままホームに戻っても、
//   司会者がライブを完全に終了する（current_phase: "closed"）までは維持し続ける。
//   participants行の有無だけでは「役割未選択のまま入場済み」を判定できないため、
//   src/lib/liveEntryStorage.tsのlocalStorageで別途保持する。
//
// 状態遷移：
// idle（未入場）→ checking（通信中、成功後に1秒の間を置く）
//              → detaching（半券アニメーション中）→ /liveへ遷移
//              \→ error（失敗、idleに戻る）
// joined（入場済み＝participants行がある、またはlocalStorageに入場済み記録がある）
//   → クリックで即座に/liveへ遷移（半券アニメーションもSEも無し）
//
// 司会者がライブを完全終了した（lives.current_phase: "closed"）ことは、
// fetchActiveLive()が`current_phase !== "closed"`のライブだけを返す既存の
// 絞り込みを利用して検知する：入場済みだったライブがfetchActiveLive()の結果から
// 消えた（＝別のライブに切り替わった、またはnullになった）時点で、その入場済み
// 状態を破棄する。「結果発表中(final_result)」の間はまだcurrent_phaseがclosedに
// なっていないため、fetchActiveLive()は引き続きそのライブを返し続け、
// 半券は切れたままになる（要件どおり、結果発表とcloseは区別される）。
// 2026-08-30:「preparing」は運営者専用管理画面の追加（第1段階）で増えた状態。
// current_phase==='scheduled'（運営者がまだ「参加受付を開始する」を押していない）
// の間はボタンを押させない。
export type LiveJoinStatus = "idle" | "checking" | "detaching" | "error" | "joined" | "preparing";

// useSyncExternalStoreのsubscribe引数：liveEntryStorageは変更を通知する仕組みを
// 持たない単純なlocalStorageラッパーのため、購読すべきイベントが無い（値が変わる
// のはこのフック自身のsetLiveEntry/clearLiveEntry呼び出しの直後だけで、その都度
// 別途setStatusによる再レンダーが起きるため、それ以外の変化を監視する必要が無い）。
function subscribeNothing() {
  return () => {};
}
function getHasStoredEntrySnapshot(): boolean {
  return !!getLiveEntry()?.entered;
}
function getHasStoredEntryServerSnapshot(): boolean {
  return false; // サーバーにはlocalStorageが無いため、SSR時は常に「未入場」扱い。
}

export function useLiveJoinFlow() {
  const [status, setStatus] = useState<LiveJoinStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // 連打防止：非同期処理の完了を待たずに二重発火しないよう、state更新より確実な
  // refで即座にガードする（setStateは次のレンダーまで反映されないため）。
  const inFlightRef = useRef(false);

  // 2026-08-29:「マイページ・次回ライブ・遊び方からホームに戻ると、半券が一瞬戻って
  // 一瞬で消える」ちらつき対策。statusのuseState初期化子でlocalStorageを見てしまうと
  // SSR結果（サーバーにはlocalStorageが無いので必ず"idle"）とクライアントの初回
  // レンダリングが食い違い、hydration mismatchになる。かといってuseEffect/
  // useLayoutEffect内でsetStateして後から補正する形も、cascading renderを避ける
  // という理由でReactの新しいガイドライン上避けるべきとされている。
  // useSyncExternalStoreは「サーバーとクライアントで値が異なってもmismatchに
  // ならず、ハイドレーション直後（ペイント前）に同期的にクライアント値へ更新される」
  // 仕組みをReactが正式に提供しているため、まさにこのケース向けに使う。
  const hasStoredEntry = useSyncExternalStore(
    subscribeNothing,
    getHasStoredEntrySnapshot,
    getHasStoredEntryServerSnapshot,
  );
  // 実際にUI側へ渡す実効ステータス：まだevaluate()の判定が済んでいない("idle"の
  // まま)間だけ、localStorageの記録で楽観的に補完する。evaluate()がidle/joinedの
  // どちらかに確定した後は、そちらを優先する（hasStoredEntryが古いままでも
  // 上書きされない）。
  const effectiveStatus: LiveJoinStatus = status === "idle" && hasStoredEntry ? "joined" : status;

  // 評価処理が進行中（通信中・アニメーション中）は、Realtime等からの再評価で
  // 状態を上書きしない（進行中のアニメーションを壊さないため）ためのガード。
  const statusRef = useRef<LiveJoinStatus>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  // TypeScriptの制御フロー解析はrefへの再代入をまたいだ型の絞り込みを追跡できず、
  // 早期returnの直後に同じ比較をすると「型的に有り得ない」という誤検知になるため、
  // 関数呼び出しの形にして毎回素直に再評価させる。
  const isBusy = () => statusRef.current === "checking" || statusRef.current === "detaching";

  const evaluate = useCallback(async () => {
    if (isBusy()) return;

    const authUser = useAuthStore.getState().user;
    const live = await fetchActiveLive();

    if (!live) {
      // アクティブなライブが無い＝前のライブが司会者により完全終了した、または
      // まだ次のライブが案内されていない。いずれにせよ入場済み状態は無効。
      clearLiveEntry();
      if (!isBusy()) setStatus("idle");
      return;
    }

    // 2026-08-30: 「準備中（受付前）でも入場はできるようにして」の要望により、
    // current_phase==='scheduled'（運営者がまだ「参加受付を開始する」を押していない
    // 準備中の状態）でも参加ボタンを押して/liveへ入場できるようにした（以前は
    // ボタンを押せなくしていたが、その制限を撤廃した）。実際の参加登録
    // （プレイヤー/観客選択）は従来どおりopeningフェーズになってから行う。

    if (!authUser) {
      setStatus("idle");
      return;
    }

    // 既にプレイヤー/観客として登録済み（participants行がある）なら入場済み扱い。
    const participant = await fetchMyParticipant(live.id, authUser.id);
    if (isBusy()) return; // 追い越されたら破棄

    if (participant) {
      setStatus("joined");
      return;
    }

    // まだ役割未選択でも、ホーム画面で一度入場済み（半券を切った）記録があれば
    // 入場済み扱いにする。ライブが切り替わっていれば（liveId不一致）自動的にfalseになる。
    if (hasEnteredLive(authUser.id, live.id)) {
      setStatus("joined");
      return;
    }

    // 未入場、またはライブが切り替わって古い入場済み状態が無効になったケース。
    clearLiveEntry();
    setStatus("idle");
  }, []);

  // 2026-08-29:「ライブ画面のルートと必要なJSも待機画面からprefetchする」対応。
  // JoinLiveButtonは（半券アニメーションを挟むため）<Link>ではなく<button>+
  // router.pushにしているため、Next.jsの<Link>が持つ自動prefetchの恩恵を受けられない。
  // ホーム画面に来た時点で明示的にprefetchしておくことで、「参加する」を押した時点では
  // 既に/liveのJSチャンクが取得済みになり、遷移直後の白画面・読み込み待ちを減らす。
  useEffect(() => {
    router.prefetch("/live");
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const safeEvaluate = () => {
      if (!cancelled) evaluate();
    };

    // useAuthStoreの初期化（supabase.auth.getSession()の解決）はアプリ起動時の
    // 非同期処理のため、マウント直後はloading=trueでuser==nullのことが多い。
    // ロード完了を待ってから最初の評価を行う。
    let cleanupAuth: (() => void) | undefined;
    if (useAuthStore.getState().loading) {
      const unsubscribeAuth = useAuthStore.subscribe((state) => {
        if (!state.loading) {
          unsubscribeAuth();
          safeEvaluate();
        }
      });
      cleanupAuth = unsubscribeAuth;
    } else {
      safeEvaluate();
    }

    // 2026-08-29:「ホームに戻ってからブラウザが重くなる」不具合の対応。
    // 当初はRealtime（lives全体のpostgres_changes）でその場検知していたが、
    // ライブ進行中はフェーズ遷移・持ち時間の一時停止解除等でlivesテーブルが
    // 数秒おきに更新され続けるため、ホーム画面にいる間もそのたびにevaluate()
    // （fetchActiveLive＋fetchMyParticipantの2クエリ）が走り続け、実機で
    // 明確な負荷増を確認した。ホーム画面での「司会者の完全終了」検知は
    // 数十秒程度の遅延が許容できる（要件でもポーリング・画面フォーカス時の
    // 再取得が明示的に許容されている）ため、Realtime購読はやめて、緩やかな
    // ポーリング＋画面フォーカス復帰・オンライン復帰時の再評価に一本化した。
    const pollTimer = setInterval(safeEvaluate, 30_000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") safeEvaluate();
    };
    const handleOnline = () => safeEvaluate();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      cleanupAuth?.();
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
    };
  }, [evaluate]);

  const handleJoinClick = async () => {
    if (inFlightRef.current) return; // 連打防止：通信中・アニメーション中・再入場中は無視
    // 準備中はJoinLiveButton側でボタンをdisabledにしているが、念のため二重に防ぐ。
    if (effectiveStatus === "preparing") return;
    inFlightRef.current = true;

    if (effectiveStatus === "joined") {
      // 再入場：半券アニメーション・SEは再生せず、既存の待機画面へ直接戻る。
      router.push("/live");
      inFlightRef.current = false;
      return;
    }

    setStatus("checking");
    setError(null);

    // 1. ログイン状態を確認する。getSession()はローカルに保持しているトークンを
    //    返すだけだが、getUser()は実際にSupabaseへ問い合わせて検証するため、
    //    通信の成功/失敗が意味を持つ。
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) {
      setError("ログイン状態を確認できませんでした。もう一度お試しください");
      setStatus("idle");
      inFlightRef.current = false;
      return;
    }

    // 2. 対象となる現在のライブ情報を確認する。
    const live = await fetchActiveLive();
    if (!live) {
      setError("現在案内できるライブがありません。もう一度お試しください");
      setStatus("idle");
      inFlightRef.current = false;
      return;
    }

    // 3. 確認に成功：入場済み状態を保存（画面遷移より前に完了させる）。
    setLiveEntry(data.user.id, live.id);

    // 「参加する」を押してすぐ切り取られるのではなく、1秒の間を置いてから
    // 半券アニメーションへ進む（切符を受け取って一拍置いてから切る、という間）。
    // SEはここでは鳴らさない：半券が斜めに裂け始める最初のタイミング（isDetaching＝
    // trueになった瞬間）に合わせて鳴らす一元的な処理をNextLiveTicket.tsx側に
    // 持たせているため、ここで重複して鳴らさない。
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setStatus("detaching");
  };

  // アニメーション終了（またはフォールバックタイマー）で呼ばれる。
  const handleAnimationEnd = () => {
    inFlightRef.current = false;
    router.push("/live");
  };

  return { status: effectiveStatus, error, handleJoinClick, handleAnimationEnd };
}
