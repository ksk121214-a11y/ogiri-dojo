#!/usr/bin/env bash
# src/lib/内の純粋関数（answeringCue.ts・liveHostSnapshots.ts等）の
# 検証スクリプトをまとめて実行するワンコマンドランナー。
#
# このリポジトリには自動テストランナー(vitest/jest等)が導入されていないため、
# supabase/tests/run.sh（psqlだけで完結する代替手段）と同じ考え方で、
# 一時ディレクトリへtscでコンパイルしてからnodeで直接実行する。
#
# 使い方：
#   src/lib/__tests__/run.sh
#
# 新しい検証スクリプトを追加する場合：
#   1. src/lib/に純粋関数を実装する（Supabase等の外部I/Oに依存しない形にする）。
#   2. src/lib/__tests__/<名前>.check.ts に、assertベースの検証を書く
#      （末尾でPASSした旨とサマリをconsole.logする）。
#   3. このスクリプトの対象一覧に追加する必要は無い（*.check.tsを自動的に
#      全て検出してコンパイル・実行する）。ただしcheck.tsが依存する
#      src/lib/内のソースファイルは、下のSOURCE_FILES配列に追記すること。
#
# 例外：Zustandストア本体（"@/..."エイリアス・実際のSupabaseクライアント生成を
# 含む）を本番と同じ実装のままテストしたい場合は、src/lib/__tests__/store/配下に
# 専用のtsconfig（例：tsconfig.followerRace.json）を置き、このスクリプト末尾の
# 個別ブロックに追加する（-maxdepth 1のCHECK_FILESループには含まれないため、
# 素のtsc起動では解決できないパスエイリアスの問題を回避できる）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$REPO_ROOT"

# 検証スクリプトが依存するsrc/lib/内の純粋関数ソース。
SOURCE_FILES=(
  "$SCRIPT_DIR/../answeringCue.ts"
  "$SCRIPT_DIR/../liveHostSnapshots.ts"
  "$SCRIPT_DIR/../participantRoleSplit.ts"
  "$SCRIPT_DIR/../snsLiveResultPreview.ts"
  "$SCRIPT_DIR/../liveGuestAccess.ts"
  "$SCRIPT_DIR/../guestStatus.ts"
  "$SCRIPT_DIR/../referralSurveySummary.ts"
  "$SCRIPT_DIR/../singleFlight.ts"
  "$SCRIPT_DIR/../legalInfo.ts"
  "$SCRIPT_DIR/../limitedRewardEligibility.ts"
  "$SCRIPT_DIR/../liveTopicRequirement.ts"
  "$SCRIPT_DIR/../limitedRewardPresenceLoader.ts"
  "$SCRIPT_DIR/../liveRoomSelectors.ts"
  "$SCRIPT_DIR/../liveRoomPresentation.ts"
  "$SCRIPT_DIR/../liveDemoMode.ts"
  "$SCRIPT_DIR/../seededRandom.ts"
  "$SCRIPT_DIR/../cuePlayback.ts"
  "$SCRIPT_DIR/../liveRoomPresentation.ts"
  "$SCRIPT_DIR/../liveRoomTypes.ts"
  "$SCRIPT_DIR/../consentCheck.ts"
  "$SCRIPT_DIR/../serverClock.ts"
  "$SCRIPT_DIR/../serverClockAutoSync.ts"
  "$SCRIPT_DIR/../topicRevealSfx.ts"
  "$SCRIPT_DIR/../answeringAdvance.ts"
  "$SCRIPT_DIR/../liveRemaining.ts"
  "$SCRIPT_DIR/../topicRevealSfxScheduler.ts"
  "$SCRIPT_DIR/../bgmSync.ts"
  "$SCRIPT_DIR/../bgmCorrection.ts"
  "$SCRIPT_DIR/../bgmStartIntent.ts"
  "$SCRIPT_DIR/../bgmStartPlan.ts"
  "$SCRIPT_DIR/../botAnswerPolicy.ts"
  "$SCRIPT_DIR/../termsConsentRecorder.ts"
  "$SCRIPT_DIR/../audioRoutes.ts"
  "$SCRIPT_DIR/../snsAccess.ts"
  "$SCRIPT_DIR/../uuid.ts"
  "$SCRIPT_DIR/../reportSubmit.ts"
  "$SCRIPT_DIR/../audienceJoinIntent.ts"
  "$SCRIPT_DIR/../audienceJoinDrive.ts"
  "$SCRIPT_DIR/../audienceGuestButton.ts"
  "$SCRIPT_DIR/../audienceJoinUiPlan.ts"
  "$SCRIPT_DIR/../liveParticipantPath.ts"
  "$SCRIPT_DIR/../authCallbackGuard.ts"
  "$SCRIPT_DIR/../authCallback.ts"
  "$SCRIPT_DIR/../authorLookupStatus.ts"
  "$SCRIPT_DIR/../calendarInitialMonth.ts"
  "$SCRIPT_DIR/../answerSubmitCue.ts"
  "$SCRIPT_DIR/../roundTopicCandidates.ts"
  "$SCRIPT_DIR/../judgingDisplayState.ts"
  "$SCRIPT_DIR/../judgingDisplayBackfill.ts"
)

