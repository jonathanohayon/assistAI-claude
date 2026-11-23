#!/usr/bin/env bash
# Runs scripts/tests/schedule-change-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it:
#   1. origin/main's tree: the scenario through main's handler → snapshot;
#   2. this branch: every case byte-identical to the snapshot, except a downgrade
#      to a non-public plan, now refused (400 plan_not_available, nothing written).
# The session is a test double (module hook). Mock data only.
# Never uses DATABASE_URL from your shell; clean env.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/schedule-change-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  MAIN="$TMP/main-tree"
  SNAP="$PWD/$TMP/main-snapshot.json"
  HOOKS="scripts/tests/fixtures/schedule-change/hooks.mjs"
  TEST="scripts/tests/schedule-change-db.test.ts"
  rm -rf "$TMP" && mkdir -p "$TMP"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway schedule-change
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs

echo "== 1. origin/main handlers"
mkdir -p "$MAIN"
git archive origin/main | tar -x -C "$MAIN"
ln -s "$PWD/node_modules" "$MAIN/node_modules"
mkdir -p "$MAIN/scripts/tests/fixtures"
cp -R scripts/tests/fixtures/schedule-change "$MAIN/scripts/tests/fixtures/"
cp "$TEST" "$MAIN/scripts/tests/"
(cd "$MAIN" && env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" SCHED_DB_URL="$URL" SCHED_PHASE=main \
  SCHED_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST")
echo "== 2. this branch"
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" SCHED_DB_URL="$URL" SCHED_PHASE=branch \
  SCHED_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST"
