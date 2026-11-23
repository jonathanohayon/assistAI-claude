#!/usr/bin/env bash
# Runs scripts/tests/migrate-startup.test.ts against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it.
# Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and
# runs with a clean env so no provider credential is visible to the test.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  DIR=".tmp/pg-migrate-startup-${PORT}"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  rm -rf "$DIR" && mkdir -p "$DIR"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"'
pg_start_throwaway migrate-startup
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" MIGRATE_STARTUP_TEST_DATABASE_URL="$URL" npx tsx scripts/tests/migrate-startup.test.ts
