#!/usr/bin/env bash
# Connectors B1 (migration 0062 connectors + calls.connector_id /
# calls.client_agent_reached; GET /api/dashboard/connectors; the catalogue's
# connectorLimits) against a THROWAWAY Postgres (127.0.0.1:<free port>, data
# in the git-ignored .tmp/ folder), then stops it:
#   1. migration 0062 writes NO data: on the seeded database at 0061
#      (scripts/fixtures/mission-m2a-seed.sql + mock rows incl. calls), the
#      md5 of EVERY public table's rows is identical before and after; the
#      only schema change is the new connectors table (empty) and the two
#      nullable calls columns; users and calls rows are not rewritten (xmin);
#      a re-run (and the raw SQL again) is a no-op;
#   2. scripts/tests/connectors-db.test.ts (constraints, GET gate cases and
#      shape, no secret, legacy card, lastCallAt, limits, admin PUT, FKs);
#   3. worker payloads: scripts/config-bytes-snapshot.ts on ONE seeded
#      database with no connector, then with a connector on every number and
#      every call pointing at one: byte-identical (B1 changes no routing).
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/connectors-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  BASE="postgres://postgres@127.0.0.1:${PORT}"
  URL="$BASE/postgres"
  HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway connectors
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }

# ── 1. Migration 0062 writes no data ────────────────────────────────────
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0062_connectors
migrate_upto 0061_renewal_reminders "$URL" "$TMP/work/m61"
q -f scripts/fixtures/mission-m2a-seed.sql
q -c "UPDATE agent_configs SET tools_config = '{\"version\":1,\"booking\":{\"enabled\":true,\"defaultDurationMinutes\":null,\"minNoticeMinutes\":null},\"contacts\":{\"enabled\":true},\"transfer\":{\"enabled\":false,\"when\":\"always\"},\"orders\":{\"enabled\":false,\"ask\":\"\"},\"clientAgent\":{\"enabled\":true,\"url\":\"https://agent.example.com/hook\",\"mode\":\"lead\",\"secret\":\"mock-secret\"}}'::jsonb WHERE user_id = '00000000-0000-0000-0000-00000000000a';
      INSERT INTO calls (user_id, from_number, to_number, duration_seconds, product) SELECT id, '+15550000201', '+15550000202', 60, 'connect' FROM users;
      INSERT INTO events (user_id, source, event, message) VALUES ('00000000-0000-0000-0000-00000000000a', 'web', 'config_updated', 'mock');"
LEDGER_BEFORE="$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
schema() { q -c "SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1"; }
schema > "$TMP/work/schema-before"
TABLES="$(q -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")"
for t in $TABLES; do
  q -c "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$t'" > "$TMP/work/cols-$t"
done
snap() {
  for t in $TABLES; do
    q -c "SELECT '$t', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM (SELECT $(cat "$TMP/work/cols-$t") FROM \"$t\") x"
  done
}
snap > "$TMP/work/md5-before"
grep -q '^users|3|' "$TMP/work/md5-before"
grep -q '^calls|3|' "$TMP/work/md5-before"
XMIN() { q -c "SELECT (SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users) || '/' || (SELECT string_agg(xmin::text, ',' ORDER BY id) FROM calls)"; }
XMIN_BEFORE="$(XMIN)"
migrate_upto 0062_connectors "$URL" "$TMP/work/m62"
snap > "$TMP/work/md5-after"
schema > "$TMP/work/schema-after"
if ! diff -u "$TMP/work/md5-before" "$TMP/work/md5-after"; then
  echo "migration 0062 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
