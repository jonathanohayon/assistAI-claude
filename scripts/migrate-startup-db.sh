#!/usr/bin/env bash
# Runs scripts/tests/migrate-startup.test.ts against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it.
# Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and
# runs with a clean env so no provider credential is visible to the test.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
DIR=".tmp/pg-migrate-startup-${PORT}"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
rm -rf "$DIR" && mkdir -p "$DIR"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"'
env -i PATH="$PATH" HOME="$HOME" MIGRATE_STARTUP_TEST_DATABASE_URL="$URL" npx tsx scripts/tests/migrate-startup.test.ts
