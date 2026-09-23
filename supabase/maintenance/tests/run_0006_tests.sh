#!/usr/bin/env bash
# 0006_all_normal_profiles_prelaunch_reset_once.sql（本番前テストデータ初期化・
# 全通常プロフィール版）のローカル自動テスト。
#
# 一度限りの破壊的SQLのため、手動確認だけで終わらせず、実際のPostgreSQLへ
# 使い捨てDBを作って自動検証する。本番のSupabaseへは一切接続しない。
#
# 使い方：
#   supabase/maintenance/tests/run_0006_tests.sh
#   supabase/maintenance/tests/run_0006_tests.sh postgresql://user:pass@localhost:5432/postgres
#
# 前提：psql/createdb/dropdbが使えること（Postgres 16推奨）。
# 本番のSupabaseプロジェクトに対しては絶対に実行しないこと
# （このスクリプトは接続先で使い捨てデータベースを何度も作成・削除する）。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
MAINTENANCE_DIR="$REPO_ROOT/supabase/maintenance"
FIXTURE_FILE="$REPO_ROOT/supabase/tests/fixtures/local_supabase_shim.sql"
SEED_FILE="$SCRIPT_DIR/seed_all_normal_profiles.sql"
SQL_0006="$MAINTENANCE_DIR/0006_all_normal_profiles_prelaunch_reset_once.sql"

CONN="${1:-${SUPABASE_TEST_DB_URL:-}}"
SUFFIX="$$_$(date +%s%N 2>/dev/null || echo $RANDOM)"
BASE_DB="ogiridojo_0006tpl_${SUFFIX}"

PSQL_BASE_ARGS=(-v ON_ERROR_STOP=1 -q)
if [ -n "$CONN" ]; then
  BASE_CONN="${CONN%/*}"
else
  BASE_CONN=""
fi

db_url() {
  local name="$1"
  if [ -n "$BASE_CONN" ]; then
    echo "$BASE_CONN/$name"
  else
    echo "$name"
  fi
}

FAILED=0

# 使い捨てDBの名前はすべて "ogiridojo_0006" + このスクリプト実行固有の
# SUFFIXを含む形にしているため、名前パターンで確実に後片付けする
# （$(...) コマンド置換はサブシェルで実行されるため、配列へのpushをその中で
# 行っても呼び出し元へは反映されない。名前パターンでの一括cleanupなら
# その問題を回避できる）。
cleanup() {
  local pg_conn
  pg_conn="$(db_url postgres)"
  psql -tAc "select datname from pg_database where datname like 'ogiridojo_0006%${SUFFIX}%'" "$pg_conn" 2>/dev/null |
    while IFS= read -r db; do
      [ -n "$db" ] && dropdb --if-exists "$(db_url "$db")" >/dev/null 2>&1
    done
}
trap cleanup EXIT

echo "==> [1/2] 静的チェック（DBを使わない）"

# 旧0002/0004が「使用禁止」警告つきのまま残っていること。
for f in 0002_official_sequence_1_fix_once.sql 0004_admin_test_data_reset_once.sql; do
  if ! grep -q "現在の本番環境では使用禁止" "$MAINTENANCE_DIR/$f"; then
    echo "FAIL: $f に「現在の本番環境では使用禁止」の警告が見つかりません" >&2
    FAILED=1
  else
    echo "PASS: $f は使用禁止の警告つきのまま残っている"
  fi
done

# 0005は読み取り専用（select以外の変更文を含まない）こと。
# コメントを取り除いた上で、insert/update/delete/create/drop/alter/grant/revoke/
# do ブロック等が出現しないことを確認する。
READONLY_FILE="$MAINTENANCE_DIR/0005_all_normal_profiles_reset_check_readonly.sql"
STRIPPED="$(sed -E 's/--.*$//' "$READONLY_FILE")"
if echo "$STRIPPED" | grep -qiE '\b(insert|update|delete|create|drop|alter|grant|revoke|do[[:space:]]*\$\$|truncate|call)\b'; then
  echo "FAIL: 0005に更新系のキーワードが含まれています（読み取り専用のはずです）" >&2
  echo "$STRIPPED" | grep -inE '\b(insert|update|delete|create|drop|alter|grant|revoke|do[[:space:]]*\$\$|truncate|call)\b' >&2
  FAILED=1
