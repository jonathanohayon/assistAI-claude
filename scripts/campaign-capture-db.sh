#!/usr/bin/env bash
# Runs scripts/tests/campaign-capture-db.test.ts against a THROWAWAY Postgres
# (127.0.0.1:55444, data in the git-ignored .tmp/ folder), then stops it:
#   1. origin/main's tree: POST through main's handler → snapshot;
#   2. this branch: OFF identical to the snapshot, then ON / write-once / errors.
# Needs initdb/pg_ctl on PATH and an origin/main ref. Never uses DATABASE_URL
# from your shell; runs with a clean env (no provider key is visible).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55444
TMP=".tmp/campaign-capture"
DIR="$TMP/pg"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
MAIN="$TMP/main-tree"
SNAP="$PWD/$TMP/main-snapshot.json"
rm -rf "$TMP" && mkdir -p "$TMP"
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs

echo "== 1. origin/main handler"
mkdir -p "$MAIN"
git archive origin/main | tar -x -C "$MAIN"
ln -s "$PWD/node_modules" "$MAIN/node_modules"
cp scripts/tests/campaign-capture-db.test.ts "$MAIN/scripts/tests/"
(cd "$MAIN" && env -i PATH="$PATH" HOME="$HOME" CAPTURE_DB_TEST_URL="$URL" CAPTURE_DB_PHASE=main \
  CAPTURE_DB_SNAPSHOT="$SNAP" npx tsx scripts/tests/campaign-capture-db.test.ts)
echo "== 2. this branch"
env -i PATH="$PATH" HOME="$HOME" CAPTURE_DB_TEST_URL="$URL" CAPTURE_DB_PHASE=branch \
  CAPTURE_DB_SNAPSHOT="$SNAP" npx tsx scripts/tests/campaign-capture-db.test.ts
