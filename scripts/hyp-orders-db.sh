#!/usr/bin/env bash
# HYP multi-line orders (P4: migration 0060 payment_orders.products; the
# products body of create-payment; the callback; the order email; invoice
# lines; overage) against a THROWAWAY Postgres (127.0.0.1:<free port>, data
# in the git-ignored .tmp/ folder), then stops it:
#   1. migration 0060 writes NO data: on the seeded database at 0059
#      (scripts/fixtures/mission-m2a-seed.sql + mock orders), the md5 of EVERY
#      public table's rows is identical before and after; the only schema
#      change is payment_orders.products (jsonb, nullable, no default, so
#      every existing order reads NULL = legacy); payment_orders rows are not
#      rewritten (xmin); a re-run (and the raw SQL again) is a no-op;
#   2. scripts/tests/hyp-orders-db.test.ts, in a clean env with NO HYP
#      variable (checked below): the legacy byte-identity against the
#      recorded fixture, the products body, the callback, the email, the
#      invoices, overage and concurrency. HYP is a mock (fetch refuses every
#      other host); emails go to a recording double.
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/hyp-orders-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  BASE="postgres://postgres@127.0.0.1:${PORT}"
  URL="$BASE/postgres"
  HOOKS="scripts/tests/fixtures/hyp-orders/hooks.mjs"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway hyp-orders
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }

# ── 1. Migration 0060 writes no data ────────────────────────────────────
# (Skipped in record mode: ORDERS_RECORD=<file> records the legacy capture,
# on a tree that may not have 0060.)
if [ -z "${ORDERS_RECORD:-}" ]; then
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0060_payment_orders_products
migrate_upto 0059_product_notify_requests "$URL" "$TMP/work/m59"
q -f scripts/fixtures/mission-m2a-seed.sql
q -c "INSERT INTO users (id, email, password_hash, products) VALUES ('00000000-0000-4000-8000-0000000000f1', 'mig@example.test', 'x', '{\"base\":\"reception\",\"addons\":[]}');
      INSERT INTO payment_orders (user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, paid_at, hyp_transaction_id, raw_response)
        VALUES ('00000000-0000-4000-8000-0000000000f1', 'global', 'monthly', 'EUR', '3', 89, 'paid', now(), now(), 'mock-txn-1', '{\"CCode\":\"0\"}'),
               ('00000000-0000-4000-8000-0000000000f1', 'premium', 'annual', 'ILS', '1', 6490, 'pending', now(), NULL, NULL, NULL);"
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
grep -q '^payment_orders|2|' "$TMP/work/md5-before"
XMIN="$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM payment_orders")"
migrate_upto 0060_payment_orders_products "$URL" "$TMP/work/m60"
snap > "$TMP/work/md5-after"
schema > "$TMP/work/schema-after"
if ! diff -u "$TMP/work/md5-before" "$TMP/work/md5-after"; then
  echo "migration 0060 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
WANT_DIFF="> payment_orders.products jsonb YES "
[ "$SCHEMA_DIFF" = "$WANT_DIFF" ] || { echo "unexpected schema diff: $SCHEMA_DIFF" >&2; exit 1; }
[ "$(q -c 'SELECT count(*) FROM payment_orders WHERE products IS NOT NULL')" = "0" ]
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM payment_orders")" = "$XMIN" ] || { echo "migration 0060 rewrote payment_orders rows" >&2; exit 1; }
migrate_upto 0060_payment_orders_products "$URL" "$TMP/work/m60b"
q -f drizzle/0060_payment_orders_products.sql 2>/dev/null
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM payment_orders")" = "$XMIN" ]
snap > "$TMP/work/md5-rerun"
cmp -s "$TMP/work/md5-before" "$TMP/work/md5-rerun"
echo "migration 0060: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = payment_orders.products jsonb NULL only; ledger +1; payment_orders xmin unchanged; re-run no-op"
fi

# ── 2. The DB test (a fresh database, every migration) ──────────────────
TEST_DB="$BASE/orders"
q -c "CREATE DATABASE orders"
"${CLEAN[@]}" DATABASE_URL="$TEST_DB" node scripts/migrate.mjs >/dev/null
# The test environment carries no HYP variable at all (paths aside).
N_HYP="$("${CLEAN[@]}" TZ=UTC ORDERS_DB_TEST_URL="$TEST_DB" env | grep -v '^\(PWD\|PATH\|HOME\|OLDPWD\)=' | grep -ci hyp || true)"
[ "$N_HYP" = "0" ] || { echo "HYP variables in the test env ($N_HYP)" >&2; exit 1; }
echo "test env: env | grep -ci hyp = $N_HYP (paths aside)"
"${CLEAN[@]}" TZ=UTC ORDERS_DB_TEST_URL="$TEST_DB" ${ORDERS_RECORD:+ORDERS_RECORD="$ORDERS_RECORD"} npx tsx --import "./$HOOKS" scripts/tests/hyp-orders-db.test.ts