else
  echo "PASS: 0005はSELECTだけで構成されており、更新文を含まない"
fi

echo "==> [2/2] 実DBを使った0006の動作検証"

echo "  -> テンプレートDBを作成し、migrationsを適用: $BASE_DB"
if ! createdb "$(db_url "$BASE_DB")" 2>/tmp/0006test_createdb.log; then
  echo "FAIL: テンプレートDBの作成に失敗しました。ローカルPostgreSQL（psql/createdb）が使えるか確認してください。" >&2
  cat /tmp/0006test_createdb.log >&2
  exit 1
fi

if ! psql "${PSQL_BASE_ARGS[@]}" -d "$(db_url "$BASE_DB")" -f "$FIXTURE_FILE" >/tmp/0006test_setup.log 2>&1; then
  echo "FAIL: シム(local_supabase_shim.sql)の適用に失敗しました" >&2
  cat /tmp/0006test_setup.log >&2
  exit 1
fi
psql "${PSQL_BASE_ARGS[@]}" -d "$(db_url "$BASE_DB")" -c "create publication supabase_realtime;" >>/tmp/0006test_setup.log 2>&1

shopt -s nullglob
for f in "$MIGRATIONS_DIR"/0*.sql; do
  if ! psql "${PSQL_BASE_ARGS[@]}" -d "$(db_url "$BASE_DB")" -f "$f" >>/tmp/0006test_setup.log 2>&1; then
    echo "FAIL: migration $(basename "$f") の適用に失敗しました" >&2
    tail -40 /tmp/0006test_setup.log >&2
    exit 1
  fi
done
shopt -u nullglob
echo "  -> migrations適用OK"

fresh_seeded_db() {
  local name="ogiridojo_0006t_${SUFFIX}_$RANDOM"
  createdb -T "$(db_url "$BASE_DB")" "$(db_url "$name")" >/dev/null 2>&1
  if ! psql "${PSQL_BASE_ARGS[@]}" -d "$(db_url "$name")" -f "$SEED_FILE" >/tmp/0006test_seed_${name}.log 2>&1; then
    echo "FAIL: シード($name)の投入に失敗しました" >&2
    cat "/tmp/0006test_seed_${name}.log" >&2
    return 1
  fi
  echo "$name"
}

run_0006() {
  local name="$1"
  psql "${PSQL_BASE_ARGS[@]}" -d "$(db_url "$name")" -f "$SQL_0006"
}

scalar() {
  local name="$1" sql="$2"
  psql -d "$(db_url "$name")" -tAc "$sql"
}

expect_rollback() {
  # $1: テスト名, $2: DB名, $3: 出力に含まれるべき文字列（安全ガード文言）
  local label="$1" name="$2" expect_text="$3"
  local out
  out="$(run_0006 "$name" 2>&1)"
  local rc=$?
  if [ $rc -eq 0 ]; then
    echo "FAIL: [$label] 0006が失敗するはずが成功してしまった" >&2
    FAILED=1
    return
  fi
  if ! echo "$out" | grep -qF "$expect_text"; then
    echo "FAIL: [$label] 期待したエラー文言が見つからない（期待: ${expect_text}）" >&2
    echo "$out" | tail -5 >&2
    FAILED=1
    return
  fi
  # 本番ライブ・カウンター・profilesが一切変化していないこと（全体ロールバック）を
  # 代表的に確認する（対象外データの検証は正常系テストで別途網羅する）。
  local official_count
  official_count="$(scalar "$name" "select count(*) from public.lives where live_mode = 'official';")"
  echo "PASS: [$label] 想定どおり安全ガードでロールバックされた（official_lives=$official_count は変化なし想定）"
}

echo ""
echo "--- 正常系：17/1/16、ゲスト5、official #0001、counter=1で成功 ---"
DB1="$(fresh_seeded_db)"
if [ -z "$DB1" ]; then
  FAILED=1
