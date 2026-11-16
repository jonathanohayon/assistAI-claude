#!/usr/bin/env bash
# Runs the DB part of scripts/tests/campaign-detail-extracted.test.ts against a
# THROWAWAY Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder),
# migrated with this branch's migrations. Needs initdb/pg_ctl on PATH.
# Never uses DATABASE_URL from your shell; runs with a clean env.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
TMP=".tmp/campaign-detail-extracted-${PORT}"
DIR="$TMP/pg"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
rm -rf "$TMP" && mkdir -p "$TMP"
stop() { pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; }
pg_on_exit 'stop; rm -rf "$TMP"'
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
env -i PATH="$PATH" HOME="$HOME" CAMPAIGN_DETAIL_TEST_DATABASE_URL="$URL" npx tsx scripts/tests/campaign-detail-extracted.test.ts
