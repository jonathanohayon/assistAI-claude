#!/usr/bin/env bash
# Runs scripts/tests/campaigns-plan-gate-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:55474, data in the git-ignored .tmp/ folder), then stops it:
#   1. origin/main's tree: the scenario through main's handlers → snapshot;
#   2. this branch: admin + entitled plan byte-identical to the snapshot, a plan
#      without the feature refused, test-call limits.
# The session and the dial are test doubles (module hooks): nothing is dialled.
# Never uses DATABASE_URL from your shell; clean env (no LiveKit/Twilio key).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55474
TMP=".tmp/campaigns-plan-gate"
DIR="$TMP/pg"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
MAIN="$TMP/main-tree"
SNAP="$PWD/$TMP/main-snapshot.json"
HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
TEST="scripts/tests/campaigns-plan-gate-db.test.ts"
if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is busy, refusing to start" >&2
  exit 1
fi
rm -rf "$TMP" && mkdir -p "$TMP"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs

echo "== 1. origin/main handlers"
mkdir -p "$MAIN"
git archive origin/main | tar -x -C "$MAIN"
ln -s "$PWD/node_modules" "$MAIN/node_modules"
mkdir -p "$MAIN/scripts/tests/fixtures"
cp -R scripts/tests/fixtures/campaigns-plan-gate "$MAIN/scripts/tests/fixtures/"
cp "$TEST" "$MAIN/scripts/tests/"
(cd "$MAIN" && env -i PATH="$PATH" HOME="$HOME" CAMPGATE_DB_URL="$URL" CAMPGATE_PHASE=main \
  CAMPGATE_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST")
echo "== 2. this branch"
env -i PATH="$PATH" HOME="$HOME" CAMPGATE_DB_URL="$URL" CAMPGATE_PHASE=branch \
  CAMPGATE_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST"
