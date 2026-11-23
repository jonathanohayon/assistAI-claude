#!/usr/bin/env bash
# The renewal reminder (migration 0061 + cron/billing Phase 4) against a
# THROWAWAY Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/
# folder), then stops it:
#   1. migration 0061 writes NO data: on a seeded database at 0060
#      (scripts/fixtures/mission-m2a-seed.sql + mock users / payment orders),
#      the md5 of EVERY public table's rows is identical before and after; the
#      only schema change is the new renewal_reminders table; ledger +1; users
#      rows are not rewritten (xmin); a re-run (and the raw SQL again) is a
#      no-op;
#   2. scripts/tests/renewal-reminder-db.test.ts through the real cron route
#      (switch off = byte-identical, on, re-run, concurrency, who never gets
#      it, fail-open), the sender injected: nothing is ever sent.
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/renewal-reminder-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway renewal-reminder
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }

# ── 1. Migration 0061 writes no data ────────────────────────────────────
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0061_renewal_reminders
migrate_upto 0060_payment_orders_products "$URL" "$TMP/work/m60"
q -f scripts/fixtures/mission-m2a-seed.sql
q -c "INSERT INTO users (id, email, password_hash, role, subscription_status, subscription_period, paid_until, locale) VALUES
        ('00000000-0000-4000-8000-0000000000f1', 'mig-admin@example.com', 'x', 'admin', 'active', 'monthly', now() + interval '2 days', 'fr'),
        ('00000000-0000-4000-8000-0000000000f2', 'mig-user@example.com', 'x', 'user', 'active', 'monthly', now() + interval '2 days', 'he');
      INSERT INTO payment_orders (user_id, plan_key, period, currency, coin, expected_amount, status, expires_at, paid_at, products) VALUES
        ('00000000-0000-4000-8000-0000000000f2', 'premium', 'monthly', 'ILS', '1', 10, 'paid', now(), now(), '[{\"kind\":\"base\",\"product\":\"reception\",\"period\":\"monthly\",\"amount\":10}]'::jsonb);
      INSERT INTO events (user_id, source, event, message) VALUES ('00000000-0000-4000-8000-0000000000f2', 'web', 'config_updated', 'mock');"
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
grep -q '^users|5|' "$TMP/work/md5-before"
grep -q '^payment_orders|1|' "$TMP/work/md5-before"
XMIN="$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")"
migrate_upto 0061_renewal_reminders "$URL" "$TMP/work/m61"
snap > "$TMP/work/md5-after"
schema > "$TMP/work/schema-after"
if ! diff -u "$TMP/work/md5-before" "$TMP/work/md5-after"; then
  echo "migration 0061 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
WANT_DIFF="> renewal_reminders.id uuid NO gen_random_uuid()
> renewal_reminders.period_end timestamp with time zone NO 
> renewal_reminders.sent_at timestamp with time zone NO now()
> renewal_reminders.user_id uuid NO "
[ "$SCHEMA_DIFF" = "$WANT_DIFF" ] || { echo "unexpected schema diff: $SCHEMA_DIFF" >&2; exit 1; }
[ "$(q -c 'SELECT count(*) FROM renewal_reminders')" = "0" ]
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")" = "$XMIN" ] || { echo "migration 0061 rewrote users rows" >&2; exit 1; }
# A re-run applies nothing; the raw SQL again is a no-op (idempotent).
migrate_upto 0061_renewal_reminders "$URL" "$TMP/work/m61b"
q -f drizzle/0061_renewal_reminders.sql 2>/dev/null
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")" = "$XMIN" ]
snap > "$TMP/work/md5-rerun"
cmp -s "$TMP/work/md5-before" "$TMP/work/md5-rerun"
echo "migration 0061: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = renewal_reminders only; ledger +1; users xmin unchanged; re-run no-op"

# ── 2. The DB test (every migration from here on), through the real route ─
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
# The route imports lib/email.ts (next-intl's getTranslations): the shared
# test tsconfig maps "next-intl/server" to a stand-in.
source scripts/lib/next-intl-stub-tsconfig.sh
write_next_intl_stub_tsconfig
"${CLEAN[@]}" TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" RENEWAL_REMINDER_DB_TEST_URL="$URL" \
  npx tsx scripts/tests/renewal-reminder-db.test.ts
