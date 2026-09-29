#!/usr/bin/env bash
# RLS test runner (Section 03 users/licenses; Section 04 football data).
# Applies every migration in supabase/migrations/, the local-only
# Supabase role/auth.uid() stubs, fixture data, and both RLS test suites
# against a scratch Postgres database — then prints the full transcript
# for manual verification against each test's stated expected outcome
# (see 20_rls_cases.sql and 40_football_rls_cases.sql).
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

echo "== Running RLS test suite: users/licenses (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/20_rls_cases.sql"

echo "== Running RLS test suite: football data (read the transcript below against each test's stated expectation) =="
sudo -u postgres psql -d "$DB_NAME" -f "$TEST_DIR/40_football_rls_cases.sql"
