// 実バックエンド版ライブ（フェーズC）のボット参加者管理ストア。
// 司会コンソールでのみ使う。メール+パスワードの実アカウントでボットをサインインさせ、
// 各ボット自身の認証済みクライアントで参加登録・回答・採点を行わせる。
import { create } from "zustand";

import { BOT_NAMES } from "@/data/liveDemoData";
import { createBotClient, type BotSession } from "@/lib/liveBotClients";
import type { ParticipantRow } from "@/lib/liveRoomTypes";
import { getParticipantAvatarColor, getParticipantAvatarIconId } from "@/lib/participantAvatar";

interface LiveBotState {
  bots: BotSession[];
  loading: boolean;
  error: string | null;
  addBots: (
    liveId: string,
    credentials: { email: string; password: string }[],
  ) => Promise<void>;
  removeAllBots: () => void;
}

export const useLiveBotStore = create<LiveBotState>()((set, get) => ({
  bots: [],
  loading: false,
  error: null,

  addBots: async (liveId, credentials) => {
    set({ loading: true, error: null });
    const usedNames = new Set(get().bots.map((b) => b.displayName));
    const availableNames = BOT_NAMES.filter((n) => !usedNames.has(n));
    const newBots: BotSession[] = [];
    const errors: string[] = [];

    for (let i = 0; i < credentials.length; i += 1) {
      const { email, password } = credentials[i];
      const client = createBotClient();
      const { data: authData, error: authError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (authError || !authData.user) {
        errors.push(`${email}: ログイン失敗（${authError?.message ?? "不明なエラー"}）`);
        continue;
      }
      const userId = authData.user.id;
      const displayName = availableNames[i] ?? `ボット${i + 1}`;

      // 2026-08-29: ボットのアイコン絵柄・色も、userIdから決定的に選んで
      // profilesへ書き込んでおく。何もしないとavatar_icon/avatar_colorは
      // デフォルト値（"default"）のままになり、全ボットが同じ見た目になってしまう
      // （「ボットのアイコンも編集画面にあるどれかのアイコンと色にしてほしい」の
      // 要望に応えられなくなる）。参加者間で表示するavatar_icon/avatar_colorは
      // participant_display_names RPC経由でprofilesの値を正として使うため、
      // ここで書き込んだ値がそのままボットの見た目として全員に一貫して見える。
      const botAvatarIcon = getParticipantAvatarIconId(userId);
      const botAvatarColor = getParticipantAvatarColor(userId);

      // 自分自身のプロフィール名・アイコンをボット用に変更（本人によるself-update。既存RLSにそのまま合致）。
      await client
        .from("profiles")
        .update({
          display_name: displayName,
          display_name_set: true,
          avatar_icon: botAvatarIcon,
          avatar_color: botAvatarColor,
        })
        .eq("id", userId);

      const { data: existing } = await client
        .from("participants")
        .select("*")
        .eq("live_id", liveId)
        .eq("user_id", userId)
        .maybeSingle();

      let participant = existing as ParticipantRow | null;
      if (!participant) {
        // 2026-08-30: 運営者専用管理画面の追加（第1段階）で、最大参加人数を
        // 安全に守るためparticipantsへの直接INSERTを廃止しjoin_live RPCに
        // 一本化した（src/store/useLiveFollowerStore.tsのjoinLiveと同じ経路）。
        // ボットは基本的にプレイヤー(舞台上)として参加させる。
        const { data: inserted, error: insertError } = await client.rpc("join_live", {
          p_live_id: liveId,
          p_preferred_role: "player",
        });
        if (insertError || !inserted) {
          errors.push(`${email}: 参加登録失敗（${insertError?.message ?? "不明なエラー"}）`);
          continue;
        }
        participant = inserted as ParticipantRow;
      }

      newBots.push({
        participantId: participant.id,
        userId,
        displayName,
        client,
      });
    }

    set((s) => ({
      bots: [...s.bots, ...newBots],
      loading: false,
      error: errors.length > 0 ? errors.join(" / ") : null,
    }));
  },

  removeAllBots: () => {
    for (const bot of get().bots) {
      bot.client.auth.signOut();
    }
    set({ bots: [] });
  },
}));
