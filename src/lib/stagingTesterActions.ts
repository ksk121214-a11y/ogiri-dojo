// /live/host の StagingTestersPanel が使う、staging_testers の許可・失効の実処理。
// UIコンポーネント（busy/messageのstate管理）から分離することで、ステージング
// 誤接続防止ガードの経路を実際に呼び出すテストが、React描画なしで可能になる。
import { assertStagingOperationAllowed } from "@/lib/stagingEnv";
import { supabase } from "@/lib/supabase";

export type StagingTesterActionResult = { ok: true } | { ok: false; message: string };

export async function grantStagingTester(userId: string): Promise<StagingTesterActionResult> {
  const stagingCheck = await assertStagingOperationAllowed();
  if (!stagingCheck.ok) {
    return { ok: false, message: stagingCheck.reason ?? "ステージング安全確認に失敗しました" };
  }
  const { error } = await supabase.rpc("host_grant_staging_tester", { p_user_id: userId });
  if (error) return { ok: false, message: `許可に失敗しました：${error.message}` };
  return { ok: true };
}

export async function revokeStagingTester(userId: string): Promise<StagingTesterActionResult> {
  const stagingCheck = await assertStagingOperationAllowed();
  if (!stagingCheck.ok) {
    return { ok: false, message: stagingCheck.reason ?? "ステージング安全確認に失敗しました" };
  }
  const { error } = await supabase.rpc("host_revoke_staging_tester", { p_user_id: userId });
  if (error) return { ok: false, message: `失効に失敗しました：${error.message}` };
  return { ok: true };
}
