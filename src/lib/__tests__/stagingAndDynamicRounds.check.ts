// 第3段階（ステージング運営環境・動的な周回追加）の配線検査。
// stagingEnv.ts自体の実行検証（appEnv判定・Project Ref抜き出し・一致判定を実際に
// 呼んで確認する）は、"@/..."エイリアス解決が必要なためsrc/lib/__tests__/store/
// stagingEnvDynamic.check.ts（専用tsconfig経由）で行う。ここではuseLiveHostStore/
// host console/follower storeの配線を静的に確認する（既存の*.check.tsのスタイルを踏襲）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// 1) stagingEnv: URL・キーの全文をconsoleへ出していない（Project Ref以外の秘密情報を扱わない）
{
  const src = read("src/lib/stagingEnv.ts");
  assert.doesNotMatch(src, /console\.(log|warn|error|info)/, "stagingEnv.tsがconsoleへ出力している（URL・キーの漏洩リスク）");
  assert.doesNotMatch(src, /NEXT_PUBLIC_SUPABASE_ANON_KEY/, "stagingEnv.tsがSupabaseキーを直接参照している");
  console.log("PASS: stagingEnv.tsはログ出力を一切行わず、Supabaseキーも参照しない（Project Refだけを扱う）");
}

// 2) useLiveHostStore：createLivePreparation/beginGame/addNextRound/finishLiveFromRoundDecisionが
//    ステージング安全確認(assertStagingOperationAllowed)を呼んでいる。新規RPC名も正しい。
{
  const store = read("src/store/useLiveHostStore.ts");
  assert.match(store, /import \{ assertStagingOperationAllowed \} from "@\/lib\/stagingEnv";/, "useLiveHostStoreがstagingEnvを読み込んでいない");

  const fnBody = (name: string): string => {
    const start = store.indexOf(`${name}: async`);
    assert.ok(start >= 0, `${name}の定義が見つからない`);
    // 次の「トップレベルの」アクション定義（2スペースインデントの"name: "）までを本体とみなす
    const rest = store.slice(start + name.length);
    const next = rest.search(/\n  [a-zA-Z]+:\s*(async)?\s*\(/);
    return rest.slice(0, next > 0 ? next : 2000);
  };

  assert.match(fnBody("createLivePreparation"), /assertStagingOperationAllowed/, "createLivePreparationがステージング安全確認を呼んでいない");
  assert.match(fnBody("beginGame"), /assertStagingOperationAllowed/, "beginGameがステージング安全確認を呼んでいない");
  assert.match(fnBody("addNextRound"), /assertStagingOperationAllowed/, "addNextRoundがステージング安全確認を呼んでいない");
  assert.match(fnBody("addNextRound"), /rpc\("host_add_next_round"/, "addNextRoundがhost_add_next_round RPCを呼んでいない");
  assert.match(fnBody("finishLiveFromRoundDecision"), /assertStagingOperationAllowed/, "finishLiveFromRoundDecisionがステージング安全確認を呼んでいない");
  assert.match(fnBody("finishLiveFromRoundDecision"), /rpc\("host_finish_live_from_round_decision"/, "finishLiveFromRoundDecisionがhost_finish_live_from_round_decision RPCを呼んでいない");
  console.log("PASS: createLivePreparation/beginGame/addNextRound/finishLiveFromRoundDecisionはステージング安全確認を呼び、新規RPCも正しく呼ぶ");
}

// 3) LivePhase・LiveRowにawaiting_round_decision・access_restrictedが追加されている
{
  const types = read("src/lib/liveRoomTypes.ts");
  assert.match(types, /"awaiting_round_decision"/, "LivePhaseにawaiting_round_decisionが無い");
  assert.match(types, /access_restricted: boolean;/, "LiveRowにaccess_restrictedが無い");
  console.log("PASS: LivePhaseにawaiting_round_decision、LiveRowにaccess_restrictedが追加されている");
}

// 4) useLiveFollowerStore：awaiting_round_decisionの間もgroupResultを計算し続け、
//    STAGING_ACCESS_DENIEDを利用者向けの文言へ変換している
{
  const follower = read("src/store/useLiveFollowerStore.ts");
  assert.match(
    follower,
    /live\.current_phase === "group_result" \|\| live\.current_phase === "awaiting_round_decision"/,
    "awaiting_round_decisionの間groupResultを計算し続ける実装になっていない",
  );
  assert.match(follower, /STAGING_ACCESS_DENIED/, "join_liveのSTAGING_ACCESS_DENIEDを処理していない");
  console.log("PASS: useLiveFollowerStoreはawaiting_round_decisionの間もgroupResultを保持し、STAGING_ACCESS_DENIEDを案内文へ変換する");
}

// 5) /live/page.tsx：awaiting_round_decisionを没入画面の対象フェーズに含め、
//    GroupResultViewへwaitingForNextRoundを渡している
{
  const page = read("src/app/live/page.tsx");
  assert.match(page, /live\.current_phase === "awaiting_round_decision"/, "/live/page.tsxがawaiting_round_decisionを扱っていない");
  assert.match(page, /waitingForNextRound=\{live\.current_phase === "awaiting_round_decision"\}/, "GroupResultViewへwaitingForNextRoundを渡していない");
  console.log("PASS: /live/page.tsxはawaiting_round_decisionを没入画面の対象に含め、組結果画面に周回判断待ちの案内を出す");
}

// 6) /live/host/page.tsx：STAGINGバナー・周回判断パネル・テスター許可パネルが配線されている
{
  const host = read("src/app/live/host/page.tsx");
  assert.match(host, /import \{ getConfiguredProjectRef, isStagingMode \} from "@\/lib\/stagingEnv";/, "host consoleがstagingEnvを読み込んでいない");
  assert.match(host, /function StagingBanner\(\)/, "StagingBannerが定義されていない");
  assert.match(host, /if \(!isStagingMode\(\)\) return null;/, "StagingBannerがstaging以外で非表示になっていない");
  assert.match(host, /function RoundDecisionPanel/, "RoundDecisionPanelが定義されていない");
  assert.match(host, /live\.current_phase === "awaiting_round_decision" && \(\s*<RoundDecisionPanel/, "awaiting_round_decisionでRoundDecisionPanelが表示されていない");
  assert.match(host, /function StagingTestersPanel/, "StagingTestersPanelが定義されていない");
  assert.match(host, /host_grant_staging_tester/, "StagingTestersPanelがhost_grant_staging_testerを呼んでいない");
  assert.match(host, /host_revoke_staging_tester/, "StagingTestersPanelがhost_revoke_staging_testerを呼んでいない");
  console.log("PASS: host console(/live/host)にSTAGINGバナー・周回判断パネル・テスター許可パネルが配線されている（既存の/live/hostをそのまま拡張。/live-demoは別ファイルで複製していない）");
}

// 7) 0085マイグレーションの新規RPCがauthenticatedのみに制限され、PUBLIC/anonへ実行権限を与えていない
{
  const sql = read("supabase/migrations/0085_staging_operations_and_dynamic_rounds.sql");
  for (const fn of [
    "host_add_next_round(uuid, int, jsonb)",
    "host_finish_live_from_round_decision(uuid)",
    "host_grant_staging_tester(uuid)",
    "host_revoke_staging_tester(uuid)",
  ]) {
    const escaped = fn.replace(/[().[\]]/g, (c) => `\\${c}`);
    assert.ok(
      new RegExp(`revoke all on function public\\.${escaped} from public, anon;`).test(sql),
      `${fn}がPUBLIC/anonから明示的にrevokeされていない`,
    );
    assert.ok(
      new RegExp(`grant execute on function public\\.${escaped} to authenticated;`).test(sql),
      `${fn}がauthenticatedへ明示的にgrantされていない`,
    );
  }
  assert.match(sql, /if not is_host\(\) then\s*\n\s*raise exception 'not authorized';/, "0085の新規RPCがis_host()を確認していない");
  console.log("PASS: 0085の新規RPC（周回追加・終了・テスター許可・失効）はPUBLIC/anonから実行できず、authenticatedのみに制限されis_host()も確認する");
}
