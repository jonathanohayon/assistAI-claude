#!/usr/bin/env bash
# Connectors B4 (create / edit / soft delete / test, behind CONNECTORS_WRITE)
# against a THROWAWAY Postgres (127.0.0.1:<free port>, data in the
# git-ignored .tmp/ folder), then stops it:
#   0. migration 0064 (connectors.deleted_at) writes NO data: on the seeded
#      database at 0063 (+ a mock connector and calls), the md5 of EVERY
#      public table's rows is identical before and after; the only schema
#      change is the nullable column; rows not rewritten (xmin); a re-run and
#      the raw SQL again are no-ops; the 41-case worker payload snapshot is
#      byte-identical at 0063 and at 0064 (zero connector rows);
#   1. scripts/tests/connectors-write-db.test.ts (switch per value, CRUD,
#      the 4 gate cases, limits, number conflicts, the soft delete, the secret
#      once, the legacy materialization, test → last_test_*);
#   2. worker payloads, an in-tree invariant (no main-vs-branch diff): with
#      CONNECTORS_WRITE unset, scripts/config-bytes-snapshot.ts before and
#      after calling every write route (as the seeded accounts, own scope and
#      admin ?asUserId) is byte-identical: the switch off writes nothing.
# Never uses DATABASE_URL from your shell; clean env.
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

q() { psql -X -q -At -v ON_ERROR_STOP=1 "$1" "${@:2}"; }

# ── 0. Migration 0064 writes no data ────────────────────────────────────
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0064_connectors_deleted_at
M="$BASE/m64"
psql -X -q -v ON_ERROR_STOP=1 "$URL" -c "CREATE DATABASE m64"
migrate_upto 0063_persona_resets "$M" "$TMP/work/m63"
psql -X -q -v ON_ERROR_STOP=1 "$M" -f scripts/fixtures/mission-m2a-seed.sql
q "$M" -c "INSERT INTO calls (user_id, from_number, to_number, duration_seconds) SELECT id, '+15550000201', '+15550000202', 60 FROM users"
mig_snapshot() { "${CLEAN[@]}" SNAP_OUT="$PWD/$TMP/$1" DATABASE_URL="$M" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts >/dev/null; }
[ "$(q "$M" -c 'SELECT count(*) FROM connectors')" = "0" ]
mig_snapshot snap-m63.json
q "$M" -c "INSERT INTO connectors (user_id, name, url, mode, secret, phone_number_id) SELECT user_id, 'Mock bot', 'https://agent.example.com/hook', 'lead', 'mock-secret', id FROM phone_numbers LIMIT 1;
           UPDATE calls SET connector_id = (SELECT id FROM connectors LIMIT 1) WHERE user_id = (SELECT user_id FROM connectors LIMIT 1)"
schema() { q "$M" -c "SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1"; }
schema > "$TMP/work/schema-before"
TABLES="$(q "$M" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")"
for t in $TABLES; do
  q "$M" -c "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$t'" > "$TMP/work/cols-$t"
done
snap() {
  for t in $TABLES; do
    q "$M" -c "SELECT '$t', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM (SELECT $(cat "$TMP/work/cols-$t") FROM \"$t\") x"
  done
}
snap > "$TMP/work/md5-before"
grep -q '^connectors|1|' "$TMP/work/md5-before"
XMIN() { q "$M" -c "SELECT (SELECT string_agg(xmin::text, ',' ORDER BY id) FROM connectors) || '/' || (SELECT string_agg(xmin::text, ',' ORDER BY id) FROM calls)"; }
XMIN_BEFORE="$(XMIN)"
LEDGER_BEFORE="$(q "$M" -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
migrate_upto 0064_connectors_deleted_at "$M" "$TMP/work/m64"
snap > "$TMP/work/md5-after"
schema > "$TMP/work/schema-after"
diff -u "$TMP/work/md5-before" "$TMP/work/md5-after" || { echo "migration 0064 changed table data" >&2; exit 1; }
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
[ "$SCHEMA_DIFF" = "> connectors.deleted_at timestamp with time zone YES " ] || { echo "unexpected schema diff:"; echo "$SCHEMA_DIFF"; exit 1; } >&2
[ "$(XMIN)" = "$XMIN_BEFORE" ] || { echo "migration 0064 rewrote connectors / calls rows" >&2; exit 1; }
[ "$(q "$M" -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q "$M" -c 'SELECT count(*) FROM connectors WHERE deleted_at IS NOT NULL')" = "0" ]
migrate_upto 0064_connectors_deleted_at "$M" "$TMP/work/m64b"
q "$M" -f drizzle/0064_connectors_deleted_at.sql
[ "$(q "$M" -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(XMIN)" = "$XMIN_BEFORE" ]
snap > "$TMP/work/md5-rerun"
cmp -s "$TMP/work/md5-before" "$TMP/work/md5-rerun"
# The payloads with zero connector rows: identical at 0063 and at 0064.
q "$M" -c "UPDATE calls SET connector_id = NULL; DELETE FROM connectors"
mig_snapshot snap-m64.json
cmp -s "$TMP/snap-m63.json" "$TMP/snap-m64.json" || { echo "payload snapshot differs at 0063 vs 0064 (zero rows)" >&2; exit 1; }
echo "migration 0064: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = connectors.deleted_at (nullable); xmin unchanged; ledger +1; re-run no-op; 41-case payloads identical at 0063 / 0064"

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
