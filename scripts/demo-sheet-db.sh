#!/usr/bin/env bash
# Runs scripts/tests/demo-sheet-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:55481, data in the git-ignored .tmp/ folder), then stops it:
#   1. origin/main's tree: the demo sessions through main's route → snapshot;
#   2. this branch: no seeded business fact and no lib/schedule place in what
#      the provider receives, the rest identical to the snapshot, and a regular
#      tenant still gets its own business block.
# The provider is a local recorder the test starts (REALTIME_API_BASE, with a
# placeholder key); the session is a test double (module hooks). Never uses
# DATABASE_URL from your shell; clean env, so no provider credential is visible.
# main's tree sits under .tmp/ inside this checkout, so it resolves this
# checkout's node_modules by the normal parent-directory lookup (no symlink).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55481
TMP=".tmp/demo-sheet"
DIR="$TMP/pg"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
MAIN="$TMP/main-tree"
SNAP="$PWD/$TMP/main-snapshot.json"
HOOKS="scripts/tests/fixtures/demo-sheet/hooks.mjs"
TEST="scripts/tests/demo-sheet-db.test.ts"
if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is busy, refusing to start" >&2
  exit 1
fi
rm -rf "$TMP" && mkdir -p "$TMP"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null 2>&1

echo "== 1. origin/main route"
mkdir -p "$MAIN"
git archive origin/main | tar -x -C "$MAIN"
mkdir -p "$MAIN/scripts/tests/fixtures"
cp -R scripts/tests/fixtures/demo-sheet "$MAIN/scripts/tests/fixtures/"
cp "$TEST" "$MAIN/scripts/tests/"
(cd "$MAIN" && env -i PATH="$PATH" HOME="$HOME" DEMO_SHEET_DB_URL="$URL" DEMO_SHEET_PHASE=main \
  DEMO_SHEET_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST")
if [ -n "${DEMO_SHEET_KEEP_SNAPSHOT:-}" ]; then cp "$SNAP" "$DEMO_SHEET_KEEP_SNAPSHOT"; fi
echo "== 2. this branch"
env -i PATH="$PATH" HOME="$HOME" DEMO_SHEET_DB_URL="$URL" DEMO_SHEET_PHASE=branch \
  DEMO_SHEET_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST"
