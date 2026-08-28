"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";

import { getAvatarIconSrc } from "@/lib/avatarIcons";
import { BASE_PATH } from "@/lib/basePath";
import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { getParticipantAvatarColor, getParticipantAvatarIconSrc } from "@/lib/participantAvatar";
import { useUserStore } from "@/store/useUserStore";

const EMPTY_SCORE_REVEALS: Record<string, number> = {};

// 自分・他の参加者（ボット含む）のアイコン線画を、mask-imageで指定色に塗って表示する。
// 2026-08-29:「アイコンをまるで囲わないでそのままアイコンの感じで」の要望で、
// 以前あった「線画の下に敷く白い円」は撤去した（新しいアイコン素材は円の縁取りごと
// 絵柄に含まれているため、下敷きが無くても素の見た目のまま表示される）。
function AvatarGlyph({ iconSrc, color }: { iconSrc: string; color: string }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0"
      style={{
        backgroundColor: color,
        WebkitMaskImage: `url(${BASE_PATH}${iconSrc})`,
        maskImage: `url(${BASE_PATH}${iconSrc})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

// 中央の「舞台」ビジュアルエリア：組の回答者を横並びに配置し、
// 審査サイクルに乗っている1人だけスポットライトを浴びて前に出る。
// src/components/live-demo/StageCharacters.tsxと同じ見た目・演出（design-preview-2由来の
// neon2デザイン）をそのまま移植したもの。useLiveDemoState/MY_PARTICIPANT_IDには依存せず、
// 名前解決済みのメンバー一覧をpropsで受け取る点だけがデモ版と異なる。
// 舞台の丸い土台はLiveStageBackdrop(variant="neon2")のstage-bg-2.png側に描き込まれて
// いるため、ここでは演壇・アイコンの列だけを画面下部に固定表示する（fixed）。
export default function StageCharactersView({
  members,
  myParticipantId = null,
  activeParticipantId,
  revealPendingParticipantId = null,
  scoreReveals = EMPTY_SCORE_REVEALS,
  compact = false,
}: {
  members: { id: string; name: string }[];
  // 自分のアイコンだけ、マイページで選んだ絵柄・色（useUserStore）を反映する。
  // それ以外の参加者（ボット含む）はparticipant_idから決定的に選んだ絵柄・色にする
  // （マイページの設定はこのブラウザにしか保存されず他人からは見えないため、
  // 参照: src/lib/participantAvatar.ts）。
  myParticipantId?: string | null;
  activeParticipantId: string | null;
  // 送信直後・まだ回答フリップが出ていない「一呼吸」中の対象者。この間は回答フリップが
  // まだ画面を覆っていないため、回答席の光る演出が実際に見える唯一のタイミング
  // （審査中は回答フリップが回答席を覆い隠すため見えない）。
  revealPendingParticipantId?: string | null;
  // 採点が確定した直後、その人の回答席の真ん中に得点をデジタル表示するための対象者→点数の
  // マップ。1人ぶんの単一state(participantId/value)ではなくマップにしているのは、確定が
  // 立て続けに起きた場合でも前の人の表示が後の人の表示に上書きされて消えてしまわない
  // ようにするため（複数人ぶんが同時に有効でも、それぞれ自分の回答席にだけ出るので
  // 見た目が競合しない）。空なら何も表示しない（呼び出し側が確定を検知しない限り
  // 渡さない＝既定は今まで通り）。
  scoreReveals?: Record<string, number>;
  compact?: boolean;
}) {
  const myAvatarColor = useUserStore((s) => s.user.avatarColor);
  const myAvatarIcon = useUserStore((s) => s.user.avatarIcon);
  const myIconSrc = getAvatarIconSrc(myAvatarIcon);

  return (
    <div
      className={`flex items-end justify-center ${
        compact
          ? "relative w-full max-w-4xl gap-x-1 gap-y-1 px-2 pb-1"
          : "fixed inset-x-0 bottom-[calc(19vh+20px)] z-10 mx-auto max-w-4xl gap-x-0 px-1 pb-3 sm:bottom-[19vh]"
      }`}
    >
      {members.map((member) => {
        const isActive = member.id === activeParticipantId;
        const isGlowingSeat = isActive || member.id === revealPendingParticipantId;
        const isMe = member.id === myParticipantId;
        const scoreRevealValue = scoreReveals[member.id];
        const showScore = scoreRevealValue !== undefined;
        const iconSrc = isMe ? myIconSrc : getParticipantAvatarIconSrc(member.id);
        const iconColor = isMe ? myAvatarColor : getParticipantAvatarColor(member.id);
        return (
          <motion.div
            key={member.id}
            className={`relative flex flex-col items-center ${
              compact ? "w-12 sm:w-14" : "w-[min(19vw,95px)] -translate-y-[58px]"
            }`}
            style={{ zIndex: isGlowingSeat || showScore ? 30 : 20 }}
          >
            {compact ? (
              <div className="relative z-10 h-8 w-8 sm:h-10 sm:w-10">
                <AvatarGlyph iconSrc={iconSrc} color={iconColor} />
              </div>
            ) : (
              <>
                <div className="relative aspect-[164/194] w-full">
                  <Image
                    src={`${BASE_PATH}/images/live2/podium-2-crop.png`}
                    alt=""
                    fill
                    sizes="150px"
                    className="object-contain"
                  />
                  {isGlowingSeat && (
                    // 回答席まわりに光を足すのではなく、演壇画像（見えている部分全体）を
                    // 金色に染める演出。同じ画像をmask-imageに使うことで、演壇の輪郭から
                    // はみ出さずに演壇全体だけが金色になる。ただし①蓋部分(赤ボタン付きの
                    // 白い部分)と②黄色い枠の中の白い回答欄は金色にしないよう、clip-path
                    // の「鍵穴」テクニック（外周を一周し、各穴の輪郭を逆回りにたどって
                    // 戻る一筆書きの経路にすることで、通常のnonzero塗りつぶしのまま
                    // 複数の穴を開けられる）で四角い穴を2つ開けている。穴の座標は
                    // podium-2-crop.png(164x194)を実際にピクセル単位でサンプリングして
                    // 測った、蓋の範囲(y0%〜21.5%)と黄色い枠の内側の白い部分の範囲
                    // (19% 26%〜81% 77%)。
                    <motion.div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        background: "#ffcf4a",
                        WebkitMaskImage: `url(${BASE_PATH}/images/live2/podium-2-crop.png)`,
                        maskImage: `url(${BASE_PATH}/images/live2/podium-2-crop.png)`,
                        WebkitMaskSize: "contain",
                        maskSize: "contain",
                        WebkitMaskRepeat: "no-repeat",
                        maskRepeat: "no-repeat",
                        WebkitMaskPosition: "center",
                        maskPosition: "center",
                        clipPath:
                          "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 0% 21.5%, 100% 21.5%, 100% 0%, 0% 0%, 19% 26%, 19% 77%, 81% 77%, 81% 26%, 19% 26%, 0% 0%)",
                        WebkitClipPath:
                          "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 0% 21.5%, 100% 21.5%, 100% 0%, 0% 0%, 19% 26%, 19% 77%, 81% 77%, 81% 26%, 19% 26%, 0% 0%)",
                      }}
                      animate={{ opacity: [0.78, 1, 0.78] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  <AnimatePresence>
                    {showScore && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.6 }}
                        transition={{ type: "spring", stiffness: 260, damping: 16 }}
                        className="pointer-events-none absolute left-1/2 top-[48%] z-40 -translate-x-1/2 -translate-y-1/2"
                      >
                        <span className="font-sans text-3xl font-black tabular-nums text-black sm:text-5xl">
                          {scoreRevealValue}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="absolute left-1/2 top-0 z-10 w-[88%] -translate-x-1/2 -translate-y-[92%]">
                  <p
                    className={`absolute -top-3 left-1/2 z-20 max-w-full -translate-x-1/2 whitespace-nowrap truncate text-center font-sans text-xs ${
                      isActive ? "font-bold text-[#7ab2ff]" : "text-white/70"
                    }`}
                  >
                    {truncateLiveDisplayName(member.name)}
                  </p>
                  <div
                    className="relative aspect-square w-full"
                    style={
                      isActive
                        ? { filter: "drop-shadow(0 0 14px rgba(122,178,255,0.85))" }
                        : undefined
                    }
                  >
                    <AvatarGlyph iconSrc={iconSrc} color={iconColor} />
                  </div>
                </div>
              </>
            )}
            {isActive && !compact && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute -top-8 z-20 whitespace-nowrap rounded-full bg-[#3b5bff] px-2 py-0.5 font-sans text-[9px] font-bold text-white"
              >
                審査中
              </motion.span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
