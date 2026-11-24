#!/usr/bin/env bash
# Connectors B2 (number → connector routing on the inbound call path) against
# a THROWAWAY Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/
# folder), then stops it:
#   1. scripts/tests/connector-route-db.test.ts: zero rows = the routing
#      bypassed (byte for byte); the connector's agent on its number, none on
#      the account's other numbers; OFF; its voice; the secret rules; the
#      fail-open throw injections; never-served fields;
#   2. worker payloads, scripts/config-bytes-snapshot.ts on ONE seeded
#      database with ZERO connector rows (a permanent invariant, never a
#      main-vs-branch diff): the CLIENT_AGENT switch off (no lookup at all)
#      vs "all" (the lookup runs, finds no row) → every case byte-identical;
#      then a connector on every number with the switch off → still
#      byte-identical (the switch off never routes).
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/connector-route-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  BASE="postgres://postgres@127.0.0.1:${PORT}"
  URL="$BASE/postgres"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway connector-route
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)

# ── 1. The DB test ─────────────────────────────────────────────────────────
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$URL" -f scripts/fixtures/mission-m2a-seed.sql
"${CLEAN[@]}" CONNECTOR_ROUTE_DB_TEST_URL="$URL" npx tsx scripts/tests/connector-route-db.test.ts

# ── 2. Worker payloads: zero rows never change one ─────────────────────────
SNAP="$BASE/snap"
psql -X -q -At "$URL" -c "CREATE DATABASE snap"
"${CLEAN[@]}" DATABASE_URL="$SNAP" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$SNAP" -f scripts/fixtures/mission-m2a-seed.sql
sq() { psql -X -q -At -v ON_ERROR_STOP=1 "$SNAP" "$@"; }
snapshot() { # $1 = out file, $2 = CLIENT_AGENT value ("" = unset)
  local sw=()
  [ -n "$2" ] && sw=(CLIENT_AGENT="$2")
  "${CLEAN[@]}" ${sw[@]+"${sw[@]}"} SNAP_OUT="$PWD/$TMP/$1" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts >/dev/null
}
md5of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
same() { # $1 $2 = files, $3 = label
  if ! cmp -s "$TMP/$1" "$TMP/$2"; then
    echo "payload snapshot differs: $3" >&2
    node -e '
      const fs = require("fs");
      const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.error("  differs: " + k);
      }' "$TMP/$1" "$TMP/$2"
    exit 1
  fi
}
[ "$(sq -c 'SELECT count(*) FROM connectors')" = "0" ]
snapshot zero-off.json ""
snapshot zero-all.json all
N="$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length)' "$TMP/zero-off.json")"
[ "$N" -gt 0 ] || { echo "empty payload snapshot" >&2; exit 1; }
same zero-off.json zero-all.json "zero rows: CLIENT_AGENT off vs all"
echo "worker payloads: ${N} responses byte-identical with zero connector rows, routing switch off vs on (md5 $(md5of "$TMP/zero-off.json") / $(md5of "$TMP/zero-all.json"))"
sq -c "INSERT INTO connectors (user_id, name, url, mode, secret, phone_number_id) SELECT user_id, 'Mock bot', 'https://bot.example.com/hook', 'voice', 'mock-secret', id FROM phone_numbers"
[ "$(sq -c 'SELECT count(*) FROM connectors')" = "$(sq -c 'SELECT count(*) FROM phone_numbers')" ]
snapshot rows-off.json ""
same zero-off.json rows-off.json "connector rows with CLIENT_AGENT off"
echo "worker payloads: ${N} responses byte-identical with a connector on every number and the switch off (md5 $(md5of "$TMP/rows-off.json"))"
