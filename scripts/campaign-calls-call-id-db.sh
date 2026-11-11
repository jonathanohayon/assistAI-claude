#!/usr/bin/env bash
# Runs the DB part of scripts/tests/campaign-calls-call-id.test.ts against a
# THROWAWAY Postgres (127.0.0.1:55441, data in the git-ignored .tmp/ folder):
#   1. fresh DB → this branch's migrations → checks, re-run no-op, inserts;
#   2. new DB → origin/main's migrations + mock rows + origin/main's response
#      bytes → this branch's migrations → checks, byte-identical, inserts.
# Needs initdb/pg_ctl on PATH and an origin/main ref. Never uses DATABASE_URL
# from your shell; runs with a clean env.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55441
TMP=".tmp/campaign-calls-call-id"
DIR="$TMP/pg"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
MAIN="$TMP/main-tree"
rm -rf "$TMP" && mkdir -p "$TMP"
stop() { pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; }
trap 'stop; rm -rf "$TMP"' EXIT
start() {
  rm -rf "$DIR"
  initdb -D "$DIR" -A trust -U postgres >/dev/null
  pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
}
run_test() {
  env -i PATH="$PATH" HOME="$HOME" CAMPAIGN_CALLS_TEST_DATABASE_URL="$URL" CAMPAIGN_CALLS_TEST_PHASE="$1" \
    CAMPAIGN_CALLS_MAIN_SNAPSHOT="$PWD/$TMP/main-calls.json" CAMPAIGN_CALLS_MAIN_SCHEMA="$PWD/$MAIN/lib/db/schema.ts" \
    npx tsx scripts/tests/campaign-calls-call-id.test.ts
}
migrate_branch() { env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs; }

echo "== 1. fresh DB"
start
migrate_branch
run_test fresh
stop

echo "== 2. DB at origin/main, then upgraded"
mkdir -p "$MAIN"
git archive origin/main drizzle scripts/migrate.mjs lib/db/schema.ts | tar -x -C "$MAIN"
ln -s "$PWD/node_modules" "$MAIN/node_modules"
start
(cd "$MAIN" && env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs)
run_test main-snapshot
migrate_branch
run_test upgrade
