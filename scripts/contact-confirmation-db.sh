#!/usr/bin/env bash
# Verified numbers N1 against a THROWAWAY Postgres (127.0.0.1:55489, data in
# the git-ignored .tmp/ folder), stopped on exit. Discovered by
# `npm run test:db` (scripts/run-db-suites.sh). Needs initdb/pg_ctl/psql on
# PATH. Never uses DATABASE_URL from your shell; node runs with a clean env
# (no messaging, email or voice provider credential). set -e: nothing runs
# after a failed initdb / pg_ctl / check.
#
# 1. Migration 0051 writes NO data: on a seeded database put back in the
#    state before 0051 (column dropped, its ledger row removed), the md5 of
#    EVERY public table's rows (over the columns that existed before) is
#    identical before and after `node scripts/migrate.mjs`; the only schema
#    change is the new column; every row reads '{}'.
# 2. scripts/tests/contact-confirmation-db.test.ts (writes, admin confirm,
#    sends identical).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55489
DIR=".tmp/pg-contact-confirmation"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is busy, refusing to start" >&2
  exit 1
fi
rm -rf "$DIR" "$DIR.work" && mkdir -p "$DIR" "$DIR.work"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log" "$DIR.work"' EXIT
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }
migrate() { env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null; }

# ── 1. Migration 0051 writes no data ────────────────────────────────────
migrate
q -f scripts/fixtures/mission-m2a-seed.sql
# Mock contact values (existing accounts): owner WhatsApp, a parked
# transfer, a recap email; and a few rows in other tables.
q -c "UPDATE agent_configs SET owner_whatsapp = '+15550100001', owner_recap_email = 'owner@example.com', owner_recap_email_enabled = true WHERE user_id = '00000000-0000-0000-0000-00000000000a';
      UPDATE agent_configs SET owner_whatsapp = '+15550100002', transfer_number_parked = '+15550100003' WHERE user_id = '00000000-0000-0000-0000-00000000000b';
      INSERT INTO events (user_id, source, event, message) VALUES ('00000000-0000-0000-0000-00000000000a', 'web', 'config_updated', 'mock');
      INSERT INTO calls (user_id, duration_seconds) VALUES ('00000000-0000-0000-0000-00000000000a', 42);"
WHEN="$(node -e 'const j=require("./drizzle/meta/_journal.json");const e=j.entries.find(x=>x.tag==="0051_contact_confirmations");if(!e)process.exit(1);console.log(e.when)')"
LAST="$(node -e 'const j=require("./drizzle/meta/_journal.json");console.log(j.entries.at(-1).tag)')"
[ "$LAST" = "0051_contact_confirmations" ] || { echo "0051 must sort last (last is $LAST)" >&2; exit 1; }
# Back to the state before 0051.
q -c "ALTER TABLE agent_configs DROP COLUMN contact_confirmations"
[ "$(q -c "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN} RETURNING 1")" = "1" ]
LEDGER_BEFORE="$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
schema() { q -c "SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1"; }
schema > "$DIR.work/schema-before"
TABLES="$(q -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")"
for t in $TABLES; do
  q -c "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$t'" > "$DIR.work/cols-$t"
done
snap() {
  for t in $TABLES; do
    q -c "SELECT '$t', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM (SELECT $(cat "$DIR.work/cols-$t") FROM \"$t\") x"
  done
}
snap > "$DIR.work/md5-before"
grep -q '^agent_configs|3|' "$DIR.work/md5-before"
migrate
snap > "$DIR.work/md5-after"
schema > "$DIR.work/schema-after"
if ! diff -u "$DIR.work/md5-before" "$DIR.work/md5-after"; then
  echo "migration 0051 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$DIR.work/schema-before" "$DIR.work/schema-after" | grep '^[<>]' || true)"
[ "$SCHEMA_DIFF" = "> agent_configs.contact_confirmations jsonb NO '{}'::jsonb" ] || { echo "unexpected schema diff: $SCHEMA_DIFF" >&2; exit 1; }
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c "SELECT count(*) FROM agent_configs WHERE contact_confirmations <> '{}'::jsonb")" = "0" ]
# A re-run applies nothing and rewrites nothing.
XMIN="$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM agent_configs")"
migrate
q -f drizzle/0051_contact_confirmations.sql 2>/dev/null
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM agent_configs")" = "$XMIN" ]
echo "migration 0051: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = the new column only; ledger +1; re-run no-op"

# ── 2. Writes, admin confirm, sends ─────────────────────────────────────
# /api/calls/end calls next-intl's getTranslations: the shared test tsconfig
# maps "next-intl/server" to a stand-in (scripts/lib/next-intl-stub-tsconfig.sh).
source scripts/lib/next-intl-stub-tsconfig.sh
write_next_intl_stub_tsconfig
env -i PATH="$PATH" HOME="$HOME" TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" CONTACT_CONFIRMATION_TEST_DB_URL="$URL" \
  npx tsx scripts/tests/contact-confirmation-db.test.ts
