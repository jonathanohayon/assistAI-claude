#!/usr/bin/env bash
# Runs scripts/tests/client-confirm-db.test.ts against a THROWAWAY Postgres
# (127.0.0.1:55478, data in the git-ignored .tmp/ folder), then stops it.
# Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and runs
# with a clean env so no Twilio/OpenAI credential is visible. Also snapshots
# origin/main's /api/calls/end route into .tmp/ so the test can compare the
# owner recap payload of main and of this branch for the same input.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55478
DIR=".tmp/pg-client-confirm"
MAIN_ROUTE=".tmp/client-confirm-main/route.ts"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is busy, refusing to start" >&2
  exit 1
fi
mkdir -p "$(dirname "$MAIN_ROUTE")"
git show "${CLIENT_CONFIRM_MAIN_REF:-origin/main}:app/api/calls/end/route.ts" > "$MAIN_ROUTE"
rm -rf "$DIR" && mkdir -p "$DIR"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log" "$(dirname "$MAIN_ROUTE")"' EXIT
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
env -i PATH="$PATH" HOME="$HOME" CLIENT_CONFIRM_DB_URL="$URL" CLIENT_CONFIRM_MAIN_ROUTE="$PWD/$MAIN_ROUTE" \
  npx tsx scripts/tests/client-confirm-db.test.ts