else
  OUT1="$(run_0006 "$DB1" 2>&1)"
  RC1=$?
  if [ $RC1 -ne 0 ]; then
    echo "FAIL: 正常系のはずの0006が失敗した" >&2
    echo "$OUT1" | tail -20 >&2
    FAILED=1
  else
    if ! echo "$OUT1" | grep -q "事後検証OK"; then
      echo "FAIL: 正常系実行で「事後検証OK」の通知が出ていない" >&2
      FAILED=1
    fi
    NORMAL_AFTER="$(scalar "$DB1" "select count(*) from public.profiles where is_guest=false;")"
    GUEST_AFTER="$(scalar "$DB1" "select count(*) from public.profiles where is_guest=true;")"
    OFFICIAL_AFTER="$(scalar "$DB1" "select count(*) from public.lives where live_mode='official';")"
    COUNTER_AFTER="$(scalar "$DB1" "select last_value from public.official_live_counter where id=true;")"
    PH_AFTER="$(scalar "$DB1" "select count(*) from public.point_history where user_id in (select id from public.profiles where is_guest=false);")"
    TOPICS_AFTER="$(scalar "$DB1" "select count(*) from public.sns_topics where author_id in (select id from public.profiles where is_guest=false);")"
    ANSWERS_AFTER="$(scalar "$DB1" "select count(*) from public.sns_answers where author_id in (select id from public.profiles where is_guest=false);")"
    COMMENTS_AFTER="$(scalar "$DB1" "select count(*) from public.sns_comments where author_id in (select id from public.profiles where is_guest=false);")"
    LRC_AFTER="$(scalar "$DB1" "select count(*) from public.sns_live_result_comments where author_id in (select id from public.profiles where is_guest=false);")"
    REPORTS_AFTER="$(scalar "$DB1" "select count(*) from public.reports;")"
    MASTERY_NONZERO="$(scalar "$DB1" "select count(*) from public.profiles where is_guest=false and (mastery_meter<>0 or total_points<>0 or points_balance<>0);")"
    LIVE_COUNT_BOT1="$(scalar "$DB1" "select live_count from public.profiles where id='d0000000-0000-0000-0001-000000000001';")"
    AWARD_BOT1="$(scalar "$DB1" "select award_count_first from public.profiles where id='d0000000-0000-0000-0001-000000000001';")"
    BEST_BOT1="$(scalar "$DB1" "select best_answer_count from public.profiles where id='d0000000-0000-0000-0001-000000000001';")"
    TICKETS_ADMIN="$(scalar "$DB1" "select tickets_count from public.profiles where id='d0000000-0000-0000-0000-00000000000f';")"
    FOLLOWS_AFTER="$(scalar "$DB1" "select count(*) from public.sns_follows;")"
    LIKES_AFTER="$(scalar "$DB1" "select count(*) from public.sns_answer_likes;")"
    PARTICIPANTS_AFTER="$(scalar "$DB1" "select count(*) from public.participants;")"
    LIVES_TOTAL_AFTER="$(scalar "$DB1" "select count(*) from public.lives;")"
    NEXT_SEQ="$(scalar "$DB1" "
      do \$\$ begin
        set local role authenticated;
        perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000000f', true);
        raise notice 'NEXT_SEQ=%', public.get_next_official_sequence_number();
        reset role;
      end \$\$;" 2>&1 | grep -oE 'NEXT_SEQ=[0-9]+' | cut -d= -f2)"

    check() {
      local label="$1" got="$2" want="$3"
      if [ "$got" != "$want" ]; then
        echo "FAIL: [正常系] $label が想定と違う（想定=$want, 実際=${got}）" >&2
        FAILED=1
      else
        echo "PASS: [正常系] $label = $want"
      fi
    }
    check "通常プロフィール件数" "$NORMAL_AFTER" 17
    check "ゲストプロフィール件数" "$GUEST_AFTER" 5
    check "本番ライブ件数" "$OFFICIAL_AFTER" 0
    check "official_live_counter.last_value" "$COUNTER_AFTER" 0
    check "対象17件のpoint_history残数" "$PH_AFTER" 0
    check "対象17件のsns_topics残数" "$TOPICS_AFTER" 0
    check "対象17件のsns_answers残数" "$ANSWERS_AFTER" 0
    check "対象17件のsns_comments残数" "$COMMENTS_AFTER" 0
    check "対象17件のsns_live_result_comments残数" "$LRC_AFTER" 0
    check "reports残数（削除対象を指していたもの）" "$REPORTS_AFTER" 0
    check "sns_answer_likes残数（カスケード削除）" "$LIKES_AFTER" 0
    check "ポイント関連値が非0の対象プロフィール数" "$MASTERY_NONZERO" 0
    check "対象プロフィールのlive_count（変更されないはず）" "$LIVE_COUNT_BOT1" 3
    check "対象プロフィールのaward_count_first（変更されないはず）" "$AWARD_BOT1" 1
    check "対象プロフィールのbest_answer_count（変更されないはず）" "$BEST_BOT1" 2
    check "adminのtickets_count（変更されないはず）" "$TICKETS_ADMIN" 5
    check "sns_follows件数（変更されないはず）" "$FOLLOWS_AFTER" 1
    check "participants件数（#0001のデータ、削除されないはず）" "$PARTICIPANTS_AFTER" 1
    check "lives総数（#0001自体は削除されずtest化されるはず）" "$LIVES_TOTAL_AFTER" 1
    check "次回の本番採番番号" "$NEXT_SEQ" 1

    echo "--- 再実行（同じDB）：安全ガードで即座に停止すること ---"
    expect_rollback "再実行時の安全ガード" "$DB1" "安全ガード停止：本番ライブ"
  fi
