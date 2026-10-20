#!/usr/bin/env bash
# Runs the Supabase migration + RLS tests (SQL) and, if Deno is installed, the Edge Function tests,
# against a throwaway local PostgreSQL database. No Supabase project needed.
# Usage: PGURL=postgres://postgres:postgres@localhost:5432 ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
BASE="${PGURL:-postgres://postgres:postgres@localhost:5432}"
DB=linkpulse_supabase_test
reset() {
  psql "$BASE/postgres" -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
  psql "$BASE/$DB" -q -v ON_ERROR_STOP=1 -f auth_stub.sql
  for f in ../migrations/*.sql; do psql "$BASE/$DB" -q -v ON_ERROR_STOP=1 -f "$f"; done
}
reset
psql "$BASE/$DB" -q -v ON_ERROR_STOP=1 -o /dev/null -f rls_test.sql
if command -v deno >/dev/null 2>&1; then
  reset
  psql "$BASE/$DB" -q -c "INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111','alice@example.com'),('22222222-2222-2222-2222-222222222222','bob@example.com')"
  (cd ../functions && TEST_DB_URL="$BASE/$DB" deno test -A --no-check=remote tests/functions_test.ts)
else
  echo "Deno not installed — skipped Edge Function tests (install from https://deno.com)."
fi
