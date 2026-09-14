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
  "$SCRIPT_DIR/../snsLiveResultPreview.ts"
  "$SCRIPT_DIR/../liveGuestAccess.ts"
  "$SCRIPT_DIR/../guestStatus.ts"
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

exit $FAILED
