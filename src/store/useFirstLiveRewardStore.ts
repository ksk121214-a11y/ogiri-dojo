// 初回本番ライブ(#0001)の最終結果画面への到達記録・限定特典付与を管理するストア。
// supabase/migrations/0081のmark_final_result_presence/grant_first_live_rewardを
// 呼ぶだけの薄いラッパーだが、以下をここに集約する：
//   - キー単位のsingle-flight（liveId×userIdの組ごとに独立して管理する。異なる
//     組は互いに妨げず並行実行でき、同じ組への同時呼び出しは後発をno-opにする）。
//   - 冪等性の活用（一度成功したkeyは以後、ネットワークすら呼ばずに即座にno-opを返す）。
//   - mark_final_result_presenceがエラー・例外になっても、grant_first_live_rewardは
//     必ず試す。到達記録はDB上では成功していたのにレスポンスだけ失われた場合や、
//     その後ライブがclosedになった場合でも、grant側は既存の到達記録から復旧できる
//     （到達記録が無ければDB側がNO_PRESENCE_RECORDで拒否するため、不正な付与には
//     ならない）。完了扱い（completedKeys）にするのはgrantが成功した場合だけで、
//     grantが失敗・例外の場合は再試行できるようにする。
//   - 2026-09-28（レビュー対応・世代ガード）：mark完了後・grant開始前・grant完了後の
//     3時点それぞれで、現在の認証ユーザーがattempt開始時のuserIdのままかを確認する。
//     アカウントが切り替わっていたら、以降のRPC呼び出し・モーダル表示・
//     completedKeys更新のいずれも行わず、元ユーザーが戻った時に再試行できる状態を
//     維持する（inFlightKeysは必ずfinallyで解除するため、再試行を妨げない）。
//     さらにDB側（mark_final_result_presence/grant_first_live_rewardのp_expected_user_id）
//     でも、実行時点のauth.uid()と一致するかを確認する多層防御を追加した。
//   - 2026-09-28（レビュー対応）：grant RPCがerror=null・かつdataが不正な形式
//     （newly_grantedがboolean以外、title_display_nameが無効）の応答を返しても
//     成功・完了扱いにしない（isValidFirstLiveRewardRpcData参照）。
//   - 「今回の呼び出しで新規に付与された（＝獲得モーダルを出してよい）」の判定を、
//     grant_first_live_reward()の戻り値（newly_granted）にそのまま委ねる。
//     DBのユニーク制約により、複数タブ・再試行が同時に競合してもtrueになるのは
//     システム全体で正確に1回だけなので、ここで別途「表示済みフラグ」を持たなくても
//     モーダルの二重表示は起こらない。
import { create } from "zustand";

import { isValidFirstLiveRewardRpcData } from "@/lib/firstLiveRewardResult";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

export interface FirstLiveRewardAttemptResult {
  newlyGranted: boolean;
  // 付与時点のtitles.display_name（運営が改称していれば新しい表示名）。
  titleDisplayName: string;
}

interface FirstLiveRewardState {
  completedKeys: Record<string, true>;
  // 2026-09-27修正：以前はinFlightKeyが単一のstring|nullだったため、
  // 「Aの処理中にBが始まるとinFlightKeyがBに上書きされ、その後Aが再度呼ばれても
  // in-flight判定が効かず二重実行される」バグがあった。キーごとに独立したフラグを
  // 持つことで、異なるキー同士が互いの状態を上書き・解除しないようにする。
  inFlightKeys: Record<string, true>;
  attempt: (params: { liveId: string; userId: string }) => Promise<FirstLiveRewardAttemptResult | null>;
}

function keyOf(liveId: string, userId: string): string {
  return `${liveId}|${userId}`;
}

