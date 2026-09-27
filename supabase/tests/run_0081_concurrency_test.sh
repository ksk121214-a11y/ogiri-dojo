#!/usr/bin/env bash
# 0081のFOR UPDATEロック（mark_final_result_presence/_apply_first_live_reward）が、
# 実際の同時実行でも安全であることを確認する専用ランナー。
#
# supabase/tests/run.sh が実行する0081_titles_and_first_live_rewards.test.sqlは、
# 単一のpsql接続内でRPCを順番に呼ぶだけのため、「本当に同時に実行された場合の
# 行ロックの効き」までは検証できない。このスクリプトは、バックグラウンドで動かす
# 複数のpsqlプロセス（＝本物の並行接続）を使って、以下の3つの競合を実際に再現する。
#   1) close_live（ライブ終了）とmark_final_result_presenceの競合：
#      final_result判定の直後にライブが終了しても、closed確定後は到達記録を作れない。
#   2) kick_participant（退場処理）とmark_final_result_presenceの競合：
#      kicked_at確認の直後に退場処分が入っても、退場確定後は到達記録を作れない。
#   3) 到達記録作成後・grant前に退場処分になった場合、grant_first_live_rewardが
#      その競合を検出して付与しない。
#
# 安全対策（使い捨てDB・接続先未指定ならローカルのデフォルト接続・実行後は必ず
# dropdb）はsupabase/tests/run.shと同じ考え方を踏襲する。
# 本番のSupabaseプロジェクトに対しては絶対に実行しないこと。
#
# 使い方：
#   supabase/tests/run_0081_concurrency_test.sh
#   supabase/tests/run_0081_concurrency_test.sh postgresql://user:pass@localhost:5432/postgres

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
SHIM_FILE="$SCRIPT_DIR/fixtures/local_supabase_shim.sql"

CONN="${1:-${SUPABASE_TEST_DB_URL:-}}"
DB_NAME="ogiridojo_0081concurrency_$$"

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

