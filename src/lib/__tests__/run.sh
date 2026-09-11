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

exit $FAILED