WANT_DIFF="> calls.client_agent_reached boolean YES 
> calls.connector_id uuid YES 
> connectors.created_at timestamp with time zone NO now()
> connectors.enabled boolean NO true
> connectors.id uuid NO gen_random_uuid()
> connectors.last_test_at timestamp with time zone YES 
> connectors.last_test_ok boolean YES 
> connectors.mode text NO 
> connectors.name text NO 
> connectors.phone_number_id uuid YES 
> connectors.secret text YES 
> connectors.updated_at timestamp with time zone NO now()
> connectors.url text NO ''::text
> connectors.user_id uuid NO 
> connectors.voice_config jsonb YES "
[ "$SCHEMA_DIFF" = "$WANT_DIFF" ] || { echo "unexpected schema diff:"; echo "$SCHEMA_DIFF"; exit 1; } >&2
[ "$(q -c 'SELECT count(*) FROM connectors')" = "0" ]
[ "$(q -c 'SELECT count(*) FROM calls WHERE connector_id IS NOT NULL OR client_agent_reached IS NOT NULL')" = "0" ]
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(XMIN)" = "$XMIN_BEFORE" ] || { echo "migration 0062 rewrote users / calls rows" >&2; exit 1; }
# A re-run applies nothing; the raw SQL again is a no-op (idempotent).
migrate_upto 0062_connectors "$URL" "$TMP/work/m62b"
q -f drizzle/0062_connectors.sql 2>/dev/null
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(XMIN)" = "$XMIN_BEFORE" ]
[ "$(q -c "SELECT count(*) FROM pg_constraint WHERE conrelid = 'connectors'::regclass AND contype IN ('p','u','c','f')")" = "5" ]
[ "$(q -c "SELECT count(*) FROM pg_constraint WHERE conrelid = 'calls'::regclass AND contype = 'f' AND conname = 'calls_connector_id_connectors_id_fk'")" = "1" ]
[ "$(q -c "SELECT count(*) FROM pg_indexes WHERE tablename = 'connectors' AND indexname = 'connectors_user_id_idx'")" = "1" ]
snap > "$TMP/work/md5-rerun"
cmp -s "$TMP/work/md5-before" "$TMP/work/md5-rerun"
echo "migration 0062: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = connectors (empty) + 2 nullable calls columns; ledger +1; users/calls xmin unchanged; re-run no-op"

# ── 2. The DB test (every migration from here on) ───────────────────────
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
"${CLEAN[@]}" CONNECTORS_DB_TEST_URL="$URL" npx tsx --import "./$HOOKS" scripts/tests/connectors-db.test.ts

# ── 3. Worker payloads: connector rows never change one ─────────────────
# A permanent invariant (not a main-vs-branch diff): ONE throwaway database
# with this tree's migrations + the seed + mock calls rows. Snapshot with no
# connector, then with a connector on every number and every call pointing at
# one: byte-identical.
SNAP="$BASE/snap"
q -c "CREATE DATABASE snap"
"${CLEAN[@]}" DATABASE_URL="$SNAP" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$SNAP" -f scripts/fixtures/mission-m2a-seed.sql
sq() { psql -X -q -At -v ON_ERROR_STOP=1 "$SNAP" "$@"; }
sq -c "INSERT INTO calls (user_id, from_number, to_number, duration_seconds) SELECT id, '+15550000201', '+15550000202', 60 FROM users"
[ "$(sq -c "SELECT count(*) FROM connectors")" = "0" ]
snapshot() { "${CLEAN[@]}" SNAP_OUT="$PWD/$TMP/$1" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts; }
snapshot snap-none.json
sq -c "INSERT INTO connectors (user_id, name, url, mode, secret, phone_number_id, voice_config) SELECT user_id, 'Mock bot', 'https://agent.example.com/hook', 'voice', 'mock-secret', id, '{\"voiceId\":\"mock\"}'::jsonb FROM phone_numbers;
       UPDATE calls c SET connector_id = k.id, client_agent_reached = true FROM connectors k WHERE k.user_id = c.user_id"
[ "$(sq -c "SELECT count(*) FROM connectors")" = "$(sq -c 'SELECT count(*) FROM phone_numbers')" ]
[ "$(sq -c "SELECT count(*) FROM calls WHERE connector_id IS NOT NULL")" -gt 0 ]
snapshot snap-connectors.json
N="$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length)' "$TMP/snap-none.json")"
[ "$N" -gt 0 ] || { echo "empty payload snapshot" >&2; exit 1; }
if ! cmp -s "$TMP/snap-none.json" "$TMP/snap-connectors.json"; then
  echo "payload snapshot differs (connector rows changed a worker payload)" >&2
  node -e '
    const fs = require("fs");
    const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.error("  differs: " + k);
    }' "$TMP/snap-none.json" "$TMP/snap-connectors.json"
  exit 1
fi
echo "worker payloads: ${N} responses byte-identical with no connector vs a connector on every number + every call linked (md5 $(md5 -q "$TMP/snap-none.json" 2>/dev/null || md5sum "$TMP/snap-none.json" | cut -d' ' -f1))"