WORK_DIR="$(mktemp -d)"
cleanup() {
  dropdb --if-exists "${DROPDB_ARGS[@]}" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "==> 使い捨てDBを作成: $DB_NAME"
createdb "${CREATEDB_ARGS[@]}"

echo "==> シム(auth スキーマ・ロール・標準権限)を適用"
psql "${PSQL_ARGS[@]}" -f "$SHIM_FILE"

echo "==> supabase_realtime publicationを作成"
psql "${PSQL_ARGS[@]}" -c "create publication supabase_realtime;" >/dev/null

echo "==> migrationsを番号順に全件適用"
shopt -s nullglob
for f in "$MIGRATIONS_DIR"/0*.sql; do
  psql "${PSQL_ARGS[@]}" -f "$f" >/dev/null
done
shopt -u nullglob

USER_A="a0810000-c0c0-0000-0000-00000000a001"
LIVE_ID="a0810000-c0c0-0000-0000-00000000b001"
PARTICIPANT_ID="a0810000-c0c0-0000-0000-00000000c001"

echo "==> フィクスチャを準備"
psql "${PSQL_ARGS[@]}" <<SQL
insert into auth.users (id, is_anonymous, raw_app_meta_data) values
  ('$USER_A', false, '{"provider":"x"}'::jsonb);
insert into public.lives (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
values ('$LIVE_ID', now(), 'final_result', 'official', 1, false);
insert into public.participants (id, live_id, user_id, role, preferred_role, is_guest)
values ('$PARTICIPANT_ID', '$LIVE_ID', '$USER_A', 'player', 'player', false);
SQL

# ============================================================
# シナリオ1: close_liveとmark_final_result_presenceの真の競合。
# ============================================================
echo "==> シナリオ1: close_liveとmark_final_result_presenceの同時実行"
cat > "$WORK_DIR/close_holder.sql" <<SQL
begin;
update public.lives set current_phase = 'closed', ended_at = now() where id = '$LIVE_ID';
select pg_sleep(1.5);
commit;
SQL
cat > "$WORK_DIR/mark_attempt.sql" <<SQL
set role authenticated;
select set_config('myapp.uid', '$USER_A', false);
do \$body\$
begin
  begin
    perform public.mark_final_result_presence('$LIVE_ID', '$USER_A');
    raise exception 'FAIL: close_liveとの同時実行でも到達記録が作れてしまった';
  exception
    when others then
      if sqlerrm <> 'NOT_FINAL_RESULT_PHASE' then
        raise exception 'FAIL: 想定外のエラー(%)', sqlerrm;
      end if;
      raise notice 'PASS: close_liveとの実際の同時実行でも、行ロックによりclosed確定後はNOT_FINAL_RESULT_PHASEで到達記録を作れない';
  end;
end \$body\$;
SQL

psql "${PSQL_ARGS[@]}" -f "$WORK_DIR/close_holder.sql" > "$WORK_DIR/close_holder.log" 2>&1 &
CLOSE_PID=$!
sleep 0.5
psql "${PSQL_ARGS[@]}" -f "$WORK_DIR/mark_attempt.sql" > "$WORK_DIR/mark_attempt.log" 2>&1
wait "$CLOSE_PID"
cat "$WORK_DIR/mark_attempt.log"
grep -q "PASS: close_liveとの実際の同時実行でも" "$WORK_DIR/mark_attempt.log"

# ライブをfinal_resultへ戻す（後続シナリオ用）。
psql "${PSQL_ARGS[@]}" -c "update public.lives set current_phase = 'final_result', ended_at = null where id = '$LIVE_ID';" >/dev/null

# ============================================================
# シナリオ2: kick_participantとmark_final_result_presenceの真の競合。
# ============================================================
echo "==> シナリオ2: kick_participantとmark_final_result_presenceの同時実行"
cat > "$WORK_DIR/kick_holder.sql" <<SQL
begin;
update public.participants set kicked_at = now() where id = '$PARTICIPANT_ID';
select pg_sleep(1.5);
commit;
SQL
cat > "$WORK_DIR/mark_attempt2.sql" <<SQL
set role authenticated;
select set_config('myapp.uid', '$USER_A', false);
do \$body\$
begin
  begin
    perform public.mark_final_result_presence('$LIVE_ID', '$USER_A');
    raise exception 'FAIL: 退場処理との同時実行でも到達記録が作れてしまった';
  exception
    when others then
      if sqlerrm <> 'PARTICIPANT_KICKED' then
        raise exception 'FAIL: 想定外のエラー(%)', sqlerrm;
      end if;
      raise notice 'PASS: 退場処理との実際の同時実行でも、行ロックにより退場確定後はPARTICIPANT_KICKEDで到達記録を作れない';
  end;
end \$body\$;
SQL
psql "${PSQL_ARGS[@]}" -f "$WORK_DIR/kick_holder.sql" > "$WORK_DIR/kick_holder.log" 2>&1 &
KICK_PID=$!
sleep 0.5
psql "${PSQL_ARGS[@]}" -f "$WORK_DIR/mark_attempt2.sql" > "$WORK_DIR/mark_attempt2.log" 2>&1
wait "$KICK_PID"
cat "$WORK_DIR/mark_attempt2.log"
grep -q "PASS: 退場処理との実際の同時実行でも" "$WORK_DIR/mark_attempt2.log"

# 退場を取り消して、シナリオ3（到達記録は成功させた上でgrant直前に退場）に備える。
psql "${PSQL_ARGS[@]}" -c "update public.participants set kicked_at = null where id = '$PARTICIPANT_ID';" >/dev/null

# 到達記録を先に成功させる。
psql "${PSQL_ARGS[@]}" <<SQL
set role authenticated;
select set_config('myapp.uid', '$USER_A', false);
select public.mark_final_result_presence('$LIVE_ID', '$USER_A');
reset role;
SQL

# ============================================================
# シナリオ3: 到達記録作成後・grant前に退場処分になった場合、grantが競合を検出して
# 付与しない。
# ============================================================
echo "==> シナリオ3: 到達記録後・grant前のkick_participantとの同時実行"
cat > "$WORK_DIR/kick_holder2.sql" <<SQL
begin;
update public.participants set kicked_at = now() where id = '$PARTICIPANT_ID';
select pg_sleep(1.5);
commit;
SQL
cat > "$WORK_DIR/grant_attempt.sql" <<SQL
set role authenticated;
select set_config('myapp.uid', '$USER_A', false);
do \$body\$
declare
  v_result public.first_live_reward_result;
begin
  begin
    v_result := public.grant_first_live_reward('$LIVE_ID', '$USER_A');
    raise exception 'FAIL: 到達記録後・grant前の退場処分との同時実行でも付与できてしまった';
  exception
    when others then
      if sqlerrm <> 'PARTICIPANT_KICKED' then
        raise exception 'FAIL: 想定外のエラー(%)', sqlerrm;
      end if;
      raise notice 'PASS: 到達記録後でも、grant実行時点で行ロックにより退場確定を検出しPARTICIPANT_KICKEDで付与されない';
  end;
end \$body\$;
SQL
psql "${PSQL_ARGS[@]}" -f "$WORK_DIR/kick_holder2.sql" > "$WORK_DIR/kick_holder2.log" 2>&1 &
KICK2_PID=$!
sleep 0.5
psql "${PSQL_ARGS[@]}" -f "$WORK_DIR/grant_attempt.sql" > "$WORK_DIR/grant_attempt.log" 2>&1
wait "$KICK2_PID"
cat "$WORK_DIR/grant_attempt.log"
grep -q "PASS: 到達記録後でも" "$WORK_DIR/grant_attempt.log"

TITLE_COUNT="$(psql "${PSQL_ARGS[@]}" -t -A -c "select count(*) from public.user_titles where user_id = '$USER_A';")"
if [ "$TITLE_COUNT" != "0" ]; then
  echo "FAIL: 退場処分と競合したのに称号が付与されている" >&2
  exit 1
fi

# ============================================================
# シナリオ4: 到達記録済みでgrant実行中に、緊急中止(emergency_closed)が同時に
# 入った場合、_apply_first_live_rewardが新設のlives行FOR UPDATEロックにより
# その競合を検出し、付与しない（1番のレビュー対応：livesロックの実効性確認）。
# ============================================================
echo "==> シナリオ4: grant実行中のlives緊急中止フラグ更新との同時実行"
psql "${PSQL_ARGS[@]}" -c "update public.participants set kicked_at = null where id = '$PARTICIPANT_ID';" >/dev/null

cat > "$WORK_DIR/emergency_holder.sql" <<SQL
begin;
update public.lives set emergency_closed = true where id = '$LIVE_ID';
select pg_sleep(1.5);
commit;
SQL
cat > "$WORK_DIR/grant_attempt2.sql" <<SQL
set role authenticated;
select set_config('myapp.uid', '$USER_A', false);
do \$body\$
declare
  v_result public.first_live_reward_result;
begin
  begin
    v_result := public.grant_first_live_reward('$LIVE_ID', '$USER_A');
    raise exception 'FAIL: 緊急中止フラグ更新との同時実行でも付与できてしまった';
  exception
    when others then
      if sqlerrm <> 'LIVE_EMERGENCY_CLOSED' then
        raise exception 'FAIL: 想定外のエラー(%)', sqlerrm;
      end if;
      raise notice 'PASS: grant実行中でも、lives行のFOR UPDATEロックにより緊急中止フラグ更新との競合を検出しLIVE_EMERGENCY_CLOSEDで付与されない';
  end;
end \$body\$;
SQL
psql "${PSQL_ARGS[@]}" -f "$WORK_DIR/emergency_holder.sql" > "$WORK_DIR/emergency_holder.log" 2>&1 &
EMERGENCY_PID=$!
sleep 0.5
psql "${PSQL_ARGS[@]}" -f "$WORK_DIR/grant_attempt2.sql" > "$WORK_DIR/grant_attempt2.log" 2>&1
wait "$EMERGENCY_PID"
cat "$WORK_DIR/grant_attempt2.log"
grep -q "PASS: grant実行中でも" "$WORK_DIR/grant_attempt2.log"

psql "${PSQL_ARGS[@]}" -c "update public.lives set emergency_closed = false where id = '$LIVE_ID';" >/dev/null

echo "==> 完了：0081の行ロックは実際の並行接続下でも安全に競合を検出しました。"
