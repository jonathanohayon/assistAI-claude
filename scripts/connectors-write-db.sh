#!/usr/bin/env bash
# Connectors B4 (create / edit / test, behind CONNECTORS_WRITE; no DELETE)
# against a THROWAWAY Postgres (127.0.0.1:<free port>, data in the
# git-ignored .tmp/ folder), then stops it:
#   1. scripts/tests/connectors-write-db.test.ts (switch per value, CRUD,
#      the 4 gate cases, limits, number conflicts, DELETE 405, the secret
#      once, the legacy materialization, test → last_test_*);
#   2. worker payloads, an in-tree invariant (no main-vs-branch diff): with
#      CONNECTORS_WRITE unset, scripts/config-bytes-snapshot.ts before and
#      after calling every write route (as the seeded accounts, own scope and
#      admin ?asUserId) is byte-identical: the switch off writes nothing.
# No migration in B4. Never uses DATABASE_URL from your shell; clean env.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/connectors-write-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  BASE="postgres://postgres@127.0.0.1:${PORT}"
  URL="$BASE/postgres"
  HOOKS="scripts/tests/fixtures/connectors-write/hooks.mjs"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway connectors-write
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)

# ── 1. The DB test ──────────────────────────────────────────────────────
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
"${CLEAN[@]}" CONNECTORS_WRITE_DB_TEST_URL="$URL" npx tsx --import "./$HOOKS" scripts/tests/connectors-write-db.test.ts

# ── 2. Worker payloads: the switch off writes nothing ───────────────────
SNAP="$BASE/snap"
psql -X -q -v ON_ERROR_STOP=1 "$URL" -c "CREATE DATABASE snap"
"${CLEAN[@]}" DATABASE_URL="$SNAP" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$SNAP" -f scripts/fixtures/mission-m2a-seed.sql
sq() { psql -X -q -At -v ON_ERROR_STOP=1 "$SNAP" "$@"; }
sq -c "INSERT INTO calls (user_id, from_number, to_number, duration_seconds) SELECT id, '+15550000201', '+15550000202', 60 FROM users"
# A mock admin, so the probe also calls the routes as an admin via ?asUserId.
sq -c "INSERT INTO users (id, email, password_hash, role) VALUES ('00000000-0000-0000-0000-0000000000ad', 'admin@example.test', 'x', 'admin')"
snapshot() { "${CLEAN[@]}" SNAP_OUT="$PWD/$TMP/$1" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts; }
snapshot snap-before.json
"${CLEAN[@]}" CONNECTORS_WRITE_OFF_PROBE_URL="$SNAP" npx tsx --import "./$HOOKS" scripts/tests/connectors-write-off-probe.ts
snapshot snap-after.json
N="$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length)' "$TMP/snap-before.json")"
[ "$N" -gt 0 ] || { echo "empty payload snapshot" >&2; exit 1; }
if ! cmp -s "$TMP/snap-before.json" "$TMP/snap-after.json"; then
  echo "payload snapshot differs after the write routes with CONNECTORS_WRITE unset" >&2
  exit 1
fi
echo "worker payloads: ${N} responses byte-identical before / after every write route with CONNECTORS_WRITE unset"
