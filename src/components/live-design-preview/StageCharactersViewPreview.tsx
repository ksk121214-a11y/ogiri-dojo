"use client";

import { motion } from "framer-motion";
import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";

// src/components/live-room/StageCharactersView.tsxのデザイン確認用コピー。
// 完成図モックアップに合わせ、演壇はコンテナ幅いっぱいまで拡大し、アイコンはその演壇の
// 上端に食い込むようabsoluteで大きく重ねている（スペースを奪い合って縮むのではなく、
// レイヤーとして重なる構成）。土台（舞台丸い）は演壇より一回り大きく、演壇の足元より
// さらに下にずらして「演壇が舞台に乗っている」ように見せている。
// 名前ラベルはアイコンの真上に配置する（演壇の下ではなく、演者の頭上に名札が浮かぶ形）。
// モバイル(sm未満)は横幅基準(vw、5人が1行に収まるサイズ)、sm以上は高さ基準(vh)に
// レスポンシブに切り替えることで、両方の画面形状で1行に収まるようにしている。
export default function StageCharactersViewPreview({
  members,
  myParticipantId,
  activeParticipantId,
  glowingParticipantId = null,
  compact = false,
}: {
  members: { id: string; name: string }[];
  myParticipantId: string | null;
  activeParticipantId: string | null;
  // 送信直後、演壇が光る演出の対象participant_id。
  glowingParticipantId?: string | null;
  compact?: boolean;
}) {
  return (
    <>
      {!compact && (
        // 観客シルエット(AudienceLayer、z-indexは呼び出し側でaudienceZIndex経由)が
        // 「舞台より前・演壇より後ろ」に来るよう、舞台だけをキャラ列とは別の
        // fixedレイヤーに分離し、キャラ列より低いz-indexにする。以前はキャラ列と
        // 同じfixedコンテナの中に(ローカルな-z-10で)入れていたが、その場合コンテナ
        // 全体が観客より前面に出てしまい、観客が舞台の裏に隠れてしまっていた。
        <div className="pointer-events-none fixed inset-x-0 bottom-[81px] z-0 mx-auto max-w-4xl">
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2 aspect-[2.4/1] w-[min(122%,610px)]">
            <Image
              src={`${BASE_PATH}/images/live/stage-platform.png`}
              alt=""
              fill
              sizes="672px"
              className="object-cover"
              style={{ objectPosition: "50% 62%" }}
            />
          </div>
        </div>
      )}
      <div
        className={`flex items-end justify-center ${
          compact
            ? "relative w-full max-w-4xl gap-x-1 gap-y-1 px-2 pb-1"
            : // 画面サイズ(スマホ/タブレット/PC)によって演壇・アイコンの位置が
              // 変わって見えないよう、画面下端からの絶対px固定にする。
              // 下に余白ができることは許容し、位置がブレないことを優先する。
              "fixed inset-x-0 bottom-[125px] z-10 mx-auto max-w-4xl gap-x-0 px-1 pb-3"
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
              compact ? "w-12 sm:w-14" : "w-[min(17vw,85px)] -translate-y-[58px]"
            }`}
            style={{ zIndex: isActive ? 30 : 20 }}
          >
            {compact ? (
              <div className="relative z-10 h-8 w-8 sm:h-10 sm:w-10">
                <Image
                  src={`${BASE_PATH}/images/live/avatar-placeholder.png`}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-contain"
                />
              </div>
            ) : (
              <>
                <div className="relative aspect-[161/197] w-full">
                  <Image
                    src={`${BASE_PATH}/images/live/answer-podium.png`}
                    alt=""
                    fill
                    sizes="140px"
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
                <div className="absolute left-1/2 top-0 z-10 w-[94%] -translate-x-1/2 -translate-y-[78%]">
                  {isActive && (
                    <motion.div
                      className="pointer-events-none absolute -inset-3 -z-10 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(255,217,142,0.55), transparent 70%)",
                      }}
                      animate={{ opacity: [0.5, 0.95, 0.5] }}
                      transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  <p
                    className={`absolute -top-3 left-1/2 z-20 max-w-full -translate-x-1/2 whitespace-nowrap truncate text-center font-sans text-xs ${
                      isActive ? "font-bold text-dojo-curtain-gold" : "text-dojo-washi-white/70"
                    }`}
                  >
                    {member.name}
                    {isMe ? "（あなた）" : ""}
                  </p>
                  <div
                    className="relative aspect-square w-full -translate-y-[5px]"
                    style={
                      isActive
                        ? { filter: "drop-shadow(0 0 14px rgba(232,184,76,0.85))" }
                        : undefined
                    }
                  >
                    <Image
                      src={`${BASE_PATH}/images/live/avatar-placeholder.png`}
                      alt=""
                      fill
                      sizes="140px"
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
                className="absolute -top-8 z-20 whitespace-nowrap rounded-full bg-dojo-curtain-gold px-2 py-0.5 font-sans text-[9px] font-bold text-dojo-stage-dark"
              >
                審査中
              </motion.span>
            )}
          </motion.div>
        );
      })}
      </div>
    </>
  );
}