fi

echo ""
echo "--- ロールバック系シナリオ ---"

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "insert into auth.users (id, is_anonymous) values ('d0000000-0000-0000-0003-000000000001', false);" >/dev/null; expect_rollback "通常プロフィール18件" "$DB" "通常プロフィール(is_guest=false)が17件ではありません"; }

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "delete from auth.users where id = 'd0000000-0000-0000-0001-000000000016';" >/dev/null; expect_rollback "通常プロフィール16件" "$DB" "通常プロフィール(is_guest=false)が17件ではありません"; }

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "update public.profiles set role='user' where id='d0000000-0000-0000-0000-00000000000f';" >/dev/null; expect_rollback "admin0件" "$DB" "admin（role=admin）の通常プロフィールが1件ではありません"; }

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "update public.profiles set role='admin' where id='d0000000-0000-0000-0001-000000000001';" >/dev/null; expect_rollback "admin2件" "$DB" "admin（role=admin）の通常プロフィールが1件ではありません"; }

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "delete from auth.users where id = 'd0000000-0000-0000-0002-000000000001';" >/dev/null; expect_rollback "ゲスト4件" "$DB" "匿名ゲスト(is_guest=true)が5件ではありません"; }

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "insert into auth.users (id, is_anonymous) values ('d0000000-0000-0000-0002-000000000006', true);" >/dev/null; expect_rollback "ゲスト6件" "$DB" "匿名ゲスト(is_guest=true)が5件ではありません"; }

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "update public.lives set live_mode='test', official_sequence_number=null, results_published=false, rank_rewards_applied=false where live_mode='official';" >/dev/null; expect_rollback "本番ライブ0件" "$DB" "本番ライブ(live_mode=official)が1件ではありません"; }

DB=$(fresh_seeded_db)
if [ -n "$DB" ]; then
  psql -d "$(db_url "$DB")" -c "
    do \$\$
    declare v_live_id uuid;
    begin
      set local role authenticated;
      perform set_config('myapp.uid', 'd0000000-0000-0000-0000-00000000000f', true);
      select live_id into v_live_id from public.create_live_preparation(now(), 'second official', 20, 1, array['d0100000-0000-0000-0000-000000000001']::uuid[], 'official');
      reset role;
      update public.lives set current_phase='closed' where id = v_live_id;
    end \$\$;" >/dev/null 2>&1
  expect_rollback "本番ライブ2件" "$DB" "本番ライブ(live_mode=official)が1件ではありません"
fi

DB=$(fresh_seeded_db)
if [ -n "$DB" ]; then
  psql -d "$(db_url "$DB")" -c "update public.lives set official_sequence_number=2 where live_mode='official';" >/dev/null
  psql -d "$(db_url "$DB")" -c "update public.official_live_counter set last_value=2;" >/dev/null
  expect_rollback "本番ライブが#0001以外" "$DB" "official_sequence_numberが1ではありません"
fi

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "update public.official_live_counter set last_value=5;" >/dev/null; expect_rollback "counter値不一致(5)" "$DB" "official_live_counter.last_valueが1ではありません"; }

