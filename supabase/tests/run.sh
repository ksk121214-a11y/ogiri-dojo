#!/usr/bin/env bash
# 権限回帰テストのワンコマンドランナー。
#
# 本来はSupabase CLI（supabase start、Docker必須）＋pgTAPで実行するのが
# より本番に近い検証になるが、このリポジトリの開発環境にはDockerが無い場合がある。
# ここではpsqlだけで完結する代替手段として、実際のPostgreSQLエンジン（ローカルの
# PostgreSQL 16推奨）に対して
#   1. supabase/tests/fixtures/local_supabase_shim.sql（auth スキーマ・ロール・
#      auth.uid()のシム、anon/authenticated標準権限の再現）
#   2. supabase/migrations/0*.sql を番号順に全件
#   3. supabase/tests/*.test.sql を全件
# の順に、使い捨ての一時データベースへ流し込んで検証する。
#
# 使い方：
#   supabase/tests/run.sh
#   supabase/tests/run.sh postgresql://user:pass@localhost:5432/postgres   # 接続先を指定する場合
#
# 前提：psqlコマンドが使えること（Postgres 16推奨。createdb/dropdbも使う）。
# 本番のSupabaseプロジェクトに対しては絶対に実行しないこと
# （このスクリプトは接続先データベースを作成・削除する）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
FIXTURE_FILE="$SCRIPT_DIR/fixtures/local_supabase_shim.sql"

# 接続先（第1引数、無ければ環境変数、それも無ければローカルのデフォルト接続）。
CONN="${1:-${SUPABASE_TEST_DB_URL:-}}"
DB_NAME="ogiridojo_permtest_$$"

PSQL_ARGS=(-v ON_ERROR_STOP=1)
CREATEDB_ARGS=()
DROPDB_ARGS=()
if [ -n "$CONN" ]; then
  # 接続文字列が渡された場合、データベース名部分だけ差し替えて使う
  # （createdb/dropdbは接続文字列の最後のパスセグメントをDB名として扱う）。
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
psql "${PSQL_ARGS[@]}" -f "$FIXTURE_FILE"

echo "==> supabase_realtime publicationを作成（0001以降が参照するため）"
psql "${PSQL_ARGS[@]}" -c "create publication supabase_realtime;" >/dev/null

echo "==> migrationsを番号順に適用（${MIGRATIONS_DIR}）"
shopt -s nullglob
for f in "$MIGRATIONS_DIR"/0*.sql; do
  echo "   - $(basename "$f")"
  psql "${PSQL_ARGS[@]}" -f "$f" >/dev/null
done

echo "==> テストを実行（${SCRIPT_DIR}）"
any_test=0
for f in "$SCRIPT_DIR"/*.test.sql; do
  any_test=1
  echo "--- $(basename "$f") ---"
  psql "${PSQL_ARGS[@]}" -f "$f"
done
shopt -u nullglob

if [ "$any_test" = "0" ]; then
  echo "テストファイル(*.test.sql)が見つかりませんでした。" >&2
  exit 1
fi

echo "==> 完了：全テストファイルが例外を出さずに完走しました。"

# 0068「既存ライブの実移行」専用テストは、「0068適用前の状態を作ってから0068を
# 適用する」という、上のフロー（0001〜全件を先に適用してしまう）では検証できない
# 順序を扱うため、別の使い捨てDBを使う専用スクリプトとして追加で実行する
# （上の通常フロー自体は変更しない）。
echo "==> 追加で0068の既存ライブ移行専用テストも実行します（別の使い捨てDBを使用）"
"$SCRIPT_DIR/run_0068_migration_test.sh" "$CONN"
