#!/usr/bin/env bash
# Section 12 Part J — real, adversarial concurrency proof for
# `claim_next_operational_job()`'s `FOR UPDATE SKIP LOCKED` claim.
#
# Unlike every other test in this directory (each wrapped in its own
# `begin;...rollback;` transaction, so it never observes a concurrent
# session), this script launches several REAL, separate `psql`
# connections against the SAME already-migrated database at the same
# moment and proves that exactly one of them claims a given QUEUED job
# — never two, never zero, regardless of how many race for it.
#
# Requires: run.sh has already been run against the same DB_NAME (this
# script does not re-apply migrations/fixtures; it reuses the schema
# run.sh already built, and only adds its own throwaway job row).
#
# Usage: ./tests/database/concurrency_test.sh [database-name] [workers]

set -euo pipefail

DB_NAME="${1:-sport_os_test}"
WORKERS="${2:-8}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "== Seeding one QUEUED PERFORMANCE_SNAPSHOT job for the concurrency race =="
JOB_ID=$(sudo -u postgres psql -d "$DB_NAME" -q -At -c "
set role service_role;
insert into public.operational_jobs (job_type, status, payload_reference, scheduled_at, max_attempts, idempotency_key, created_by)
values ('PERFORMANCE_SNAPSHOT', 'QUEUED', '{}'::jsonb, now(), 3, 'concurrency-test-$(date +%s%N)', 'system')
returning job_id;
")
echo "  seeded job_id=$JOB_ID"

echo "== Launching $WORKERS concurrent claimers against the SAME job =="
for i in $(seq 1 "$WORKERS"); do
  (
    sudo -u postgres psql -d "$DB_NAME" -q -At -c "
      set role service_role;
      select job_id from public.claim_next_operational_job('PERFORMANCE_SNAPSHOT', now(), 600000);
    " > "$TMP_DIR/worker_$i.out" 2>"$TMP_DIR/worker_$i.err"
  ) &
done
wait

echo "== Results =="
CLAIMED_COUNT=0
for i in $(seq 1 "$WORKERS"); do
  RESULT="$(cat "$TMP_DIR/worker_$i.out" | tr -d '[:space:]')"
  if [[ "$RESULT" == "$JOB_ID" ]]; then
    CLAIMED_COUNT=$((CLAIMED_COUNT + 1))
    echo "  worker $i: claimed the job"
  else
    echo "  worker $i: did not claim it (saw: '${RESULT:-empty}')"
  fi
done

echo "== Verifying final job state =="
sudo -u postgres psql -d "$DB_NAME" -c "select job_id, status, attempts from public.operational_jobs where job_id = '$JOB_ID';"

echo "== Cleaning up the seeded row =="
sudo -u postgres psql -d "$DB_NAME" -q -c "set role service_role; delete from public.operational_jobs where job_id = '$JOB_ID';"

if [[ "$CLAIMED_COUNT" -eq 1 ]]; then
  echo "PASS: exactly 1 of $WORKERS concurrent claimers won the race, as required."
  exit 0
else
  echo "FAIL: expected exactly 1 claimer, got $CLAIMED_COUNT."
  exit 1
fi
