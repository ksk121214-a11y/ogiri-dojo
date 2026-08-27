"use client";

import { motion } from "framer-motion";
import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";

// live-design-preview/StageCharactersViewPreview.tsx（1個目のデザイン確認）を、
// 大喜利素材2のネオン系アセットに差し替えたコピー。舞台の土台グラフィックは
// 背景(LiveStageBackdropPreview2のstage-bg-2.png)に既に描き込まれているため、
// ここでは演壇・アイコンの列だけを重ねる（別レイヤーの土台画像は不要）。
export default function StageCharactersViewPreview2({
  members,
  myParticipantId,
  activeParticipantId,
  glowingParticipantId = null,
  compact = false,
}: {
  members: { id: string; name: string }[];
  myParticipantId: string | null;
  activeParticipantId: string | null;
  glowingParticipantId?: string | null;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-end justify-center ${
        compact
          ? "relative w-full max-w-4xl gap-x-1 gap-y-1 px-2 pb-1"
          : "fixed inset-x-0 bottom-[19vh] z-10 mx-auto max-w-4xl gap-x-0 px-1 pb-3"
      }`}
    >
      {members.map((member) => {
        const isActive = member.id === activeParticipantId;
        const isMe = member.id === myParticipantId;
        const isGlowing = member.id === glowingParticipantId;
        return (
          <motion.div
            key={member.id}
            className={`relative flex flex-col items-center ${
              compact ? "w-12 sm:w-14" : "w-[min(19vw,95px)] -translate-y-[58px]"
            }`}
            style={{ zIndex: isActive ? 30 : 20 }}
          >
            {compact ? (
              <div className="relative z-10 h-8 w-8 sm:h-10 sm:w-10">
                <Image
                  src={`${BASE_PATH}/images/live2/avatar-2-crop.png`}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-contain"
                />
              </div>
            ) : (
              <>
                {/* podium-2-crop.png/avatar-2-crop.pngは元画像の余白(実際の絵が
                    画像全体の3〜4割しかなかった)をトリミングした版。同じ表示枠でも
                    絵そのものが大きく見えるようになる。 */}
                <div className="relative aspect-[164/194] w-full">
                  <Image
                    src={`${BASE_PATH}/images/live2/podium-2-crop.png`}
                    alt=""
                    fill
                    sizes="150px"
                    className="object-contain"
                  />
                  {isGlowing && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                      <motion.div
                        className="h-4 w-4 rounded-full bg-red-600"
                        style={{ boxShadow: "0 0 10px 3px rgba(220,38,38,0.9)" }}
                        animate={{ scale: [1, 1.25, 1], opacity: [0.85, 1, 0.85] }}
                        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  )}
                </div>
                {/* アイコンの底辺が演壇の上端にほぼ触れる位置(-translate-y-[92%])に
                    して、隙間なくくっついて見えるようにする。 */}
                <div className="absolute left-1/2 top-0 z-10 w-[88%] -translate-x-1/2 -translate-y-[92%]">
                  {isActive && (
                    <motion.div
                      className="pointer-events-none absolute -inset-3 -z-10 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(122,178,255,0.55), transparent 70%)",
                      }}
                      animate={{ opacity: [0.5, 0.95, 0.5] }}
                      transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  <p
                    className={`absolute -top-3 left-1/2 z-20 max-w-full -translate-x-1/2 whitespace-nowrap truncate text-center font-sans text-xs ${
                      isActive ? "font-bold text-[#7ab2ff]" : "text-white/70"
                    }`}
                  >
                    {member.name}
                    {isMe ? "（あなた）" : ""}
                  </p>
                  <div
                    className="relative aspect-square w-full"
                    style={
                      isActive
                        ? { filter: "drop-shadow(0 0 14px rgba(122,178,255,0.85))" }
                        : undefined
                    }
                  >
                    <Image
                      src={`${BASE_PATH}/images/live2/avatar-2-crop.png`}
                      alt=""
                      fill
                      sizes="150px"
                      className="object-contain"
                    />
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
