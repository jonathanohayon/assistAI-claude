#!/usr/bin/env bash
# Runs scripts/tests/schedule-change-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it.
# 13 cases through this tree's real handler, each with its hard-coded
# status / body / users rows / events (no comparison with origin/main or any
# other tree: a committed suite never asserts what main does or doesn't contain).
# The session is a test double (module hook). Mock data only.
# Never uses DATABASE_URL from your shell; clean env.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/schedule-change-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  HOOKS="scripts/tests/fixtures/schedule-change/hooks.mjs"
  TEST="scripts/tests/schedule-change-db.test.ts"
  rm -rf "$TMP" && mkdir -p "$TMP"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway schedule-change
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs

env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" SCHED_DB_URL="$URL" \
  npx tsx --import "./$HOOKS" "$TEST"
