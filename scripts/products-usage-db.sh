#!/usr/bin/env bash
# P2 (calls.product + usage_warnings, migration 0056; per-product usage;
# usage warnings) against a THROWAWAY Postgres (127.0.0.1:<free port>, data
# in the git-ignored .tmp/ folder), then stops it:
#   1. migration 0056 writes NO data: on the seeded database at 0055
#      (scripts/fixtures/mission-m2a-seed.sql + mock rows), the md5 of EVERY
#      public table's rows (over the columns that existed before) is
#      identical before and after; the only schema change is calls.product
#      and the new usage_warnings table; every calls row reads NULL; calls
#      rows are not rewritten (xmin); a re-run (and the raw SQL again) is a
#      no-op;
#   2. scripts/tests/products-usage-db.test.ts (billing-stats, dashboard
#      calls / logs, warnings, concurrency);
#   3. worker payloads: scripts/config-bytes-snapshot.ts on ONE seeded
#      database with every calls.product NULL, then set on every row:
#      byte-identical (calls.product is never served to the worker).
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
TMP=".tmp/products-usage-${PORT}"
DIR="$TMP/pg"
BASE="postgres://postgres@127.0.0.1:${PORT}"
URL="$BASE/postgres"
HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
rm -rf "$TMP" && mkdir -p "$TMP/work"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }

# ── 1. Migration 0056 writes no data ────────────────────────────────────
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0056_products_usage
migrate_upto 0055_account_products "$URL" "$TMP/work/m55"
q -f scripts/fixtures/mission-m2a-seed.sql
q -c "INSERT INTO users (id, email, password_hash, role, developer_mode, products) VALUES ('00000000-0000-4000-8000-0000000000f1', 'mig@example.test', 'x', 'admin', true, '{\"base\":\"sales\",\"addons\":[]}');
      INSERT INTO events (user_id, source, event, message) VALUES ('00000000-0000-0000-0000-00000000000a', 'web', 'config_updated', 'mock');
      INSERT INTO calls (user_id, duration_seconds) VALUES ('00000000-0000-0000-0000-00000000000a', 42), ('00000000-0000-4000-8000-0000000000f1', 7);"
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
grep -q '^calls|2|' "$TMP/work/md5-before"
grep -q '^users|4|' "$TMP/work/md5-before"
XMIN="$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM calls")"
migrate_upto 0056_products_usage "$URL" "$TMP/work/m56"
snap > "$TMP/work/md5-after"
schema > "$TMP/work/schema-after"
if ! diff -u "$TMP/work/md5-before" "$TMP/work/md5-after"; then
  echo "migration 0056 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
WANT_DIFF="> calls.product text YES 
> usage_warnings.entry text NO 
> usage_warnings.id uuid NO gen_random_uuid()
> usage_warnings.period_start timestamp with time zone NO 
> usage_warnings.sent_at timestamp with time zone NO now()
> usage_warnings.threshold integer NO 
> usage_warnings.user_id uuid NO "
[ "$SCHEMA_DIFF" = "$WANT_DIFF" ] || { echo "unexpected schema diff: $SCHEMA_DIFF" >&2; exit 1; }
[ "$(q -c 'SELECT count(*) FROM usage_warnings')" = "0" ]
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c 'SELECT count(*) FROM calls WHERE product IS NOT NULL')" = "0" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM calls")" = "$XMIN" ] || { echo "migration 0056 rewrote calls rows" >&2; exit 1; }
# A re-run applies nothing; the raw SQL again is a no-op (idempotent).
migrate_upto 0056_products_usage "$URL" "$TMP/work/m56b"
q -f drizzle/0056_products_usage.sql 2>/dev/null
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM calls")" = "$XMIN" ]
snap > "$TMP/work/md5-rerun"
cmp -s "$TMP/work/md5-before" "$TMP/work/md5-rerun"
echo "migration 0056: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = calls.product + usage_warnings only; ledger +1; calls xmin unchanged; re-run no-op"

# ── 2. The DB test (every migration from here on) ───────────────────────
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
"${CLEAN[@]}" PRODUCTS_USAGE_DB_TEST_URL="$URL" npx tsx --import "./$HOOKS" scripts/tests/products-usage-db.test.ts

# ── 3. Worker payloads: calls.product never changes a worker payload ───
# A permanent invariant (not a main-vs-branch diff): ONE throwaway database
# with this tree's migrations + the seed + mock calls rows. Snapshot with
# every calls.product NULL, then set on every row: byte-identical.
SNAP="$BASE/snap"
q -c "CREATE DATABASE snap"
"${CLEAN[@]}" DATABASE_URL="$SNAP" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$SNAP" -f scripts/fixtures/mission-m2a-seed.sql
sq() { psql -X -q -At -v ON_ERROR_STOP=1 "$SNAP" "$@"; }
sq -c "INSERT INTO calls (user_id, from_number, to_number, duration_seconds) SELECT id, '+15550000201', '+15550000202', 60 FROM users"
[ "$(sq -c "SELECT count(*) FROM calls")" -gt 0 ]
[ "$(sq -c "SELECT count(*) FROM calls WHERE product IS NOT NULL")" = "0" ]
snapshot() { "${CLEAN[@]}" SNAP_OUT="$PWD/$TMP/$1" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts; }
snapshot snap-null.json
sq -c "UPDATE calls SET product = CASE WHEN user_id::text LIKE '%a' THEN 'connect' ELSE 'sales' END"
[ "$(sq -c "SELECT count(*) FROM calls WHERE product IS NULL")" = "0" ]
snapshot snap-product.json
N="$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length)' "$TMP/snap-null.json")"
[ "$N" -gt 0 ] || { echo "empty payload snapshot" >&2; exit 1; }
if ! cmp -s "$TMP/snap-null.json" "$TMP/snap-product.json"; then
  echo "payload snapshot differs (calls.product changed a worker payload)" >&2
  node -e '
    const fs = require("fs");
    const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.error("  differs: " + k);
    }' "$TMP/snap-null.json" "$TMP/snap-product.json"
  exit 1
fi
echo "worker payloads: ${N} responses byte-identical with every calls.product NULL and set (md5 $(md5 -q "$TMP/snap-null.json" 2>/dev/null || md5sum "$TMP/snap-null.json" | cut -d' ' -f1))"
