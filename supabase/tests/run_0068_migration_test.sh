#!/usr/bin/env bash
# 0068「既存ライブの実移行」専用のワンコマンドランナー。
#
# supabase/tests/run.sh は0001〜現在の全マイグレーションを適用してから
# *.test.sqlを実行する構造のため、「0068適用前の状態を作ってから0068を適用する」
# という順序のテスト（＝0068のUPDATE文が既存の本番ライブ行を正しく移行し、かつ
# 紐づく他テーブル・ポイントに一切副作用を及ぼさないことの確認）ができない。
# このスクリプトは専用に、
#   1. 使い捨てDBを作成
#   2. シム(auth スキーマ・ロール・標準権限)を適用
#   3. supabase_realtime publicationを作成
#   4. supabase/migrations/のうち0001〜0067まで（0068は含まない）を番号順に適用
#   5. supabase/tests/fixtures/0068_pre_migration_seed.sql で「0068適用前の
#      古い」状態（本番ライブ・回答・sns_live_results・point_history・
#      プロフィールのポイント等）を再現
#   6. supabase/migrations/0068_live_mode_official_sequence.sql を適用
#   7. supabase/tests/fixtures/0068_pre_existing_migration.test.sql で検証
# を行う。安全対策（使い捨てDB・接続先未指定ならローカルのデフォルト接続・
# 実行後は必ずdropdb）はsupabase/tests/run.shと同じ考え方を踏襲する。
# 本番のSupabaseプロジェクトに対しては絶対に実行しないこと。
#
# 使い方：
#   supabase/tests/run_0068_migration_test.sh
#   supabase/tests/run_0068_migration_test.sh postgresql://user:pass@localhost:5432/postgres

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
FIXTURE_DIR="$SCRIPT_DIR/fixtures"
SHIM_FILE="$FIXTURE_DIR/local_supabase_shim.sql"
SEED_FILE="$FIXTURE_DIR/0068_pre_migration_seed.sql"
VERIFY_FILE="$FIXTURE_DIR/0068_pre_existing_migration.test.sql"
PRE_0068_MIGRATION="$MIGRATIONS_DIR/0068_live_mode_official_sequence.sql"

CONN="${1:-${SUPABASE_TEST_DB_URL:-}}"
DB_NAME="ogiridojo_0068migtest_$$"

PSQL_ARGS=(-v ON_ERROR_STOP=1)
CREATEDB_ARGS=()
DROPDB_ARGS=()
if [ -n "$CONN" ]; then
  BASE_CONN="${CONN%/*}"
  PSQL_ARGS+=(-d "$BASE_CONN/$DB_NAME")
  CREATEDB_ARGS+=("$BASE_CONN/$DB_NAME")
  DROPDB_ARGS+=("$BASE_CONN/$DB_NAME")
else
  PSQL_ARGS+=(-d "$DB_NAME")
  CREATEDB_ARGS+=("$DB_NAME")
  DROPDB_ARGS+=("$DB_NAME")
fi

cleanup() {
  dropdb --if-exists "${DROPDB_ARGS[@]}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> 使い捨てDBを作成: $DB_NAME"
createdb "${CREATEDB_ARGS[@]}"

echo "==> シム(auth スキーマ・ロール・標準権限)を適用"
psql "${PSQL_ARGS[@]}" -f "$SHIM_FILE"

echo "==> supabase_realtime publicationを作成（0001以降が参照するため）"
psql "${PSQL_ARGS[@]}" -c "create publication supabase_realtime;" >/dev/null

echo "==> migrationsを0001〜0067まで番号順に適用（0068以降は含まない、${MIGRATIONS_DIR}）"
shopt -s nullglob
for f in "$MIGRATIONS_DIR"/0*.sql; do
  base="$(basename "$f")"
  # ファイル名先頭の4桁番号を数値比較する（"0068_..."で始まるファイル自体を含む）。
  # 以前は"0068_*"という文字列前方一致だけで除外していたため、0069以降の新しい
  # マイグレーションが追加されると（0068より後なのに）このループに混入して
  # 「0068適用前の状態」より先に適用されてしまっていた（0068専用テストの前提が
  # 崩れる）。番号を数値として67以下かどうかで判定することで、今後0070以降が
  # 追加されても自動的にこのテストの対象から除外され続けるようにする。
  num="${base%%_*}"
  if (( 10#$num > 67 )); then
    continue
  fi
  echo "   - $base"
  psql "${PSQL_ARGS[@]}" -f "$f" >/dev/null
done
shopt -u nullglob

echo "==> 0068適用前の古い状態をseed（${SEED_FILE}）"
psql "${PSQL_ARGS[@]}" -f "$SEED_FILE"

echo "==> 0068を適用（${PRE_0068_MIGRATION}）"
psql "${PSQL_ARGS[@]}" -f "$PRE_0068_MIGRATION" >/dev/null

echo "==> 移行結果を検証（${VERIFY_FILE}）"
psql "${PSQL_ARGS[@]}" -f "$VERIFY_FILE"

echo "==> 完了：0068の既存ライブ移行専用テストが例外を出さずに完走しました。"
