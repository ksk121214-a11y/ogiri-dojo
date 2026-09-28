#!/usr/bin/env bash
# 0083「世代付き同意RPCへの切替」専用のワンコマンドランナー。
#
# supabase/tests/run.sh は0001〜現在の全マイグレーションを適用してから
# *.test.sqlを実行する構造のため、「0083がまだ適用されていない状態で、新しい
# フロントエンド（record_terms_consent_v2を呼ぶ）を動かすとどうなるか」という、
# マイグレーション適用順そのものに依存するシナリオ（新アプリ＋旧DB）を検証
# できない。このスクリプトは専用に、
#   1. 使い捨てDBを作成
#   2. シム(auth スキーマ・ロール・標準権限)を適用
#   3. supabase_realtime publicationを作成
#   4. supabase/migrations/のうち0001〜0082まで（0083は含まない）を番号順に適用
#   5. 【新アプリ＋旧DB】この時点でrecord_terms_consent_v2がまだ存在しないこと
#      （カタログ・実際の呼び出し双方）、呼び出しても同意行が一切作られないこと
#      を確認する
#   6. supabase/migrations/0083_legal_short_video_consent.sql を適用
#   7. 適用後、record_terms_consent_v2が新しい現在バージョンで正常に動作する
#      ことを確認する（0083適用前後の遷移そのものを1つのDBで通して確認する）
# を行う。安全対策（使い捨てDB・接続先未指定ならローカルのデフォルト接続・
# 実行後は必ずdropdb）はsupabase/tests/run.shと同じ考え方を踏襲する。
# 本番のSupabaseプロジェクトに対しては絶対に実行しないこと。
#
# 使い方：
#   supabase/tests/run_0083_consent_migration_test.sh
#   supabase/tests/run_0083_consent_migration_test.sh postgresql://user:pass@localhost:5432/postgres

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
SHIM_FILE="$SCRIPT_DIR/fixtures/local_supabase_shim.sql"
POST_0083_MIGRATION="$MIGRATIONS_DIR/0083_legal_short_video_consent.sql"

CONN="${1:-${SUPABASE_TEST_DB_URL:-}}"
DB_NAME="ogiridojo_0083migtest_$$"

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

echo "==> migrationsを0001〜0082まで番号順に適用（0083は含まない、${MIGRATIONS_DIR}）"
shopt -s nullglob
for f in "$MIGRATIONS_DIR"/0*.sql; do
  base="$(basename "$f")"
  num="${base%%_*}"
  if (( 10#$num > 82 )); then
    continue
  fi
  echo "   - $base"
  psql "${PSQL_ARGS[@]}" -f "$f" >/dev/null
done
shopt -u nullglob

echo "==> 【新アプリ＋旧DB】0083適用前：record_terms_consent_v2がまだ存在しないことを確認"
psql "${PSQL_ARGS[@]}" <<'SQL'
insert into auth.users (id) values ('08300000-0000-0000-0000-00000000b001')
on conflict do nothing;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_proc where proname = 'record_terms_consent_v2';
  if v_count <> 0 then
    raise exception 'FAIL: 0083を適用していないのにrecord_terms_consent_v2が既に存在する';
  end if;
  raise notice 'PASS: 0083未適用の間は、record_terms_consent_v2はカタログ上に一切存在しない';
end $$;

-- 新アプリ（record_terms_consent_v2しか呼ばない設計）がこの状態で同意を記録
-- しようとすると、DB側が「関数が存在しない」という明確なエラーを返して失敗する
-- （フロントエンドはこれをtry/catchで捕捉し、未処理Promiseにはしない。
-- src/store/useConsentGateStore.ts・src/components/app/ConsentRequiredGate.tsxの
-- 実装、及びsrc/lib/__tests__/store/useConsentGateStore.check.tsの例外系テストで
-- 別途確認済み）。ここではDB側が曖昧な成功や誤ったバージョンの記録を返さず、
-- 常に明確な失敗を返すことだけを確認する。
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08300000-0000-0000-0000-00000000b001', true);
  begin
    perform public.record_terms_consent_v2('2026-09-28-v2', '2026-09-28-v3');
    raise exception 'FAIL: 0083未適用なのにrecord_terms_consent_v2が呼び出せてしまった';
  exception
    when undefined_function then
      raise notice 'PASS: 0083未適用の間、新アプリがrecord_terms_consent_v2を呼んでも明確に失敗する（undefined_function、曖昧な成功や誤ったバージョンの記録にはならない）';
  end;
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.terms_consents where user_id = '08300000-0000-0000-0000-00000000b001';
  if v_count <> 0 then
    raise exception 'FAIL: 存在しないRPCの呼び出しにも関わらず同意行が作られてしまった(count=%)', v_count;
  end if;
  raise notice 'PASS: 0083未適用の間、新アプリの同意試行はv1/v2・v2/v3いずれの行も作らない（誤った同意済み扱いにならない）';
end $$;
SQL

echo "==> 0083を適用（${POST_0083_MIGRATION}）"
psql "${PSQL_ARGS[@]}" -f "$POST_0083_MIGRATION" >/dev/null

echo "==> 0083適用後：同じDB・同じ利用者でrecord_terms_consent_v2が正常に動作することを確認"
psql "${PSQL_ARGS[@]}" <<'SQL'
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', '08300000-0000-0000-0000-00000000b001', true);
  perform public.record_terms_consent_v2('2026-09-28-v2', '2026-09-28-v3');
end $$;
reset role;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.terms_consents
    where user_id = '08300000-0000-0000-0000-00000000b001'
      and terms_version = '2026-09-28-v2' and privacy_version = '2026-09-28-v3';
  if v_count <> 1 then
    raise exception 'FAIL: 0083適用後にrecord_terms_consent_v2が正しく記録しなかった(count=%)', v_count;
  end if;
  raise notice 'PASS: 0083適用後は、同じ利用者が改めて同意すると正しく現在バージョンで記録される（新RPCの存在自体が0083適用と共にアトミックに切り替わる）';
end $$;
SQL

echo "==> 完了：0083の世代付き同意RPC切替（新アプリ＋旧DBで新RPCが安全に失敗し、0083適用後は正常化すること）を確認しました。"