# src/lib/__tests__/配下の*.check.tsを全て検出する。
CHECK_FILES=()
while IFS= read -r -d '' f; do
  CHECK_FILES+=("$f")
done < <(find "$SCRIPT_DIR" -maxdepth 1 -name '*.check.ts' -print0 | sort -z)

if [ ${#CHECK_FILES[@]} -eq 0 ]; then
  echo "FAIL: src/lib/__tests__/に*.check.tsが見つかりません" >&2
  exit 1
fi

npx tsc \
  --module commonjs \
  --target es2020 \
  --moduleResolution node \
  --esModuleInterop \
  --skipLibCheck \
  --outDir "$TMP_DIR" \
  "${SOURCE_FILES[@]}" \
  "${CHECK_FILES[@]}"

# tscの出力先は、複数の入力ファイルの共通の親ディレクトリを基準に相対配置される
# （共通の親はsrc/libなので、check.tsの出力は<TMP_DIR>/__tests__/<名前>.check.js
# になる）。tscのバージョン差異で構造が変わっても壊れないよう、実際に生成された
# ファイルをfindで探して1つずつ実行する。
FAILED=0
for src in "${CHECK_FILES[@]}"; do
  name="$(basename "$src" .ts)"
  js="$(find "$TMP_DIR" -name "${name}.js" | head -1)"
  if [ -z "$js" ]; then
    echo "FAIL: コンパイル後の${name}.jsが見つかりません" >&2
    FAILED=1
    continue
  fi
  echo "--- ${name}.ts ---"
  if ! node "$js"; then
    FAILED=1
  fi
done

# src/lib/__tests__/store/pointBreakdown.check.ts は、pointBreakdown.tsが
# 依存するsrc/data/collectionData.ts自体が"@/types/economy"エイリアスを使っており、
# 素のtsc起動（パスエイリアス無し）では解決できないため、専用tsconfig経由にする
# （Supabaseクライアントは一切生成しないため、SUPABASE系の環境変数は不要）。
POINT_BREAKDOWN_DIR="$(mktemp -d)"
POINT_BREAKDOWN_TSCONFIG="$SCRIPT_DIR/store/tsconfig.pointBreakdown.json"
POINT_BREAKDOWN_ENTRY="$POINT_BREAKDOWN_DIR/src/lib/__tests__/store/pointBreakdown.check.js"

echo "--- pointBreakdown.check.ts ---"
if npx tsc -p "$POINT_BREAKDOWN_TSCONFIG" --outDir "$POINT_BREAKDOWN_DIR" && [ -f "$POINT_BREAKDOWN_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$POINT_BREAKDOWN_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$POINT_BREAKDOWN_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: pointBreakdown.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$POINT_BREAKDOWN_DIR"

# src/lib/__tests__/store/useLiveHostStoreCreateLivePreparation.check.ts も同じ理由
# （useLiveHostStore.tsが"@/..."エイリアス・実際のSupabaseクライアント生成を含む）
# で専用tsconfig経由にする。2026-09-22レビュー対応：create_live_preparation RPC
# 呼び出し自体が失敗した場合に、生のPostgreSQL/Supabaseエラー文言を画面へ返さず
# 安全な日本語文言へ変換することを検証する（SQL関数側が返すresult.reasonの
# 日本語文言はこれまでどおりそのまま通ることの回帰確認も含む）。
HOST_CREATE_LIVE_PREP_DIR="$(mktemp -d)"
HOST_CREATE_LIVE_PREP_TSCONFIG="$SCRIPT_DIR/store/tsconfig.hostCreateLivePreparation.json"
HOST_CREATE_LIVE_PREP_ENTRY="$HOST_CREATE_LIVE_PREP_DIR/src/lib/__tests__/store/useLiveHostStoreCreateLivePreparation.check.js"

echo "--- useLiveHostStoreCreateLivePreparation.check.ts ---"
if npx tsc -p "$HOST_CREATE_LIVE_PREP_TSCONFIG" --outDir "$HOST_CREATE_LIVE_PREP_DIR" && [ -f "$HOST_CREATE_LIVE_PREP_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$HOST_CREATE_LIVE_PREP_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$HOST_CREATE_LIVE_PREP_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveHostStoreCreateLivePreparation.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$HOST_CREATE_LIVE_PREP_DIR"

# audioManagerSfx.check.ts：audioManager.ts（"@/..."エイリアスを含む）を本番と同じ実装のまま
# 動かし、未実装SEがネットワーク要求・Audio生成・警告を出さないことを検証する（専用tsconfig経由）。
AUDIO_SFX_DIR="$(mktemp -d)"
AUDIO_SFX_TSCONFIG="$SCRIPT_DIR/store/tsconfig.audioSfx.json"
AUDIO_SFX_ENTRY="$AUDIO_SFX_DIR/src/lib/__tests__/store/audioManagerSfx.check.js"

echo "--- audioManagerSfx.check.ts ---"
if npx tsc -p "$AUDIO_SFX_TSCONFIG" --outDir "$AUDIO_SFX_DIR" && [ -f "$AUDIO_SFX_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$AUDIO_SFX_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$AUDIO_SFX_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: audioManagerSfx.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$AUDIO_SFX_DIR"

# src/lib/__tests__/store/useLiveFollowerStoreRace.check.ts は、useLiveFollowerStore.ts
# （"@/..."エイリアス・実際のSupabaseクライアント生成を含む）を本番と同じ実装のまま
# importして検証するため、上のCHECK_FILESループ（-maxdepth 1、素のtsc起動）とは別に、
# 専用のtsconfig（パスエイリアス解決込み）とrequireフック（pathAliasHook.js）を使って
# 個別にコンパイル・実行する。
FOLLOWER_RACE_DIR="$(mktemp -d)"
FOLLOWER_RACE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.followerRace.json"
FOLLOWER_RACE_ENTRY="$FOLLOWER_RACE_DIR/src/lib/__tests__/store/useLiveFollowerStoreRace.check.js"

echo "--- useLiveFollowerStoreRace.check.ts ---"
if npx tsc -p "$FOLLOWER_RACE_TSCONFIG" --outDir "$FOLLOWER_RACE_DIR" && [ -f "$FOLLOWER_RACE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$FOLLOWER_RACE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$FOLLOWER_RACE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveFollowerStoreRace.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$FOLLOWER_RACE_DIR"

# useLiveFollowerStore.subscribe() の認証連動（未認証では取得・購読・tickを開始しない、
# ログアウト・再ログインの世代管理）と、組切替時の追い越し(superseded)を取得失敗として
# 扱わないことの検証。専用tsconfig経由（理由はuseLiveFollowerStoreRace.check.tsと同じ）。
FOLLOWER_AUTH_GATE_DIR="$(mktemp -d)"
FOLLOWER_AUTH_GATE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.followerAuthGate.json"
FOLLOWER_AUTH_GATE_ENTRY="$FOLLOWER_AUTH_GATE_DIR/src/lib/__tests__/store/useLiveFollowerStoreAuthGate.check.js"

echo "--- useLiveFollowerStoreAuthGate.check.ts ---"
if npx tsc -p "$FOLLOWER_AUTH_GATE_TSCONFIG" --outDir "$FOLLOWER_AUTH_GATE_DIR" && [ -f "$FOLLOWER_AUTH_GATE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$FOLLOWER_AUTH_GATE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$FOLLOWER_AUTH_GATE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveFollowerStoreAuthGate.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$FOLLOWER_AUTH_GATE_DIR"

# 司会画面：ライブ終了(closeLive)後に「状態を確認中…」のまま止まらないことの検証
# （復旧中のinitが終了処理に追い越されてもloadingを解除する）。専用tsconfig経由。
HOST_CLOSE_DIR="$(mktemp -d)"
HOST_CLOSE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.hostCloseLive.json"
HOST_CLOSE_ENTRY="$HOST_CLOSE_DIR/src/lib/__tests__/store/useLiveHostStoreCloseLive.check.js"

echo "--- useLiveHostStoreCloseLive.check.ts ---"
if npx tsc -p "$HOST_CLOSE_TSCONFIG" --outDir "$HOST_CLOSE_DIR" && [ -f "$HOST_CLOSE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$HOST_CLOSE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$HOST_CLOSE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveHostStoreCloseLive.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$HOST_CLOSE_DIR"

# ステージング誤接続時の運営操作防止(assertStagingOperationAllowed)を、
# useLiveHostStoreの全運営書き込み（openReception/setAccessRestricted/closeLive/
# emergencyCloseLive/自動進行のtick）へ実際に呼び出して検証する。専用tsconfig経由。
HOST_STAGING_GUARD_DIR="$(mktemp -d)"
HOST_STAGING_GUARD_TSCONFIG="$SCRIPT_DIR/store/tsconfig.hostStagingGuard.json"
HOST_STAGING_GUARD_ENTRY="$HOST_STAGING_GUARD_DIR/src/lib/__tests__/store/useLiveHostStoreStagingGuard.check.js"

echo "--- useLiveHostStoreStagingGuard.check.ts ---"
if npx tsc -p "$HOST_STAGING_GUARD_TSCONFIG" --outDir "$HOST_STAGING_GUARD_DIR" && [ -f "$HOST_STAGING_GUARD_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$HOST_STAGING_GUARD_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$HOST_STAGING_GUARD_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveHostStoreStagingGuard.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$HOST_STAGING_GUARD_DIR"

# ステージング誤接続時の運営操作防止：useLiveFollowerStore.tsの観客側補助tick
# （tickIfNeeded→advance_live_progress_if_due）へ実際に呼び出して検証する。専用tsconfig経由。
FOLLOWER_STAGING_GUARD_DIR="$(mktemp -d)"
FOLLOWER_STAGING_GUARD_TSCONFIG="$SCRIPT_DIR/store/tsconfig.followerStagingGuard.json"
FOLLOWER_STAGING_GUARD_ENTRY="$FOLLOWER_STAGING_GUARD_DIR/src/lib/__tests__/store/useLiveFollowerStoreStagingGuard.check.js"

echo "--- useLiveFollowerStoreStagingGuard.check.ts ---"
if npx tsc -p "$FOLLOWER_STAGING_GUARD_TSCONFIG" --outDir "$FOLLOWER_STAGING_GUARD_DIR" && [ -f "$FOLLOWER_STAGING_GUARD_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$FOLLOWER_STAGING_GUARD_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$FOLLOWER_STAGING_GUARD_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveFollowerStoreStagingGuard.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$FOLLOWER_STAGING_GUARD_DIR"

# ステージング誤接続時の運営操作防止：useLiveBotStore.addBots（ボットのログイン・
# プロフィール更新・参加RPC）へ実際に呼び出して検証する。専用tsconfig経由。
BOT_STAGING_GUARD_DIR="$(mktemp -d)"
BOT_STAGING_GUARD_TSCONFIG="$SCRIPT_DIR/store/tsconfig.botStagingGuard.json"
BOT_STAGING_GUARD_ENTRY="$BOT_STAGING_GUARD_DIR/src/lib/__tests__/store/useLiveBotStoreStagingGuard.check.js"

echo "--- useLiveBotStoreStagingGuard.check.ts ---"
if npx tsc -p "$BOT_STAGING_GUARD_TSCONFIG" --outDir "$BOT_STAGING_GUARD_DIR" && [ -f "$BOT_STAGING_GUARD_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$BOT_STAGING_GUARD_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$BOT_STAGING_GUARD_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveBotStoreStagingGuard.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$BOT_STAGING_GUARD_DIR"

# ステージング誤接続時の運営操作防止：/live/host StagingTestersPanelが使う
# grantStagingTester/revokeStagingTester（src/lib/stagingTesterActions.ts）へ
# 実際に呼び出して検証する。専用tsconfig経由。
TESTER_STAGING_GUARD_DIR="$(mktemp -d)"
TESTER_STAGING_GUARD_TSCONFIG="$SCRIPT_DIR/store/tsconfig.stagingTesterActions.json"
TESTER_STAGING_GUARD_ENTRY="$TESTER_STAGING_GUARD_DIR/src/lib/__tests__/store/stagingTesterActionsStagingGuard.check.js"

echo "--- stagingTesterActionsStagingGuard.check.ts ---"
if npx tsc -p "$TESTER_STAGING_GUARD_TSCONFIG" --outDir "$TESTER_STAGING_GUARD_DIR" && [ -f "$TESTER_STAGING_GUARD_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$TESTER_STAGING_GUARD_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$TESTER_STAGING_GUARD_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: stagingTesterActionsStagingGuard.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$TESTER_STAGING_GUARD_DIR"

# 第3段階修正：host_add_next_roundを「組ごとに1件のお題」仕様へ変更したことに伴う、
# useLiveHostStore.addNextRoundのp_topics(group_id/topic_body対応)配線検証。専用tsconfig経由。
HOST_ADD_ROUND_DIR="$(mktemp -d)"
HOST_ADD_ROUND_TSCONFIG="$SCRIPT_DIR/store/tsconfig.hostAddNextRound.json"
HOST_ADD_ROUND_ENTRY="$HOST_ADD_ROUND_DIR/src/lib/__tests__/store/useLiveHostStoreAddNextRound.check.js"

echo "--- useLiveHostStoreAddNextRound.check.ts ---"
if npx tsc -p "$HOST_ADD_ROUND_TSCONFIG" --outDir "$HOST_ADD_ROUND_DIR" && [ -f "$HOST_ADD_ROUND_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$HOST_ADD_ROUND_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$HOST_ADD_ROUND_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveHostStoreAddNextRound.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$HOST_ADD_ROUND_DIR"

# src/lib/__tests__/store/useLiveFollowerStoreJoinReferral.check.ts も同じ理由
# （useLiveFollowerStore.ts/useProfileStore.tsが"@/..."エイリアス・実際の
# Supabaseクライアント生成を含む）で専用tsconfig経由にする。2026-09-22
# レビュー対応：joinLive成功後にrefreshProfileを呼ぶこと（ゲストは対象外、
# 失敗しても参加自体を失敗扱いにしない、生のDBエラーをerrorへ入れない）を検証する。
FOLLOWER_JOIN_REFERRAL_DIR="$(mktemp -d)"
FOLLOWER_JOIN_REFERRAL_TSCONFIG="$SCRIPT_DIR/store/tsconfig.followerJoinReferral.json"
FOLLOWER_JOIN_REFERRAL_ENTRY="$FOLLOWER_JOIN_REFERRAL_DIR/src/lib/__tests__/store/useLiveFollowerStoreJoinReferral.check.js"

echo "--- useLiveFollowerStoreJoinReferral.check.ts ---"
if npx tsc -p "$FOLLOWER_JOIN_REFERRAL_TSCONFIG" --outDir "$FOLLOWER_JOIN_REFERRAL_DIR" && [ -f "$FOLLOWER_JOIN_REFERRAL_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$FOLLOWER_JOIN_REFERRAL_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$FOLLOWER_JOIN_REFERRAL_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveFollowerStoreJoinReferral.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$FOLLOWER_JOIN_REFERRAL_DIR"

# src/lib/__tests__/store/useLiveFollowerStoreAnswerScore.check.ts も同じ理由
# （useLiveFollowerStore.tsが"@/..."エイリアス・実際のSupabaseクライアント生成を
# 含む）で専用tsconfig経由にする。第2段階（本番・体験版/撮影モードの画面共通化）
# レビュー対応：共用表示部品から渡されるonSubmit/onScoreの到達先である
# submitMyAnswer/submitMyScoreを「本番と同じ実装のまま」呼び出し、引数・回数・
# Supabaseへの書き込み内容が共通化の前後で変わっていないことを検証する。
FOLLOWER_ANSWER_SCORE_DIR="$(mktemp -d)"
FOLLOWER_ANSWER_SCORE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.followerAnswerScore.json"
FOLLOWER_ANSWER_SCORE_ENTRY="$FOLLOWER_ANSWER_SCORE_DIR/src/lib/__tests__/store/useLiveFollowerStoreAnswerScore.check.js"

echo "--- useLiveFollowerStoreAnswerScore.check.ts ---"
if npx tsc -p "$FOLLOWER_ANSWER_SCORE_TSCONFIG" --outDir "$FOLLOWER_ANSWER_SCORE_DIR" && [ -f "$FOLLOWER_ANSWER_SCORE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$FOLLOWER_ANSWER_SCORE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$FOLLOWER_ANSWER_SCORE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveFollowerStoreAnswerScore.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$FOLLOWER_ANSWER_SCORE_DIR"

# src/lib/__tests__/store/stagingEnvDynamic.check.ts も同じ理由（src/lib/stagingEnv.tsが
# "@/lib/supabase"を実際にimportする）で専用tsconfig経由にする。第3段階
# （ステージング運営環境）：appEnv判定・Project Refの抜き出し・一致判定を実行して検証する。
STAGING_ENV_DYNAMIC_DIR="$(mktemp -d)"
STAGING_ENV_DYNAMIC_TSCONFIG="$SCRIPT_DIR/store/tsconfig.stagingEnvDynamic.json"
STAGING_ENV_DYNAMIC_ENTRY="$STAGING_ENV_DYNAMIC_DIR/src/lib/__tests__/store/stagingEnvDynamic.check.js"

echo "--- stagingEnvDynamic.check.ts ---"
if npx tsc -p "$STAGING_ENV_DYNAMIC_TSCONFIG" --outDir "$STAGING_ENV_DYNAMIC_DIR" && [ -f "$STAGING_ENV_DYNAMIC_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$STAGING_ENV_DYNAMIC_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$STAGING_ENV_DYNAMIC_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: stagingEnvDynamic.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$STAGING_ENV_DYNAMIC_DIR"

# src/lib/__tests__/store/useLiveFollowerStoreReactionQueue.check.ts も同じ理由
# （useLiveFollowerStore.tsが"@/..."エイリアス・実際のSupabaseクライアント生成を
# 含む）で専用tsconfig経由にする。0068のツッコミ/拍手/爆笑キュー方式（過負荷対策込み）を検証する。
REACTION_QUEUE_DIR="$(mktemp -d)"
REACTION_QUEUE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.reactionQueue.json"
REACTION_QUEUE_ENTRY="$REACTION_QUEUE_DIR/src/lib/__tests__/store/useLiveFollowerStoreReactionQueue.check.js"

echo "--- useLiveFollowerStoreReactionQueue.check.ts ---"
if npx tsc -p "$REACTION_QUEUE_TSCONFIG" --outDir "$REACTION_QUEUE_DIR" && [ -f "$REACTION_QUEUE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$REACTION_QUEUE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$REACTION_QUEUE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useLiveFollowerStoreReactionQueue.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$REACTION_QUEUE_DIR"

# src/lib/__tests__/store/useSnsStoreDelete.check.ts も同じ理由（useSnsStore.tsが
# "@/..."エイリアス・実際のSupabaseクライアント生成を含む）で専用tsconfig経由にする。
SNS_DELETE_DIR="$(mktemp -d)"
SNS_DELETE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.snsDelete.json"
SNS_DELETE_ENTRY="$SNS_DELETE_DIR/src/lib/__tests__/store/useSnsStoreDelete.check.js"

echo "--- useSnsStoreDelete.check.ts ---"
if npx tsc -p "$SNS_DELETE_TSCONFIG" --outDir "$SNS_DELETE_DIR" && [ -f "$SNS_DELETE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$SNS_DELETE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$SNS_DELETE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useSnsStoreDelete.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$SNS_DELETE_DIR"

# src/lib/__tests__/store/useAuthStoreGuest.check.ts も同じ理由（useAuthStore.tsが
# "@/..."エイリアス・実際のSupabaseクライアント生成を含む）で専用tsconfig経由にする。
# 0070（ゲスト参加）のsignInAsGuestのsingle-flightガード・失敗時の日本語文言化を検証する。
AUTH_GUEST_DIR="$(mktemp -d)"
AUTH_GUEST_TSCONFIG="$SCRIPT_DIR/store/tsconfig.authGuest.json"
AUTH_GUEST_ENTRY="$AUTH_GUEST_DIR/src/lib/__tests__/store/useAuthStoreGuest.check.js"

echo "--- useAuthStoreGuest.check.ts ---"
if npx tsc -p "$AUTH_GUEST_TSCONFIG" --outDir "$AUTH_GUEST_DIR" && [ -f "$AUTH_GUEST_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$AUTH_GUEST_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$AUTH_GUEST_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useAuthStoreGuest.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$AUTH_GUEST_DIR"

# src/lib/__tests__/store/useAuthStoreXSwitch.check.ts も同じ理由（useAuthStore.tsが
# "@/..."エイリアス・実際のSupabaseクライアント生成を含む）で専用tsconfig経由にする。
# 0071（0070ゲスト参加レビュー対応）のsignInWithXの新仕様（isGuestSwitch時だけ確認
# ダイアログ+signOut・xSigningInのsingle-flightガード・失敗時の日本語文言化）を検証する。
AUTH_XSWITCH_DIR="$(mktemp -d)"
AUTH_XSWITCH_TSCONFIG="$SCRIPT_DIR/store/tsconfig.authXSwitch.json"
AUTH_XSWITCH_ENTRY="$AUTH_XSWITCH_DIR/src/lib/__tests__/store/useAuthStoreXSwitch.check.js"

echo "--- useAuthStoreXSwitch.check.ts ---"
if npx tsc -p "$AUTH_XSWITCH_TSCONFIG" --outDir "$AUTH_XSWITCH_DIR" && [ -f "$AUTH_XSWITCH_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$AUTH_XSWITCH_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$AUTH_XSWITCH_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useAuthStoreXSwitch.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$AUTH_XSWITCH_DIR"

# src/lib/__tests__/store/useProfileStoreSwitch.check.ts も同じ理由
# （useAuthStore.ts/useProfileStore.tsが"@/..."エイリアス・実際のSupabaseクライアント
# 生成を含む）で専用tsconfig経由にする。2026-09-13再レビュー対応：ログイン中ユーザーの
# 切り替え（会員A→会員B、会員A→ゲスト、連続切り替え）で、前の利用者のprofileが
# 一瞬でも残らないことを検証する。
PROFILE_SWITCH_DIR="$(mktemp -d)"
PROFILE_SWITCH_TSCONFIG="$SCRIPT_DIR/store/tsconfig.profileSwitch.json"
PROFILE_SWITCH_ENTRY="$PROFILE_SWITCH_DIR/src/lib/__tests__/store/useProfileStoreSwitch.check.js"

echo "--- useProfileStoreSwitch.check.ts ---"
if npx tsc -p "$PROFILE_SWITCH_TSCONFIG" --outDir "$PROFILE_SWITCH_DIR" && [ -f "$PROFILE_SWITCH_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$PROFILE_SWITCH_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$PROFILE_SWITCH_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useProfileStoreSwitch.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$PROFILE_SWITCH_DIR"

# src/lib/__tests__/store/useSnsStoreGuestGuard.check.ts も同じ理由
# （useSnsStore.tsが"@/..."エイリアス・実際のSupabaseクライアント生成を含む）で
# 専用tsconfig経由にする。2026-09-13再レビュー対応：寄合帳の全変更操作
# （お題投稿・回答投稿・ツッコミ投稿・削除・いいね・フォロー）がゲストに対しては
# supabase.rpc/supabase.fromへ一切リクエストせず即座に拒否することを検証する。
SNS_GUEST_GUARD_DIR="$(mktemp -d)"
SNS_GUEST_GUARD_TSCONFIG="$SCRIPT_DIR/store/tsconfig.snsGuestGuard.json"
SNS_GUEST_GUARD_ENTRY="$SNS_GUEST_GUARD_DIR/src/lib/__tests__/store/useSnsStoreGuestGuard.check.js"

echo "--- useSnsStoreGuestGuard.check.ts ---"
if npx tsc -p "$SNS_GUEST_GUARD_TSCONFIG" --outDir "$SNS_GUEST_GUARD_DIR" && [ -f "$SNS_GUEST_GUARD_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$SNS_GUEST_GUARD_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$SNS_GUEST_GUARD_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useSnsStoreGuestGuard.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$SNS_GUEST_GUARD_DIR"

# src/lib/__tests__/store/useProfileStoreUpdate.check.ts も同じ理由で専用tsconfig
# 経由にする。2026-09-13再レビュー対応：updateDisplayName/updateAvatar/updateBioが
# ゲスト・authUserとprofileのid不一致を拒否し、RLSで0件更新だった場合は成功扱いに
# せず、失敗時は生のDBエラーを含まない固定の日本語文言を返すことを検証する。
PROFILE_UPDATE_DIR="$(mktemp -d)"
PROFILE_UPDATE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.profileUpdate.json"
PROFILE_UPDATE_ENTRY="$PROFILE_UPDATE_DIR/src/lib/__tests__/store/useProfileStoreUpdate.check.js"

echo "--- useProfileStoreUpdate.check.ts ---"
if npx tsc -p "$PROFILE_UPDATE_TSCONFIG" --outDir "$PROFILE_UPDATE_DIR" && [ -f "$PROFILE_UPDATE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$PROFILE_UPDATE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$PROFILE_UPDATE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useProfileStoreUpdate.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$PROFILE_UPDATE_DIR"

# src/lib/__tests__/store/useSnsStoreSwitch.check.ts も同じ理由で専用tsconfig
# 経由にする。2026-09-13再々レビュー対応：寄合帳ストア（useSnsStore.ts）が
# 認証userIdの切り替え（ゲスト→Xログイン、会員A→会員B、会員→ログアウト）に
# 対応し、authorId:"me"変換・いいね済み状態・フォロー状態・フォロワー数を
# 作り直すこと、取得中に別ユーザーへ切り替わった場合は遅れて届いた古い世代の
# 結果がstateに混ざらないことを検証する。
SNS_SWITCH_DIR="$(mktemp -d)"
SNS_SWITCH_TSCONFIG="$SCRIPT_DIR/store/tsconfig.snsSwitch.json"
SNS_SWITCH_ENTRY="$SNS_SWITCH_DIR/src/lib/__tests__/store/useSnsStoreSwitch.check.js"

echo "--- useSnsStoreSwitch.check.ts ---"
if npx tsc -p "$SNS_SWITCH_TSCONFIG" --outDir "$SNS_SWITCH_DIR" && [ -f "$SNS_SWITCH_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$SNS_SWITCH_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$SNS_SWITCH_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useSnsStoreSwitch.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$SNS_SWITCH_DIR"

# src/lib/__tests__/store/useSnsLiveResultsStoreSwitch.check.ts も同じ理由で
# 専用tsconfig経由にする。2026-09-13再々レビュー2回目対応：
# useSnsLiveResultsStore.tsのlastSeenUserIdが、既に認証確定済みの状態で
# モジュールが読み込まれた場合でも正しく初期値化されること、および古い世代の
# fetchDetail/addCommentが新しい世代の同じID宛てのpendingを誤って解除しない
# ことを検証する。
SNS_LIVE_RESULTS_SWITCH_DIR="$(mktemp -d)"
SNS_LIVE_RESULTS_SWITCH_TSCONFIG="$SCRIPT_DIR/store/tsconfig.snsLiveResultsSwitch.json"
SNS_LIVE_RESULTS_SWITCH_ENTRY="$SNS_LIVE_RESULTS_SWITCH_DIR/src/lib/__tests__/store/useSnsLiveResultsStoreSwitch.check.js"

echo "--- useSnsLiveResultsStoreSwitch.check.ts ---"
if npx tsc -p "$SNS_LIVE_RESULTS_SWITCH_TSCONFIG" --outDir "$SNS_LIVE_RESULTS_SWITCH_DIR" && [ -f "$SNS_LIVE_RESULTS_SWITCH_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$SNS_LIVE_RESULTS_SWITCH_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$SNS_LIVE_RESULTS_SWITCH_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useSnsLiveResultsStoreSwitch.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$SNS_LIVE_RESULTS_SWITCH_DIR"

# src/lib/__tests__/store/useSnsLiveResultsStoreRanking.check.ts：ライブ結果一覧の
# 同順位タイ表示、及び詳細画面の順位→参加者→お題→回答の階層ソートを、本番と同じ
# 実装(init()/fetchDetail())へ実際に呼び出して検証する。専用tsconfig経由。
SNS_LIVE_RESULTS_RANKING_DIR="$(mktemp -d)"
SNS_LIVE_RESULTS_RANKING_TSCONFIG="$SCRIPT_DIR/store/tsconfig.snsLiveResultsRanking.json"
SNS_LIVE_RESULTS_RANKING_ENTRY="$SNS_LIVE_RESULTS_RANKING_DIR/src/lib/__tests__/store/useSnsLiveResultsStoreRanking.check.js"

echo "--- useSnsLiveResultsStoreRanking.check.ts ---"
if npx tsc -p "$SNS_LIVE_RESULTS_RANKING_TSCONFIG" --outDir "$SNS_LIVE_RESULTS_RANKING_DIR" && [ -f "$SNS_LIVE_RESULTS_RANKING_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$SNS_LIVE_RESULTS_RANKING_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$SNS_LIVE_RESULTS_RANKING_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useSnsLiveResultsStoreRanking.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$SNS_LIVE_RESULTS_RANKING_DIR"

# src/lib/__tests__/store/useSnsLiveResultsStoreCommentDelete.check.ts：ライブ結果
# コメントの自己削除(deleteComment)を、本番と同じ実装へ実際に呼び出して検証する。
# 専用tsconfig経由。
SNS_LIVE_RESULTS_COMMENT_DELETE_DIR="$(mktemp -d)"
SNS_LIVE_RESULTS_COMMENT_DELETE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.snsLiveResultsCommentDelete.json"
SNS_LIVE_RESULTS_COMMENT_DELETE_ENTRY="$SNS_LIVE_RESULTS_COMMENT_DELETE_DIR/src/lib/__tests__/store/useSnsLiveResultsStoreCommentDelete.check.js"

echo "--- useSnsLiveResultsStoreCommentDelete.check.ts ---"
if npx tsc -p "$SNS_LIVE_RESULTS_COMMENT_DELETE_TSCONFIG" --outDir "$SNS_LIVE_RESULTS_COMMENT_DELETE_DIR" && [ -f "$SNS_LIVE_RESULTS_COMMENT_DELETE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$SNS_LIVE_RESULTS_COMMENT_DELETE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$SNS_LIVE_RESULTS_COMMENT_DELETE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useSnsLiveResultsStoreCommentDelete.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$SNS_LIVE_RESULTS_COMMENT_DELETE_DIR"

# src/lib/__tests__/store/useSnsStoreMutationRace.check.ts も同じ理由で専用
# tsconfig経由にする。2026-09-13再々レビュー2回目対応：addTopic/addAnswer/
# addComment/deleteTopic/deleteAnswer/deleteCommentが、Supabase待機中に
# A→Bへ切り替わった場合、Aの遅延結果をBのローカルstateへ一切反映しない
# （"me"として混ざらない・Bの一覧から削除しない）ことを検証する。
SNS_MUTATION_RACE_DIR="$(mktemp -d)"
SNS_MUTATION_RACE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.snsMutationRace.json"
SNS_MUTATION_RACE_ENTRY="$SNS_MUTATION_RACE_DIR/src/lib/__tests__/store/useSnsStoreMutationRace.check.js"

echo "--- useSnsStoreMutationRace.check.ts ---"
if npx tsc -p "$SNS_MUTATION_RACE_TSCONFIG" --outDir "$SNS_MUTATION_RACE_DIR" && [ -f "$SNS_MUTATION_RACE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$SNS_MUTATION_RACE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$SNS_MUTATION_RACE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useSnsStoreMutationRace.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$SNS_MUTATION_RACE_DIR"

# src/lib/__tests__/store/useConsentGateStore.check.ts も同じ理由（useAuthStore.tsが
# "@/..."エイリアス・実際のSupabaseクライアント生成を含む）で専用tsconfig経由にする。
# 2026-09-25（利用規約同意ゲート対応）：未同意/同意済み/旧バージョン/キャンセルの
# 各状態遷移で、実際のsignInWithX/signInAsGuestを呼ぶかどうか・localStorageへの
# 記録が正しく行われるかを検証する。
CONSENT_GATE_DIR="$(mktemp -d)"
CONSENT_GATE_TSCONFIG="$SCRIPT_DIR/store/tsconfig.consentGate.json"
CONSENT_GATE_ENTRY="$CONSENT_GATE_DIR/src/lib/__tests__/store/useConsentGateStore.check.js"

echo "--- useConsentGateStore.check.ts ---"
if npx tsc -p "$CONSENT_GATE_TSCONFIG" --outDir "$CONSENT_GATE_DIR" && [ -f "$CONSENT_GATE_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$CONSENT_GATE_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$CONSENT_GATE_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useConsentGateStore.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi

AUDIENCE_JOIN_DIR="$(mktemp -d)"
AUDIENCE_JOIN_TSCONFIG="$SCRIPT_DIR/store/tsconfig.audienceJoin.json"
AUDIENCE_JOIN_ENTRY="$AUDIENCE_JOIN_DIR/src/lib/__tests__/store/audienceJoinFlow.check.js"

echo "--- audienceJoinFlow.check.ts ---"
if npx tsc -p "$AUDIENCE_JOIN_TSCONFIG" --outDir "$AUDIENCE_JOIN_DIR" && [ -f "$AUDIENCE_JOIN_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$AUDIENCE_JOIN_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$AUDIENCE_JOIN_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: audienceJoinFlow.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$CONSENT_GATE_DIR" "$AUDIENCE_JOIN_DIR"

# useFirstLiveRewardStore.ts（本番ライブ#0001〜#0005の限定特典、supabase/migrations/0081・0084）も
# 同じ理由で専用tsconfig経由にする。
FIRST_LIVE_REWARD_DIR="$(mktemp -d)"
FIRST_LIVE_REWARD_TSCONFIG="$SCRIPT_DIR/store/tsconfig.firstLiveReward.json"
FIRST_LIVE_REWARD_ENTRY="$FIRST_LIVE_REWARD_DIR/src/lib/__tests__/store/useFirstLiveRewardStore.check.js"

echo "--- useFirstLiveRewardStore.check.ts ---"
if npx tsc -p "$FIRST_LIVE_REWARD_TSCONFIG" --outDir "$FIRST_LIVE_REWARD_DIR" && [ -f "$FIRST_LIVE_REWARD_ENTRY" ]; then
  if ! STORE_CHECK_OUT_DIR="$FIRST_LIVE_REWARD_DIR" \
    STORE_CHECK_REPO_ROOT="$REPO_ROOT" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-test-key-for-local-check" \
    node -r "$SCRIPT_DIR/pathAliasHook.js" "$FIRST_LIVE_REWARD_ENTRY"; then
    FAILED=1
  fi
else
  echo "FAIL: useFirstLiveRewardStore.check.ts のコンパイルに失敗、または出力が見つかりません" >&2
  FAILED=1
fi
rm -rf "$FIRST_LIVE_REWARD_DIR"

exit $FAILED
