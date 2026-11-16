#!/usr/bin/env bash
# Runs scripts/tests/demo-sheet-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it:
#   1. the pre-#323 baseline tree (8567c7a, the leaky main): the demo sessions through its route → snapshot;
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
source scripts/lib/pg-free-port.sh
pick_free_port
TMP=".tmp/demo-sheet-${PORT}"
DIR="$TMP/pg"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
MAIN="$TMP/main-tree"
SNAP="$PWD/$TMP/main-snapshot.json"
HOOKS="scripts/tests/fixtures/demo-sheet/hooks.mjs"
TEST="scripts/tests/demo-sheet-db.test.ts"
rm -rf "$TMP" && mkdir -p "$TMP"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null 2>&1

echo "== 1. baseline route (pre-#323 main, \${DEMO_SHEET_BASE:-8567c7a})"
mkdir -p "$MAIN"
# The baseline is PINNED to the last main BEFORE #323 (a1dfec0^1 = 8567c7a, the
# parent of #323's merge commit): the tree that leaked the stored account
# text. origin/main already contains #323's fix, so comparing against it would
# compare the fix with itself and the "main snapshot carries the seeded
# Centre Zzyzx-Mock" sanity check would fail. Full SHA so it never becomes
# ambiguous. Override with DEMO_SHEET_BASE=<commit>.
BASE="${DEMO_SHEET_BASE:-8567c7a2e4b45c40c5edb9df2104e354e38f4899}"
git archive "$BASE" | tar -x -C "$MAIN"
mkdir -p "$MAIN/scripts/tests/fixtures"
cp -R scripts/tests/fixtures/demo-sheet "$MAIN/scripts/tests/fixtures/"
cp "$TEST" "$MAIN/scripts/tests/"
(cd "$MAIN" && env -i PATH="$PATH" HOME="$HOME" DEMO_SHEET_DB_URL="$URL" DEMO_SHEET_PHASE=main \
  DEMO_SHEET_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST")
if [ -n "${DEMO_SHEET_KEEP_SNAPSHOT:-}" ]; then cp "$SNAP" "$DEMO_SHEET_KEEP_SNAPSHOT"; fi
echo "== 2. this branch"
env -i PATH="$PATH" HOME="$HOME" DEMO_SHEET_DB_URL="$URL" DEMO_SHEET_PHASE=branch \
  DEMO_SHEET_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST"
