"use client";

import { motion } from "framer-motion";

import { MY_PARTICIPANT_ID, ROUNDS_PER_LIVE } from "@/data/liveDemoData";
import { getMyGroup, getParticipantName } from "@/lib/liveDemoSelectors";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import ScreenShell from "./ScreenShell";

// 役割発表（L2）：「あなたは◯組・出番◯番目」演出、組メンバー、周回数の案内
export default function OpeningScreen() {
  const state = useLiveDemoStore((s) => s);
  const myGroup = getMyGroup(state);
  const groups = [...state.groups].sort((a, b) => a.order - b.order);

  return (
    <ScreenShell>
      <p className="font-sans text-xs tracking-[0.4em] text-[#7ab2ff]">
        組分け発表
      </p>
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-2 font-sans text-2xl font-black text-white sm:text-3xl"
      >
        あなたは{myGroup?.order ?? "?"}組目・出番{myGroup?.order ?? "?"}番目
      </motion.h2>
      <p className="mt-2 font-sans text-sm text-white/70">
        全{ROUNDS_PER_LIVE}周・全{groups.length}組で進行します。
      </p>

      <div className="mt-8 grid w-full max-w-2xl gap-4 sm:grid-cols-3">
        {groups.map((g, idx) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 * idx, duration: 0.4 }}
            className={`rounded-2xl border p-4 text-left ${
              g.id === myGroup?.id
                ? "border-[#3b5bff] bg-white/10 shadow-[0_0_20px_rgba(59,91,255,0.5)]"
                : "border-white/15 bg-white/[0.03]"
            }`}
          >
            <p className={`font-sans text-xs font-bold ${g.id === myGroup?.id ? "text-[#7ab2ff]" : "text-white/50"}`}>
              {g.order}組目・出番{g.order}番目
            </p>
            <ul className="mt-2 space-y-1 font-sans text-sm">
              {g.memberIds.map((id) => (
                <li
                  key={id}
                  className={
                    id === MY_PARTICIPANT_ID
                      ? "font-bold text-[#7ab2ff]"
                      : "text-white/90"
                  }
                >
                  {getParticipantName(state, id)}
                  {id === MY_PARTICIPANT_ID ? "（あなた）" : ""}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </ScreenShell>
  );
}
