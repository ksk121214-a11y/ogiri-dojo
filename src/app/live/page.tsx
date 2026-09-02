"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

import DisplayNameSetupModal from "@/components/app/DisplayNameSetupModal";
import InterludeScreen from "@/components/live-demo/InterludeScreen";
import ScreenShell from "@/components/live-demo/ScreenShell";
import SoundToggle from "@/components/live-demo/SoundToggle";
import AnnouncementBanner from "@/components/live-room/AnnouncementBanner";
import AudienceAnsweringView from "@/components/live-room/AudienceAnsweringView";
import AudienceHomeButton from "@/components/live-room/AudienceHomeButton";
import AudienceJoinButton from "@/components/live-room/AudienceJoinButton";
import AudienceJoinPrompt from "@/components/live-room/AudienceJoinPrompt";
import FinalResultView from "@/components/live-room/FinalResultView";
import GroupResultView from "@/components/live-room/GroupResultView";
import LaughEffectOverlay from "@/components/live-room/LaughEffectOverlay";
import OpeningView from "@/components/live-room/OpeningView";
import StageAnsweringView from "@/components/live-room/StageAnsweringView";
import TopicRevealView from "@/components/live-room/TopicRevealView";
import { LIVE_ROOM_TIMING } from "@/data/liveRoomTiming";
import { playBgm, retryCurrentBgm, stopBgm } from "@/lib/bgm";
import { useLiveAssetPreload } from "@/lib/useLiveAssetPreload";
import { useTickingNow } from "@/lib/useTickingNow";
import { useAuthStore } from "@/store/useAuthStore";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";
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
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const profile = useProfileStore((s) => s.profile);

  const live = useLiveFollowerStore((s) => s.live);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const currentTurn = useLiveFollowerStore((s) => s.currentTurn);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const groupResult = useLiveFollowerStore((s) => s.groupResult);
  const finalResult = useLiveFollowerStore((s) => s.finalResult);
  const participantAvatars = useLiveFollowerStore((s) => s.participantAvatars);
  const liveLoading = useLiveFollowerStore((s) => s.loading);
  const followerError = useLiveFollowerStore((s) => s.error);
  const subscribe = useLiveFollowerStore((s) => s.subscribe);
  const joinLive = useLiveFollowerStore((s) => s.joinLive);

  const now = useTickingNow();
  const [joining, setJoining] = useState(false);

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
  useEffect(() => {
    const elapsedMsOf = (durationMs: number): number => {
      if (!phaseDeadline) return 0;
      const remainingMs = new Date(phaseDeadline).getTime() - Date.now();
      return Math.max(0, durationMs - remainingMs);
    };

    if (currentPhase === "topic_reveal") {
      playBgm("entrance", { startAtMs: elapsedMsOf(LIVE_ROOM_TIMING.topicRevealMs) });
    } else if (currentPhase === "answering") {
      playBgm("live", { startAtMs: elapsedMsOf(LIVE_ROOM_TIMING.answerMs) });
    } else if (currentPhase === "group_result") {
      playBgm("waiting", { startAtMs: elapsedMsOf(LIVE_ROOM_TIMING.groupResultMs) });
    } else if (currentPhase === "final_result") {
      playBgm("waiting");
    } else if (currentPhase === "closed" || currentPhase === null) {
      // closedはもちろん、購読が切れてliveそのものが取得できなくなった場合も
      // 「絶対に音が止まる」ことを優先し、念のため止めておく。
      stopBgm();
    }
  }, [currentPhase, phaseDeadline]);

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

  const remainingSec =
    live?.answering_paused && live.answering_remaining_ms != null
      ? Math.ceil(live.answering_remaining_ms / 1000)
      : live?.phase_deadline
        ? Math.max(0, Math.ceil((new Date(live.phase_deadline).getTime() - now) / 1000))
        : null;

  if (authLoading) return <CenterMessage>読み込み中…</CenterMessage>;

  if (!authUser) {
    return (
      <CenterMessage>
        <p className="mb-4">参加するにはXログインが必要です。</p>
        <button
          type="button"
          onClick={() => signInWithX()}
          className="rounded-full bg-dojo-ink px-5 py-2.5 font-sans text-sm font-bold text-dojo-washi-white"
        >
          Xでログイン
        </button>
      </CenterMessage>
    );
  }

  // 2026-08-30: 司会コンソールから退場させられた参加者は、以降の画面遷移・回答操作を
  // すべてブロックする（immersive/通常表示どちらに入る前に、ここで確実に止める）。
  if (myParticipant?.kicked_at) {
    return (
      <CenterMessage>
        <p className="mb-2 font-sans text-base font-bold text-dojo-ink">
          運営により退場となりました
        </p>
        <p className="mb-4 font-sans text-xs text-dojo-dark-brown/70">
          このライブへの参加はできません。
        </p>
        <Link
          href="/"
          className="rounded-full bg-dojo-curtain-red px-5 py-2.5 font-sans text-sm font-bold text-dojo-washi-white transition hover:bg-dojo-deep-crimson"
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
  // 旧デザイン（和風・washi配色、font-brush見出し）のフォールバック画面に
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
    const showJoinButton =
      !myParticipant && live.current_phase !== "interlude" && live.current_phase !== "opening";
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
            <OpeningView key="opening" />
          ) : live.current_phase === "topic_reveal" ? (
            <TopicRevealView key="topic_reveal" />
          ) : live.current_phase === "answering" ? (
            isMyGroupOnStage ? (
              <StageAnsweringView key="stage" />
            ) : myParticipant ? (
              <AudienceAnsweringView key="audience" />
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
            </ScreenShell>
          ) : live.current_phase === "final_result" ? (
            <ScreenShell key="final-result">
              {finalResult ? (
                <FinalResultView
                  data={finalResult}
                  myParticipantId={myParticipant?.id ?? null}
                  participantAvatars={participantAvatars}
                />
              ) : (
                <p className="font-sans text-sm text-white/70">結果を集計中…</p>
              )}
            </ScreenShell>
          ) : null}
        </AnimatePresence>
        {showJoinButton && <AudienceJoinButton />}
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
      <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
        爆笑スタジアムライブ
      </p>
      <h1 className="font-brush text-2xl text-dojo-dark-brown">
        {profile?.displayName ?? "..."}
      </h1>

      {liveLoading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">状態を確認中…</p>
      ) : !live ? (
        <>
          <p className="font-sans text-sm text-dojo-dark-brown">
            まだライブは開演していません。司会の開始をお待ちください。
          </p>
          <Link
            href="/"
            className="rounded-full border border-dojo-dark-brown/30 px-5 py-2.5 font-sans text-sm font-bold text-dojo-dark-brown transition hover:bg-dojo-light-brown"
          >
            ホームに戻る
          </Link>
        </>
      ) : live.current_phase === "scheduled" ? (
        // 運営者専用管理画面の追加（第1段階）：運営者が準備中（=まだ「参加受付を
        // 開始する」を押していない）の間は、参加登録受付(opening)より前の
        // 状態として、既存の「!live」ケースと同じ体裁で案内する。
        <>
          <p className="font-sans text-sm text-dojo-dark-brown">
            {live.title ? `「${live.title}」は` : "次回のライブは"}
            ただいま準備中です。参加受付が始まるまでお待ちください。
          </p>
          <Link
            href="/"
            className="rounded-full border border-dojo-dark-brown/30 px-5 py-2.5 font-sans text-sm font-bold text-dojo-dark-brown transition hover:bg-dojo-light-brown"
          >
            ホームに戻る
          </Link>
        </>
      ) : live.current_phase === "closed" ? (
        <>
          <p className="font-sans text-sm text-dojo-dark-brown">
            本日のライブは終了しました。お疲れさまでした！
          </p>
          <Link
            href="/"
            className="rounded-full bg-dojo-curtain-red px-5 py-2.5 font-sans text-sm font-bold text-dojo-washi-white transition hover:bg-dojo-deep-crimson"
          >
            ホームに戻る
          </Link>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-1">
            <p className="font-brush text-xl text-dojo-curtain-red">
              {PHASE_LABEL[live.current_phase] ?? live.current_phase}
            </p>
            {remainingSec !== null && (
              <p className="font-sans text-sm tabular-nums text-dojo-dark-brown">
                残り{remainingSec}秒
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
                  await joinLive("audience");
                  setJoining(false);
                }}
                className="rounded-full border border-dojo-dark-brown/30 px-5 py-3 font-sans text-sm font-bold text-dojo-dark-brown disabled:opacity-50"
              >
                {joining ? "参加処理中…" : "観客として参加する"}
              </button>
            </div>
          )}
          {!myParticipant && followerError && (
            <p className="font-sans text-xs text-dojo-deep-crimson">{followerError}</p>
          )}

          {myParticipant && (
            <p className="font-sans text-xs text-dojo-dark-brown">
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
              <div className="w-full rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/60 p-4">
                <p className="font-sans text-xs text-dojo-dark-brown">お題</p>
                <p className="mt-1 font-sans text-base font-bold text-dojo-ink">
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
    <div className="flex min-h-svh w-full flex-col items-center justify-center px-4 text-center font-sans text-sm text-dojo-dark-brown">
      {children}
    </div>
  );
}
