#!/usr/bin/env bash
# resolveAnsweringCue()（src/lib/answeringCue.ts）の新旧revision判定を検証する
# ワンコマンドランナー。
#
# このリポジトリには自動テストランナー(vitest/jest等)が導入されていないため、
# supabase/tests/run.sh（psqlだけで完結する代替手段）と同じ考え方で、
# 一時ディレクトリへtscでコンパイルしてからnodeで直接実行する。
#
# 使い方：
#   src/lib/__tests__/run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$REPO_ROOT"

npx tsc \
  --module commonjs \
  --target es2020 \
  --moduleResolution node \
  --esModuleInterop \
  --skipLibCheck \
  --outDir "$TMP_DIR" \
  "$SCRIPT_DIR/../answeringCue.ts" \
  "$SCRIPT_DIR/answeringCueOrdering.check.ts"

# tscの出力先は、複数の入力ファイルの共通の親ディレクトリを基準に相対配置される
# （src/lib/answeringCue.ts と src/lib/__tests__/answeringCueOrdering.check.ts の
# 共通の親はsrc/libなので、出力は<TMP_DIR>/__tests__/answeringCueOrdering.check.js
# になる）。tscのバージョン差異で構造が変わっても壊れないよう、実際に生成された
# ファイルをfindで探して実行する。
CHECK_JS="$(find "$TMP_DIR" -name 'answeringCueOrdering.check.js' | head -1)"
if [ -z "$CHECK_JS" ]; then
  echo "FAIL: コンパイル後のanswerCueOrdering.check.jsが見つかりません" >&2
  exit 1
fi
node "$CHECK_JS"
