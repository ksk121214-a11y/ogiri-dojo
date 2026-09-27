import { create } from "zustand";

import {
  beginIntent,
  bindIntentLive,
  discardIntent,
  evaluateIntent,
  finishJoinIntent,
  initialIntentState,
  settleIntent,
  type GuestSettled,
  type IntentAction,
  type IntentContext,
  type IntentState,
} from "@/lib/audienceJoinIntent";

// 観客参加の意図（メモリ上のみ。localStorageには残さない。ページ離脱・ログイン切替・別ライブ・
// 期限切れで破棄）。状態遷移は純粋関数（src/lib/audienceJoinIntent.ts）に置く。
interface IntentStore {
  state: IntentState;
  begin: () => number | null;
  // 指定tokenが現在も有効（破棄・別の意図開始で無効になっていない）か。
  isCurrent: (token: number) => boolean;
  bindLive: (token: number, liveId: string | null) => void;
  settle: (token: number, result: GuestSettled) => void;
  evaluate: (ctx: IntentContext) => IntentAction;
  finishJoin: (token: number) => void;
  discard: () => void;
}

export const useAudienceJoinIntentStore = create<IntentStore>()((set, get) => ({
  state: initialIntentState,
  begin: () => {
    const { state, token } = beginIntent(get().state);
    set({ state });
    return token;
  },
  isCurrent: (token) => {
    const st = get().state;
    return st.status !== "idle" && st.token === token;
  },
  bindLive: (token, liveId) => set({ state: bindIntentLive(get().state, token, liveId) }),
  settle: (token, result) => set({ state: settleIntent(get().state, token, result, Date.now()) }),
  evaluate: (ctx) => {
    const { state, action } = evaluateIntent(get().state, ctx, Date.now());
    if (state !== get().state) set({ state });
    return action;
  },
  finishJoin: (token) => set({ state: finishJoinIntent(get().state, token) }),
  discard: () => set({ state: discardIntent(get().state) }),
}));

export function isAudienceIntentEntering(s: IntentState): boolean {
  return s.status === "armed" || s.status === "joining";
}
