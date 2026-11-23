#!/usr/bin/env bash
# "Prévenez-moi" (migration 0059 product_notify_requests; the notify POST;
# accountProducts.notifyRequested; the admin counts) against a THROWAWAY
# Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder),
# then stops it:
#   1. migration 0059 writes NO data: on the seeded database at 0058
#      (scripts/fixtures/mission-m2a-seed.sql + mock rows), the md5 of EVERY
#      public table's rows is identical before and after; the only schema
#      change is the new product_notify_requests table (empty); users rows
#      are not rewritten (xmin); a re-run (and the raw SQL again) is a no-op;
#   2. scripts/tests/product-notify-db.test.ts (POST gate cases, refusals,
#      idempotence, concurrency, accountProducts.notifyRequested, admin
#      counts, FK cascade, no email);
#   3. worker payloads: scripts/config-bytes-snapshot.ts on ONE seeded
#      database with no notify row, then with every account holding a row for
#      every entry: byte-identical (never served to the worker).
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/product-notify-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  BASE="postgres://postgres@127.0.0.1:${PORT}"
  URL="$BASE/postgres"
  HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway product-notify
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }

# ── 1. Migration 0059 writes no data ────────────────────────────────────
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0059_product_notify_requests
migrate_upto 0058_users_sales_engine_override "$URL" "$TMP/work/m58"
q -f scripts/fixtures/mission-m2a-seed.sql
q -c "INSERT INTO users (id, email, password_hash, role, developer_mode, products) VALUES ('00000000-0000-4000-8000-0000000000f1', 'mig@example.test', 'x', 'admin', true, '{\"base\":\"sales\",\"addons\":[]}');
      INSERT INTO account_product_trials (user_id, product, ends_at, minutes_included) VALUES ('00000000-0000-4000-8000-0000000000f1', 'connect', now() + interval '6 days', 30);
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
grep -q '^users|4|' "$TMP/work/md5-before"
grep -q '^account_product_trials|1|' "$TMP/work/md5-before"
XMIN="$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")"
migrate_upto 0059_product_notify_requests "$URL" "$TMP/work/m59"
snap > "$TMP/work/md5-after"
schema > "$TMP/work/schema-after"
if ! diff -u "$TMP/work/md5-before" "$TMP/work/md5-after"; then
  echo "migration 0059 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
WANT_DIFF="> product_notify_requests.id uuid NO gen_random_uuid()
> product_notify_requests.product text NO 
> product_notify_requests.requested_at timestamp with time zone NO now()
> product_notify_requests.user_id uuid NO "
[ "$SCHEMA_DIFF" = "$WANT_DIFF" ] || { echo "unexpected schema diff: $SCHEMA_DIFF" >&2; exit 1; }
[ "$(q -c 'SELECT count(*) FROM product_notify_requests')" = "0" ]
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")" = "$XMIN" ] || { echo "migration 0059 rewrote users rows" >&2; exit 1; }
# A re-run applies nothing; the raw SQL again is a no-op (idempotent).
migrate_upto 0059_product_notify_requests "$URL" "$TMP/work/m59b"
q -f drizzle/0059_product_notify_requests.sql 2>/dev/null
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")" = "$XMIN" ]
[ "$(q -c "SELECT count(*) FROM pg_constraint WHERE conrelid = 'product_notify_requests'::regclass")" = "4" ]
snap > "$TMP/work/md5-rerun"
cmp -s "$TMP/work/md5-before" "$TMP/work/md5-rerun"
echo "migration 0059: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = product_notify_requests only (empty); ledger +1; users xmin unchanged; re-run no-op"

# ── 2. The DB test (every migration from here on) ───────────────────────
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
"${CLEAN[@]}" PRODUCT_NOTIFY_DB_TEST_URL="$URL" npx tsx --import "./$HOOKS" scripts/tests/product-notify-db.test.ts

# ── 3. Worker payloads: notify rows never change one ────────────────────
# A permanent invariant (not a main-vs-branch diff): ONE throwaway database
# with this tree's migrations + the seed + mock calls rows. Snapshot with no
# notify row, then with a row for every entry on every account:
# byte-identical.
SNAP="$BASE/snap"
q -c "CREATE DATABASE snap"
"${CLEAN[@]}" DATABASE_URL="$SNAP" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$SNAP" -f scripts/fixtures/mission-m2a-seed.sql
sq() { psql -X -q -At -v ON_ERROR_STOP=1 "$SNAP" "$@"; }
sq -c "INSERT INTO calls (user_id, from_number, to_number, duration_seconds) SELECT id, '+15550000201', '+15550000202', 60 FROM users"
[ "$(sq -c "SELECT count(*) FROM product_notify_requests")" = "0" ]
snapshot() { "${CLEAN[@]}" SNAP_OUT="$PWD/$TMP/$1" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts; }
snapshot snap-none.json
sq -c "INSERT INTO product_notify_requests (user_id, product) SELECT u.id, e.p FROM users u CROSS JOIN (VALUES ('reception'), ('sales'), ('connect')) AS e(p)"
[ "$(sq -c "SELECT count(*) FROM product_notify_requests")" = "$(( $(sq -c 'SELECT count(*) FROM users') * 3 ))" ]
snapshot snap-notify.json
N="$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length)' "$TMP/snap-none.json")"
[ "$N" -gt 0 ] || { echo "empty payload snapshot" >&2; exit 1; }
if ! cmp -s "$TMP/snap-none.json" "$TMP/snap-notify.json"; then
  echo "payload snapshot differs (notify rows changed a worker payload)" >&2
  node -e '
    const fs = require("fs");
    const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.error("  differs: " + k);
    }' "$TMP/snap-none.json" "$TMP/snap-notify.json"
  exit 1
fi
echo "worker payloads: ${N} responses byte-identical with no notify row vs a row per account × entry (md5 $(md5 -q "$TMP/snap-none.json" 2>/dev/null || md5sum "$TMP/snap-none.json" | cut -d' ' -f1))"
