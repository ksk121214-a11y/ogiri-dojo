"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import DisplayNameSetupModal from "@/components/app/DisplayNameSetupModal";
import InterludeScreen from "@/components/live-demo/InterludeScreen";
import ScreenShell from "@/components/live-demo/ScreenShell";
import SoundToggle from "@/components/live-demo/SoundToggle";
import AnnouncementBanner from "@/components/live-room/AnnouncementBanner";
import AudienceAnsweringView from "@/components/live-room/AudienceAnsweringView";
import AudienceHomeButton from "@/components/live-room/AudienceHomeButton";
import AudienceEnteringScreen from "@/components/live-room/AudienceEnteringScreen";
import AudienceJoinPanel from "@/components/live-room/AudienceJoinPanel";
import AudienceJoinPrompt from "@/components/live-room/AudienceJoinPrompt";
import FinalResultView from "@/components/live-room/FinalResultView";
import FirstLiveRewardAnnouncement from "@/components/live-room/FirstLiveRewardAnnouncement";
import GroupResultView from "@/components/live-room/GroupResultView";
import LaughEffectOverlay from "@/components/live-room/LaughEffectOverlay";
import OpeningView from "@/components/live-room/OpeningView";
import StageAnsweringView from "@/components/live-room/StageAnsweringView";
import TopicRevealView from "@/components/live-room/TopicRevealView";
import { LegalConsentNote } from "@/components/legal/LegalLinks";
import { getLiveRoomTiming } from "@/data/liveRoomTiming";
import { playBgm, retryCurrentBgm, correctBgmPosition, stopBgm } from "@/lib/bgm";
import { hasSeenCurtain } from "@/lib/curtainSeen";
import { resolveLiveScreenGate } from "@/lib/liveGuestAccess";
import { useLiveAssetPreload } from "@/lib/useLiveAssetPreload";
import { createBgmSyncPlanner } from "@/lib/bgmSync";
import { phaseRemainingSeconds } from "@/lib/liveRemaining";
import { serverClock } from "@/lib/serverClockInstance";
import { useServerClockState } from "@/lib/useServerNow";
import { planAudienceJoinUi } from "@/lib/audienceJoinUiPlan";
import { pressGuestAudienceButton, resolveLiveIdWithTimeout } from "@/lib/audienceGuestButton";
import { driveAudienceJoin } from "@/lib/audienceJoinDrive";
import { useAuthStore } from "@/store/useAuthStore";
import { isAudienceIntentEntering, useAudienceJoinIntentStore } from "@/store/useAudienceJoinIntentStore";
import { useConsentGateStore } from "@/store/useConsentGateStore";
import { fetchActiveLive, useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import { useProfileStore } from "@/store/useProfileStore";

const PHASE_LABEL: Record<string, string> = {
  scheduled: "開演準備中",
  interlude: "幕間",
  opening: "開幕（参加登録受付中）",
  topic_reveal: "お題発表",
  answering: "回答受付中",
  group_result: "組結果発表",
  final_result: "最終結果発表",
  closed: "終了",
};

// 実バックエンド版ライブの参加者用ページ。
// topic_reveal/answeringフェーズは舞台・客席の没入型フルスクリーン画面(StageAnsweringView等)に
// 完全に切り替わる（/live-demoの状態遷移と同じ構成）。それ以外のフェーズは簡易な縦スクロール表示。
export default function LivePage() {
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  // 2026-09-25（利用規約同意ゲート対応）：共通の同意ゲート経由にする。
  const signInWithX = useConsentGateStore((s) => s.requestXLogin);
  const signInAsGuest = useConsentGateStore((s) => s.requestGuestStart);
  const guestSigningIn = useAuthStore((s) => s.guestSigningIn);
  const profile = useProfileStore((s) => s.profile);
  const profileLoading = useProfileStore((s) => s.loading);
  const [guestSignInError, setGuestSignInError] = useState<string | null>(null);
  const [xLoginError, setXLoginError] = useState<string | null>(null);

  const live = useLiveFollowerStore((s) => s.live);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const currentTurn = useLiveFollowerStore((s) => s.currentTurn);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const groupResult = useLiveFollowerStore((s) => s.groupResult);
  const finalResult = useLiveFollowerStore((s) => s.finalResult);
  const participantAvatars = useLiveFollowerStore((s) => s.participantAvatars);
  const liveLoading = useLiveFollowerStore((s) => s.loading);
  const syncError = useLiveFollowerStore((s) => s.syncError);
  const retrySync = useLiveFollowerStore((s) => s.retrySync);
  const followerError = useLiveFollowerStore((s) => s.error);
  const subscribe = useLiveFollowerStore((s) => s.subscribe);
  const joinLive = useLiveFollowerStore((s) => s.joinLive);

  const [joining, setJoining] = useState(false);
  const intentState = useAudienceJoinIntentStore((s) => s.state);

  // 2026-08-29:「お題発表・回答・審査で使う必須素材が、表示される瞬間に読み込み待ち
  // にならないようにする」対応。ページに滞在している間ずっと（フェーズがどう変わっても
  // アンマウントされずに）裏で進める必要があるため、フェーズごとの各Viewではなく
  // このページ自体のトップレベルで呼ぶ。
  // 2026-08-31:「準備中の進捗表示はプレイヤー画面ではなく司会コンソールに出す」
  // 要望のため、読み込み自体はここで継続しつつ、進捗の表示（OpeningViewへの受け渡し）
  // はやめた。進捗表示は/live/host（司会コンソール）側に用意している。
  useLiveAssetPreload();

  useEffect(() => {
    const unsubscribe = subscribe();
    return unsubscribe;
  }, [subscribe]);

  // BGM：待機画面開始のタイミングだけはCurtainOverlay.tsx側で「幕が開く音（琴の滑奏）」と
  // 同時に鳴らす（liveがまだ無い・interlude前は無音のまま）。ここではその後のフェーズ切り替え
  // だけを扱う（src/app/live-demo/page.tsx参照）。openingはinterludeで既に鳴り始めている
  // 待機画面BGMの続きなので明示的な指定は不要。
  // 2026-08-29: 「ライブ中のリロード後、経過時間に対応する位置からBGMを再開する」対応として、
  // サーバー基準のphase_deadline（フェーズ終了予定時刻）とフェーズの所要時間（定数）から
  // 経過時間を逆算し、playBgmのstartAtMsに渡す（曲を初めて切り替える瞬間だけ効く。
  // 同じ曲が既に鳴っている間はaudioManager側でシークしない＝再生位置は巻き戻らない）。
  const currentPhase = live?.current_phase ?? null;
  const phaseDeadline = live?.phase_deadline ?? null;
  // 3回目レビュー対応（項目2）：このライブが実際に使うtiming_profileから解決する
  // （DB側の進行RPCが参照するのと同じlives.timing_profile）。BGMの逆算開始位置
  // だけの用途とはいえ、画面表示とDB判定の時間設定を必ず揃える。
  const timingProfile = live?.timing_profile ?? null;
  // 5回目レビュー対応：BGMの逆算開始位置はサーバー同期時計だけで決める。同期前は
  // 位置を決めず待ち、3秒待っても同期できない場合だけ、誤った端末時刻から位置を作らず
  // 先頭からの暫定再生にする。その後の同期成功（revisionの変化）で、必要なら一度だけ
  // 正しい位置へ補正する（小さいずれは再スタートしない。bgmSync.ts参照）。
  const clock = useServerClockState();
  const currentTurnId = live?.current_turn_id ?? null;
  const [clockWaitGaveUp, setClockWaitGaveUp] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setClockWaitGaveUp(true), 3000);
    return () => clearTimeout(id);
  }, []);
  const bgmPlannerRef = useRef(createBgmSyncPlanner());
  const clockFresh = clock.fresh;
  const clockRevision = clock.revision;
  // 補正がnot_readyだった時の、上限付きの再試行（無限ループ・高頻度ポーリングを避ける）。
  const [bgmRetryTick, setBgmRetryTick] = useState(0);
  const bgmRetryCountRef = useRef(0);
  useEffect(() => {
    const timing = getLiveRoomTiming(timingProfile);
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const timed = (bgm: "entrance" | "live" | "waiting", durationMs: number) => {
      if (!phaseDeadline) {
        playBgm(bgm);
        return;
      }
      const nowMs = serverClock.nowIfFresh();
      const action = bgmPlannerRef.current.plan({
        key: `${currentPhase}|${currentTurnId}`,
        deadline: phaseDeadline,
        fresh: nowMs !== null,
        revision: clockRevision,
        gaveUp: clockWaitGaveUp,
        elapsedMs:
          nowMs === null ? null : Math.max(0, durationMs - (new Date(phaseDeadline).getTime() - nowMs)),
      });
      if (action.kind === "play") {
        playBgm(bgm, { startAtMs: action.startAtMs });
        bgmPlannerRef.current.ack(action);
      } else if (action.kind === "seek") {
        const result = correctBgmPosition(bgm, action.startAtMs);
        bgmPlannerRef.current.ack(action, result);
        if (result === "not_ready" && bgmRetryCountRef.current < 5) {
          bgmRetryCountRef.current += 1;
          retryTimer = setTimeout(() => setBgmRetryTick((n) => n + 1), 500);
        } else if (result !== "not_ready") {
          bgmRetryCountRef.current = 0;
        }
      }
    };

    if (currentPhase === "topic_reveal") {
      timed("entrance", timing.topicRevealMs);
    } else if (currentPhase === "answering") {
      timed("live", timing.answerMs);
    } else if (currentPhase === "group_result") {
      timed("waiting", timing.groupResultMs);
    } else if (currentPhase === "final_result") {
      playBgm("waiting");
    } else if (currentPhase === "interlude" || currentPhase === "opening") {
      // 2026-09-03:「観客としてホームに戻り、ホームからライブに戻ると、ホームのBGMが
      // そのまま流れ続ける」不具合対策。interlude/openingのBGMは元々CurtainOverlay
      // （幕が開く音と同時に鳴らす、初回だけの演出）が担っており、ここでは意図的に
      // 何もしていなかった。しかしhasSeenCurtain()はブラウザタブ内で一度でも見たら
      // trueのまま（リロードでのみリセットされる）ため、ホーム⇄ライブを行き来する
      // （リロードを伴わない）2回目以降の訪問ではCurtainOverlay自体が再表示されず、
      // BGMを差し替える機会が無いまま、直前にいたページ（ホーム）のBGMが鳴り続けて
      // いた。初回（まだ幕を見ていない）はCurtainOverlay側の演出タイミングに
      // 任せて何もしないが、2回目以降（既に見ている）はここで明示的に切り替える。
      if (hasSeenCurtain()) playBgm("waiting");
    } else if (currentPhase === "closed" || currentPhase === null) {
      // closedはもちろん、購読が切れてliveそのものが取得できなくなった場合も
      // 「絶対に音が止まる」ことを優先し、念のため止めておく。
      stopBgm();
    }
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [currentPhase, phaseDeadline, currentTurnId, timingProfile, clockFresh, clockRevision, clockWaitGaveUp, bgmRetryTick]);

  // ページ離脱時（ホームに戻る・他ページへ遷移等）は必ずBGMを止める。
  // closedフェーズに到達しないままアンマウントされるケースの保険（「終了しても音が鳴り続ける」対策）。
  useEffect(() => {
    return () => {
      stopBgm();
    };
  }, []);

  // ブラウザの自動再生制限で途中参加時にBGMが鳴らないことがあるため、
  // ページ内の最初のクリック/タップで一度だけ再生を試みる。
  useEffect(() => {
    const retry = () => retryCurrentBgm();
    document.addEventListener("pointerdown", retry, { once: true });
    return () => document.removeEventListener("pointerdown", retry);
  }, []);

  // 観客参加の意図（「ログインせず観客として見る」を押した）を、条件が揃った時に1回だけ実行する。
  // /liveを開いただけ・Xログイン・キャンセル・認証失敗では意図が成立しないため実行されない。
  // 状態遷移はsrc/lib/audienceJoinIntent.ts（joinと判定した時点でjoiningへ遷移＝1回だけ）。
  const authUserId = authUser?.id ?? null;
  const authIsAnonymous = authUser?.is_anonymous === true;
  const liveId = live?.id ?? null;
  const livePhase = live?.current_phase ?? null;
  const hasParticipant = !!myParticipant;
  const kicked = !!myParticipant?.kicked_at;
  useEffect(() => {
    const store = useAudienceJoinIntentStore.getState();
    void driveAudienceJoin(
      {
        authUserId,
        authIsAnonymous,
        liveLoading,
        live: liveId && livePhase ? { id: liveId, phase: livePhase } : null,
        alreadyParticipant: hasParticipant,
        kicked,
      },
      {
        evaluate: store.evaluate,
        finishJoin: store.finishJoin,
        joinAudience: () => useLiveFollowerStore.getState().joinLive("audience"),
      },
    );
  }, [authUserId, authIsAnonymous, liveLoading, liveId, livePhase, hasParticipant, kicked, intentState]);

  // 「ページを離れたら古い意図を破棄する」処理は、ConsentRequiredGateが同意確認中にこの
  // ページ自体を一時的にアンマウントするため、ここ（このコンポーネントのアンマウント時）では
  // 行わない。実際のページ離脱検知はAudienceJoinIntentPathGuard（layout.tsx、常時マウント）
  // 側でpathnameの変化を見て行う。
  const audienceEntering = isAudienceIntentEntering(intentState) && !myParticipant;

  const remaining = live ? phaseRemainingSeconds(live, clock) : { sec: null, syncing: false };
  const remainingSec = remaining.sec;

  // 2026-09-13（0070ゲスト参加レビュー対応、再々レビュー2回目で本番ライブ限定の
  // ブロック分岐は廃止）：authLoading/未ログイン/profile取得中/ライブ取得中の
  // どれに該当するかを
  // 純粋関数（テスト済み、src/lib/liveGuestAccess.ts）にまとめて判定する。ゲストは
  // 本番・テストどちらのライブも観客として視聴できる最終仕様になったため、
  // 「認証済みゲストが本番ライブを開いた場合だけ特別扱いする」分岐は無くなった。
  const screenGate = resolveLiveScreenGate({
    authLoading,
    isAuthenticated: !!authUser,
    profileLoading,
    liveLoading,
  });

  if (screenGate === "auth-loading" || screenGate === "profile-loading") {
    return <CenterMessage>読み込み中…</CenterMessage>;
  }

  if (screenGate === "not-authenticated") {
    // 2026-09-13（ゲスト観客対応の最終仕様確定）：本番・テストのどちらのライブでも、
    // Xログインせず観客として視聴できるボタンを併せて表示する（以前はテストライブ
    // 限定だった）。内部的にはsignInAsGuest()がSupabaseの匿名認証
    // （signInAnonymously）を行うだけで、参加登録自体はこのページの他の画面
    // （観客として参加する等のボタン）からjoin_live(..., 'audience', ...)を
    // 呼ぶ既存の経路にそのまま合流する（ゲストはaudience以外を選べない）。
    return (
      <CenterMessage>
        <p className="mb-4">プレイヤーとして参加するにはXログインが必要です。</p>
        <button
          type="button"
          onClick={async () => {
            setXLoginError(null);
            const result = await signInWithX();
            if (!result.ok && result.reason) setXLoginError(result.reason);
          }}
          className="rounded-full bg-white px-5 py-2.5 font-sans text-sm font-bold text-gray-900"
        >
          Xでログイン
        </button>
        {xLoginError && <p className="mt-2 font-sans text-xs text-dojo-deep-crimson">{xLoginError}</p>}
        {/* 2026-09-27（初期ライブ限定特典）：公式の本番ライブ（開催番号#0001〜#0005）のときだけ、
            案内を表示する。ゲスト観戦自体は妨げず、対象外であることだけを伝える
            （supabase/migrations/0081・0084参照）。テストライブ・#0006以降・緊急中止のライブでは出さない。
            文言・表示条件はOpeningView（Xログイン済みの参加受付画面）と共通化する。 */}
        <FirstLiveRewardAnnouncement
          liveMode={live?.live_mode}
          officialSequenceNumber={live?.official_sequence_number}
          emergencyClosed={live?.emergency_closed}
          className="mt-4 font-sans text-xs text-[#ffcf4a]"
        />
        <p className="mt-4 mb-2 font-sans text-xs text-white/70">
          ゲストは観客としてライブを視聴できます。回答・採点・ポイント記録はできません。
          爆笑・ツッコミ・拍手は利用できます。
        </p>
        <button
          type="button"
          disabled={guestSigningIn || intentState.status === "starting"}
          onClick={async () => {
            setGuestSignInError(null);
            // 明確な観客参加の操作：意図を開始し、同意/匿名認証が成功した時だけ観客登録へ進む。
            const store = useAudienceJoinIntentStore.getState();
            const pressed = await pressGuestAudienceButton({
              begin: store.begin,
              bindLive: store.bindLive,
              // 通信が遅くても同意・認証を待たせない（3秒で諦めたら自動参加意図だけ成立させない）。
              isCurrent: store.isCurrent,
              resolveLiveId: () =>
                resolveLiveIdWithTimeout(async () => (await fetchActiveLive())?.id ?? null, 3_000),
              settle: store.settle,
              requestGuestStart: signInAsGuest,
            });
            if (pressed.pressed && !pressed.result.ok) setGuestSignInError(pressed.result.reason ?? null);
          }}
          className="rounded-full border border-white/40 px-5 py-2.5 font-sans text-sm font-bold text-white/85 transition hover:bg-white/10 disabled:opacity-50"
        >
          {guestSigningIn || intentState.status === "starting" ? "準備中…" : "ログインせず観客として見る"}
        </button>
        {guestSignInError && (
          <p className="mt-2 font-sans text-xs text-dojo-deep-crimson">{guestSignInError}</p>
        )}
        {/* Xログイン・ゲスト観戦、両方のボタンの近くに表示する同意文言。既存の
            ログイン/ゲスト参加処理（signInWithX/signInAsGuest）自体は変更しない。 */}
        <LegalConsentNote className="mt-4 font-sans text-[11px] text-white/60" />
      </CenterMessage>
    );
  }

  // 2026-09-03:「回答者としてリロードすると観客画面になる」不具合の根本対策。
  // live/participants/myParticipant/currentTurn/currentTopicの取得が一度も
  // 揃って成功していない(liveLoading===true)間は、以降のisMyGroupOnStage・
  // showImmersiveの判定を一切行わない。以前はここを素通りしてしまい、
  // まだcurrentTurnが届いていない一瞬に「自分の組の出番ではない」と誤判定して
  // 観客画面になっていた（取得エラーで再試行中の場合も同様に、判定材料が
  // 揃うまでは絶対に舞台/観客を決めない）。
  if (screenGate === "live-loading") {
    return (
      <CenterMessage>
        <p>{syncError ? "ライブ状態の取得に失敗しました" : "ライブ入場中…"}</p>
        {syncError && (
          <>
            <p className="mt-2 max-w-xs font-sans text-xs text-white/70">
              {syncError}。自動的に再試行しています。
            </p>
            <button
              type="button"
              onClick={() => retrySync()}
              className="mt-4 rounded-full border border-white/40 px-5 py-2.5 font-sans text-sm font-bold text-white/85 transition hover:bg-white/10"
            >
              今すぐ再試行
            </button>
          </>
        )}
      </CenterMessage>
    );
  }

  // 2026-08-30: 司会コンソールから退場させられた参加者は、以降の画面遷移・回答操作を
  // すべてブロックする（immersive/通常表示どちらに入る前に、ここで確実に止める）。
  if (myParticipant?.kicked_at) {
    return (
      <CenterMessage>
        <p className="mb-2 font-sans text-base font-bold text-white">
          運営により退場となりました
        </p>
        <p className="mb-4 font-sans text-xs text-white/70">
          このライブへの参加はできません。
        </p>
        <Link
          href="/"
          className="rounded-full bg-dojo-curtain-red px-5 py-2.5 font-sans text-sm font-bold text-dojo-on-dark transition hover:bg-dojo-deep-crimson"
        >
          ホームに戻る
        </Link>
      </CenterMessage>
    );
  }

  const isMyGroupOnStage =
    !!myParticipant && !!currentTurn && myParticipant.group_id === currentTurn.group_id;

  // 2026-09-03: 以前はtopic_reveal/answering中に「まだ参加登録していない人
  // （観客として途中参加しようとしている人）」と、group_result/final_result
  // フェーズ全体（参加者・観客問わず）が、この没入デザインに入れず、下の
  // 旧デザインのフォールバック画面に
  // 流れてしまっていた。実況で「途中で観客として入ってくる画面が旧デザインの
  // ままだった」と発覚した不具合。進行中の全フェーズ（interlude〜final_result）を
  // 没入デザインの対象にし、フォールバック画面は「ライブ開始前(scheduled)」
  // 「終了後(closed)」「ライブ自体が無い」場合専用にする。
  const showImmersive =
    !!live &&
    (live.current_phase === "interlude" ||
      live.current_phase === "opening" ||
      live.current_phase === "topic_reveal" ||
      live.current_phase === "answering" ||
      live.current_phase === "group_result" ||
      live.current_phase === "final_result");

  if (showImmersive && live) {
    // 没入画面に入ってからも観客はいつでも出入りできる方針を維持する。opening
    // フェーズはOpeningView自体に参加登録UIがあるため二重に出さない
    // （interludeはまだ参加受付が始まっていないので出さない）。
    const joinUi = planAudienceJoinUi({
      phase: live.current_phase,
      hasParticipant: !!myParticipant,
      entering: audienceEntering,
    });
    const showJoinPanel = joinUi.panel;
    return (
      // 2026-08-31: position:fixed化 + JSでのvisualViewport高さ反映を試したが、
      // viewportのinteractive-widget=resizes-content指定と競合し、実機でキーボード
      // 表示時に画面が上方向へ大きくずれる不具合が出たため撤回した。
      // resizes-contentを指定した時点でh-dvh自体がキーボードに合わせて
      // ブラウザネイティブに縮むため、追加のJS補正はしない。
      <main className="relative h-dvh w-full overflow-hidden bg-dojo-stage-dark">
        <DisplayNameSetupModal />
        <AnnouncementBanner />
        <AudienceHomeButton />
        <AnimatePresence mode="wait">
          {live.current_phase === "interlude" ? (
            <InterludeScreen key="interlude" />
          ) : live.current_phase === "opening" ? (
            joinUi.view === "entering" ? <AudienceEnteringScreen key="entering" /> : <OpeningView key="opening" />
          ) : live.current_phase === "topic_reveal" ? (
            joinUi.view === "join-prompt" ? <AudienceJoinPrompt key="join-prompt-reveal" /> : <TopicRevealView key="topic_reveal" />
          ) : live.current_phase === "answering" ? (
            isMyGroupOnStage ? (
              <StageAnsweringView key="stage" />
            ) : myParticipant ? (
              <AudienceAnsweringView key="audience" />
            ) : joinUi.view === "entering" ? (
              <AudienceEnteringScreen key="entering" />
            ) : (
              <AudienceJoinPrompt key="join-prompt" />
            )
          ) : live.current_phase === "group_result" ? (
            <ScreenShell key="group-result">
              {groupResult ? (
                <GroupResultView
                  data={groupResult}
                  myParticipantId={myParticipant?.id ?? null}
                  participantAvatars={participantAvatars}
                />
              ) : (
                <p className="font-sans text-sm text-white/70">結果を集計中…</p>
              )}
              {showJoinPanel && <div className="mt-6 flex w-full justify-center"><AudienceJoinPanel /></div>}
            </ScreenShell>
          ) : live.current_phase === "final_result" ? (
            <ScreenShell key="final-result">
              {finalResult ? (
                <FinalResultView
                  data={finalResult}
                  myParticipantId={myParticipant?.id ?? null}
                  participantAvatars={participantAvatars}
                  liveMode={live.live_mode}
                  liveId={live.id}
                  officialSequenceNumber={live.official_sequence_number}
                  emergencyClosed={live.emergency_closed}
                />
              ) : (
                <p className="font-sans text-sm text-white/70">結果を集計中…</p>
              )}
              {showJoinPanel && <div className="mt-6 flex w-full justify-center"><AudienceJoinPanel /></div>}
            </ScreenShell>
          ) : null}
        </AnimatePresence>
        <LaughEffectOverlay />
        <SoundToggle />
      </main>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-svh w-full max-w-lg flex-col items-center gap-4 px-4 py-8 text-center">
      <DisplayNameSetupModal />
      <AnnouncementBanner />
      <AudienceHomeButton />
      <SoundToggle />
      <p className="font-sans text-xs tracking-widest text-white/85">
        爆笑スタジアムライブ
      </p>
      <h1 className="font-sans font-bold text-2xl text-white/85">
        {profile?.displayName ?? "..."}
      </h1>

      {/* liveLoadingはこの時点で必ずfalse（上のガードで既に抜けている）。 */}
      {!live ? (
        <>
          <p className="font-sans text-sm text-white/85">
            まだライブは開演していません。司会の開始をお待ちください。
          </p>
          <Link
            href="/"
            className="rounded-full border border-white/40 px-5 py-2.5 font-sans text-sm font-bold text-white/85 transition hover:bg-white/10"
          >
            ホームに戻る
          </Link>
        </>
      ) : live.current_phase === "scheduled" ? (
        // 運営者専用管理画面の追加（第1段階）：運営者が準備中（=まだ「参加受付を
        // 開始する」を押していない）の間は、参加登録受付(opening)より前の
        // 状態として、既存の「!live」ケースと同じ体裁で案内する。
        <>
          <p className="font-sans text-sm text-white/85">
            {live.title ? `「${live.title}」は` : "次回のライブは"}
            ただいま準備中です。参加受付が始まるまでお待ちください。
          </p>
          <Link
            href="/"
            className="rounded-full border border-white/40 px-5 py-2.5 font-sans text-sm font-bold text-white/85 transition hover:bg-white/10"
          >
            ホームに戻る
          </Link>
        </>
      ) : live.current_phase === "closed" ? (
        <>
          <p className="font-sans text-sm text-white/85">
            本日のライブは終了しました。お疲れさまでした！
          </p>
          <Link
            href="/"
            className="rounded-full bg-dojo-curtain-red px-5 py-2.5 font-sans text-sm font-bold text-dojo-on-dark transition hover:bg-dojo-deep-crimson"
          >
            ホームに戻る
          </Link>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-1">
            <p className="font-sans font-bold text-xl text-dojo-curtain-red">
              {PHASE_LABEL[live.current_phase] ?? live.current_phase}
            </p>
            {(remainingSec !== null || remaining.syncing) && (
              <p className="font-sans text-sm tabular-nums text-white/85">
                {remaining.syncing ? "時刻を同期中…" : `残り${remainingSec}秒`}
                {live.answering_paused && "（審査中は一時停止）"}
              </p>
            )}
          </div>

          {/* 2026-08-30: このビューに来る時点でcurrent_phaseは既にtopic_reveal以降
              （ゲーム開始後）のため、プレイヤーとしての新規参加登録ボタンは置かない
              （interlude/openingでのプレイヤー参加受付はOpeningView.tsx側）。
              観客としてはゲーム進行中いつでも出入りできる。 */}
          {!myParticipant && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={joining}
                onClick={async () => {
                  setJoining(true);
                  try {
                    await joinLive("audience");
                  } finally {
                    setJoining(false);
                  }
                }}
                className="rounded-full border border-white/40 px-5 py-3 font-sans text-sm font-bold text-white/85 disabled:opacity-50"
              >
                {joining ? "参加処理中…" : "観客として参加する"}
              </button>
            </div>
          )}
          {!myParticipant && followerError && (
            <p className="font-sans text-xs text-dojo-deep-crimson">{followerError}</p>
          )}

          {myParticipant && (
            <p className="font-sans text-xs text-white/85">
              {myParticipant.group_id
                ? `組分け済み・${myParticipant.role === "player" ? "演者" : "見学"}`
                : `組分け待ち・${myParticipant.preferred_role === "player" ? "演者希望" : "見学希望"}`}
            </p>
          )}

          {/* デバッグ表示：自分の組と現在の出番の組が一致しているかその場で確認できるように。
              2026-09-02: 本番のユーザー向け画面に開発用の内部状態がそのまま出てしまって
              いたため、開発環境でのみ表示するようにした（初回ライブ実開催前レビュー対応）。 */}
          {process.env.NODE_ENV !== "production" && (
            <p className="font-sans text-[10px] text-dojo-gray-purple">
              debug: myGroup={myParticipant?.group_id?.slice(0, 8) ?? "-"} /
              turnGroup={currentTurn?.group_id?.slice(0, 8) ?? "-"} / turnStatus=
              {currentTurn?.status ?? "-"} / onStage={String(isMyGroupOnStage)}
            </p>
          )}

          {currentTopic &&
            live.current_phase !== "group_result" &&
            live.current_phase !== "final_result" && (
              <div className="w-full rounded-2xl border border-dojo-curtain-gold/40 bg-white/10 p-4">
                <p className="font-sans text-xs text-white/85">お題</p>
                <p className="mt-1 font-sans text-base font-bold text-white">
                  {currentTopic.body}
                </p>
              </div>
            )}

          {live.current_phase === "group_result" && groupResult && (
            <GroupResultView
              data={groupResult}
              myParticipantId={myParticipant?.id ?? null}
              participantAvatars={participantAvatars}
            />
          )}

          {live.current_phase === "final_result" && finalResult && (
            <FinalResultView
              data={finalResult}
              myParticipantId={myParticipant?.id ?? null}
              participantAvatars={participantAvatars}
              liveMode={live.live_mode}
              liveId={live.id}
              officialSequenceNumber={live.official_sequence_number}
              emergencyClosed={live.emergency_closed}
            />
          )}

          {followerError && (
            <p className="font-sans text-xs text-dojo-deep-crimson">{followerError}</p>
          )}
        </>
      )}
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center px-4 text-center font-sans text-sm text-white/85">
      {children}
    </div>
  );
}