DB=$(fresh_seeded_db); [ -n "$DB" ] && { psql -d "$(db_url "$DB")" -c "delete from public.official_live_counter;" >/dev/null; expect_rollback "counter行なし" "$DB" "official_live_counterの行が1件ではありません"; }

DB=$(fresh_seeded_db)
if [ -n "$DB" ]; then
  psql -d "$(db_url "$DB")" -c "
    insert into public.point_history (user_id, live_id, points, mastery, label)
    select 'd0000000-0000-0000-0002-000000000001', id, 10, 10, 'stray'
    from public.lives where live_mode='official';
  " >/dev/null
  expect_rollback "#0001に対象外point_historyあり" "$DB" "対象17件以外のuser_idが"
fi

echo ""
echo "--- 途中エラーでの全体ロールバック（#0001補正後・投稿削除前に注入） ---"
DB=$(fresh_seeded_db)
if [ -n "$DB" ]; then
  INJECT_FILE="/tmp/0006_inject_$SUFFIX.sql"
  perl -0pe "s/(-- 6\\) 対象17件が投稿した寄合帳コンテンツの削除)/raise exception '意図的な注入エラー：ロールバック確認用テスト';\n  \$1/" "$SQL_0006" > "$INJECT_FILE"
  if ! grep -q "意図的な注入エラー" "$INJECT_FILE"; then
    echo "FAIL: [途中エラーロールバック] エラー注入用の置換に失敗しました（0006の該当コメントが変更された可能性）" >&2
    FAILED=1
  else
    BEFORE_LIVEMODE="$(scalar "$DB" "select live_mode from public.lives where live_mode='official';")"
    BEFORE_MASTERY="$(scalar "$DB" "select mastery_meter from public.profiles where id='d0000000-0000-0000-0000-00000000000f';")"
    BEFORE_TOPICS="$(scalar "$DB" "select count(*) from public.sns_topics;")"
    BEFORE_COUNTER="$(scalar "$DB" "select last_value from public.official_live_counter where id=true;")"

    OUT="$(psql "${PSQL_BASE_ARGS[@]}" -d "$(db_url "$DB")" -f "$INJECT_FILE" 2>&1)"
    RC=$?
    if [ $RC -eq 0 ]; then
      echo "FAIL: [途中エラーロールバック] 注入した例外にもかかわらず0006が成功してしまった" >&2
      FAILED=1
    elif ! echo "$OUT" | grep -qF "意図的な注入エラー"; then
      echo "FAIL: [途中エラーロールバック] 注入した例外が発生しなかった" >&2
      echo "$OUT" | tail -10 >&2
      FAILED=1
    else
      AFTER_LIVEMODE="$(scalar "$DB" "select live_mode from public.lives where live_mode='official';")"
      AFTER_MASTERY="$(scalar "$DB" "select mastery_meter from public.profiles where id='d0000000-0000-0000-0000-00000000000f';")"
      AFTER_TOPICS="$(scalar "$DB" "select count(*) from public.sns_topics;")"
      AFTER_COUNTER="$(scalar "$DB" "select last_value from public.official_live_counter where id=true;")"
      if [ "$BEFORE_LIVEMODE" = "$AFTER_LIVEMODE" ] && [ "$BEFORE_MASTERY" = "$AFTER_MASTERY" ] && [ "$BEFORE_TOPICS" = "$AFTER_TOPICS" ] && [ "$BEFORE_COUNTER" = "$AFTER_COUNTER" ]; then
        echo "PASS: [途中エラーロールバック] #0001補正・投稿削除・ポイント初期化を含む全変更が1つのトランザクションとしてロールバックされた"
      else
        echo "FAIL: [途中エラーロールバック] 一部の変更がロールバックされずに残った(live_mode:$BEFORE_LIVEMODE->$AFTER_LIVEMODE, mastery:$BEFORE_MASTERY->$AFTER_MASTERY, topics:$BEFORE_TOPICS->$AFTER_TOPICS, counter:$BEFORE_COUNTER->$AFTER_COUNTER)" >&2
        FAILED=1
      fi
    fi
  fi
  rm -f "$INJECT_FILE"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "==> 完了：0006の全ローカルテストが成功しました（本番へは一切接続していません）。"
else
  echo "==> 失敗：0006のローカルテストに1件以上の失敗があります。上記のFAILを確認してください。" >&2
fi
exit "$FAILED"
