#!/usr/bin/env bash
# Runs scripts/tests/alert-ledger-claim.test.ts against a THROWAWAY Postgres
# (127.0.0.1:55436, data in the git-ignored .tmp/ folder), then stops it.
# Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and
# runs with a clean env so no provider credential is visible to the test.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55436
DIR=".tmp/pg-alert-ledger"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
rm -rf "$DIR" && mkdir -p "$DIR"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"' EXIT
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
env -i PATH="$PATH" HOME="$HOME" ALERT_LEDGER_TEST_DATABASE_URL="$URL" npx tsx scripts/tests/alert-ledger-claim.test.ts
