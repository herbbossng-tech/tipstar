#!/usr/bin/env bash
# RLS test runner (Section 03 users/licenses; Section 04 football data;
# Section 05 intelligence metadata; Section 06 agent framework; Section 07
# decision/value/ticket/risk/execution; Section 08 settlement/performance/
# backtesting).
# Applies every migration in supabase/migrations/, the local-only
# Supabase role/auth.uid() stubs, fixture data, and all six RLS test
# suites against a scratch Postgres database — then prints the full
# transcript for manual verification against each test's stated expected
# outcome (see 20_rls_cases.sql, 40_football_rls_cases.sql,
# 60_intelligence_rls_cases.sql, 80_agent_rls_cases.sql,
# 100_section07_rls_cases.sql, 120_section08_rls_cases.sql).
#
# Requires: a running local PostgreSQL server reachable as the `postgres`
# superuser (no Supabase CLI/Docker/PostgREST required — this validates
# the raw SQL migrations and RLS policies directly).
#
# Usage: ./tests/database/run.sh [database-name]

set -euo pipefail

DB_NAME="${1:-sport_os_test}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
TEST_DIR="$REPO_ROOT/tests/database"

echo "== Resetting database $DB_NAME =="
sudo -u postgres psql -q -c "drop database if exists \"$DB_NAME\";" -c "create database \"$DB_NAME\";"

echo "== Applying local Supabase stubs (roles + auth.uid()) =="
sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$TEST_DIR/00_supabase_stubs.sql"

echo "== Applying migrations =="
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  -> $(basename "$f")"
  sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$f"
done

echo "== Loading fixtures (users/licenses) =="
sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$TEST_DIR/10_fixtures.sql"

echo "== Loading fixtures (football data) =="
sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$TEST_DIR/30_football_fixtures.sql"

echo "== Loading fixtures (intelligence metadata) =="
sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$TEST_DIR/50_intelligence_fixtures.sql"

echo "== Loading fixtures (agent framework) =="
sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$TEST_DIR/70_agent_fixtures.sql"

echo "== Loading fixtures (decision/value/ticket/risk/execution) =="
sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$TEST_DIR/90_section07_fixtures.sql"

echo "== Loading fixtures (settlement/performance/backtesting) =="
sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$TEST_DIR/110_section08_fixtures.sql"

echo "== Loading fixtures (Telegram publishing) =="
sudo -u postgres psql -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$TEST_DIR/130_section10_fixtures.sql"

echo "== Running RLS test suite: users/licenses (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/20_rls_cases.sql"

echo "== Running RLS test suite: football data (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/40_football_rls_cases.sql"

echo "== Running RLS test suite: intelligence metadata (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/60_intelligence_rls_cases.sql"

echo "== Running RLS test suite: agent framework (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/80_agent_rls_cases.sql"

echo "== Running RLS test suite: decision/value/ticket/risk/execution (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/100_section07_rls_cases.sql"

echo "== Running RLS test suite: settlement/performance/backtesting (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/120_section08_rls_cases.sql"

echo "== Running RLS test suite: Telegram publishing (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/140_section10_rls_cases.sql"
