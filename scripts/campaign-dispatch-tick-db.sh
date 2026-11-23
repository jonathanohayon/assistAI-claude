#!/usr/bin/env bash
# Runs scripts/tests/campaign-dispatch-tick-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then
# stops it. Proves the dispatcher's tick per CAMPAIGN_DISPATCH mode (off: none;
# dry: mode + counts, nothing claimed or dialled; on: mode), the campaigns
# list's `dispatchMode` and the live snapshot's `dispatcher.dispatchMode`.
# Session and dial are test doubles (module hooks): nothing is dialled.
# Never uses DATABASE_URL from your shell; clean env (no LiveKit/Twilio key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/campaign-dispatch-tick-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
  TEST="scripts/tests/campaign-dispatch-tick-db.test.ts"
  rm -rf "$TMP" && mkdir -p "$TMP"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway campaign-dispatch-tick
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" DISPATCH_TICK_DB_URL="$URL" npx tsx --import "./$HOOKS" "$TEST"
