#!/usr/bin/env bash
# Runs scripts/tests/whatsapp-test-db.test.ts against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it.
# Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and
# runs with a clean env so no provider credential is visible to the test.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  DIR=".tmp/pg-whatsapp-test-${PORT}"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  rm -rf "$DIR" && mkdir -p "$DIR"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"'
pg_start_throwaway whatsapp-test
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
env -i PATH="$PATH" HOME="$HOME" WHATSAPP_TEST_DB_URL="$URL" npx tsx scripts/tests/whatsapp-test-db.test.ts
