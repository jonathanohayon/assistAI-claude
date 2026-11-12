#!/usr/bin/env bash
# Runs scripts/tests/rate-limit-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:55472, data in the git-ignored .tmp/ folder), then stops
# it. Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and
# runs with a clean env so no email-provider credential is visible.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55472
DIR=".tmp/pg-rate-limit"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is busy, refusing to start" >&2
  exit 1
fi
rm -rf "$DIR" && mkdir -p "$DIR"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"' EXIT
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
env -i PATH="$PATH" HOME="$HOME" RATE_LIMIT_DB_TEST_URL="$URL" npx tsx scripts/tests/rate-limit-db.test.ts