export const useFirstLiveRewardStore = create<FirstLiveRewardState>()((set, get) => ({
  completedKeys: {},
  inFlightKeys: {},

  attempt: async ({ liveId, userId }) => {
    const key = keyOf(liveId, userId);
    const state = get();
    if (state.completedKeys[key]) return null;
    if (state.inFlightKeys[key]) return null;

    // 開始時点で既にアカウントが切り替わっていれば、何もせず終える
    // （後から元の利用者に戻った時にまた呼ばれれば、そこから正しく再試行される）。
    const isStillCurrentUser = () => useAuthStore.getState().user?.id === userId;
    if (!isStillCurrentUser()) return null;

    set((s) => ({ inFlightKeys: { ...s.inFlightKeys, [key]: true } }));
    try {
      // 1) 最終結果画面への到達記録。テストライブ・official#2以降・緊急中止・
      //    ゲスト・ボット・退場済み・フェーズ不一致等はDB側で日常的に拒否される
      //    想定内のケースのため、エラーは開発者向けログに留め、利用者には何も出さない
      //    （この処理自体、利用者から見える操作ではないため）。
      //    ここで失敗・例外になっても、既にDB側では到達記録が成功していた
      //    （レスポンスだけ失われた）可能性があるため、諦めずgrantを試す。
      try {
        const { error: markError } = await supabase.rpc("mark_final_result_presence", {
          p_live_id: liveId,
          p_expected_user_id: userId,
        });
        if (markError) {
          console.warn(
            "[first-live-reward] 到達記録に失敗（想定内の除外条件、またはライブ終了後の可能性）。既存の到達記録が無いかgrant側で確認する",
            markError.message,
          );
        }
      } catch (markException) {
        console.warn("[first-live-reward] 到達記録の呼び出し自体が例外（通信断の可能性）。grant側で確認する", markException);
      }

      // mark完了後・grant開始前にアカウントが切り替わっていたら、別アカウントの
      // セッションでgrantを実行してしまわないよう、ここで打ち切る。
      if (!isStillCurrentUser()) return null;

      // 2) 到達記録を前提にした付与。到達記録済みなら、ライブがclosedになった後や
      //    通信復旧後の再試行でも成功する。到達記録が無ければDB側がNO_PRESENCE_RECORDで
      //    拒否するため、mark失敗時にgrantを試すこと自体が不正な付与にはならない。
      let grantData: unknown = null;
      try {
        const { data, error: grantError } = await supabase.rpc("grant_first_live_reward", {
          p_live_id: liveId,
          p_expected_user_id: userId,
        });
        if (grantError) {
          console.warn("[first-live-reward] 付与に失敗", grantError.message);
          return null;
        }
        grantData = data;
      } catch (grantException) {
        console.warn("[first-live-reward] 付与の呼び出し自体が例外", grantException);
        return null;
      }

      // grant完了後・completedKeys更新前にアカウントが切り替わっていたら、
      // 今の（別の）利用者へ結果を反映しない。元の利用者はcompletedKeysに
      // 記録されないため、戻ってきた時に再試行できる。
      if (!isStillCurrentUser()) return null;

      // 応答の形式チェック：error=nullでもdataがnull・空オブジェクト・型不正の
      // 場合は成功扱いにせず、再試行できる状態のまま終える（生のDBエラーは
      // 出さない。単に「今回はcompletedKeysへ記録しない」だけ）。
      if (!isValidFirstLiveRewardRpcData(grantData)) {
        console.warn("[first-live-reward] 付与RPCの応答が不正な形式（再試行可能な状態を維持）", grantData);
        return null;
      }

      // 付与（grant）が成功した場合だけ完了扱いにする（newly_granted=falseの
      // 「既に付与済み」も、これ以上再試行する必要が無いという意味で完了扱いにする）。
      set((s) => ({ completedKeys: { ...s.completedKeys, [key]: true } }));
      return {
        newlyGranted: grantData.newly_granted,
        titleDisplayName: grantData.title_display_name,
      };
    } catch (e) {
      console.warn("[first-live-reward] 例外", e);
      return null;
    } finally {
      // 自分のキーだけを解除する（他のキーのin-flight状態を巻き込んで消さない）。
      set((s) => {
        if (!s.inFlightKeys[key]) return s;
        const next = { ...s.inFlightKeys };
        delete next[key];
        return { inFlightKeys: next };
      });
    }
  },
}));
