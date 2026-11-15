#!/usr/bin/env bash
# Verified contacts N2 (the owner recap email confirmation code) against a
# THROWAWAY Postgres (127.0.0.1:55493, data in the git-ignored .tmp/ folder),
# stopped on exit. Discovered by `npm run test:db` (scripts/run-db-suites.sh).
# Needs initdb/pg_ctl/psql on PATH. Never uses DATABASE_URL from your shell;
# node runs with a clean env (no messaging, email or voice provider
# credential). set -e: nothing runs after a failed initdb / pg_ctl / check.
#
# 1. Migration 0052 is add-only and writes NO data: it sorts last, its SQL
#    has no INSERT/UPDATE/DELETE; on a seeded database put back in the state
#    before 0052 (table dropped, ledger row removed), the md5 of EVERY public
#    table's rows is identical before and after `node scripts/migrate.mjs`;
#    the only schema change is the new table, empty; a re-run is a no-op.
# 2. scripts/tests/recap-email-code-db.test.ts (the real wiring, sender injected).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55493
DIR=".tmp/pg-recap-email-code"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
TAG="0052_contact_confirmation_codes"
if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is busy, refusing to start" >&2
  exit 1
fi
rm -rf "$DIR" "$DIR.work" && mkdir -p "$DIR" "$DIR.work"
env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 initdb -D "$DIR" -A trust -U postgres >/dev/null
env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log" "$DIR.work"' EXIT
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }
migrate() { env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null; }

# ── 1. Migration 0052 is add-only and writes no data ────────────────────
source scripts/lib/migrate-upto.sh
LAST="$(node -e 'const j=require("./drizzle/meta/_journal.json");console.log(j.entries.at(-1).tag)')"
[ "$LAST" = "$TAG" ] || { echo "$TAG must sort last (last is $LAST)" >&2; exit 1; }
migration_sorts_after_all_before "$TAG"
# (The foreign key's "ON DELETE cascade ON UPDATE no action" is a clause, not a statement.)
if sed -E 's/ON (DELETE|UPDATE) (cascade|no action|restrict|set null)//gI' "drizzle/${TAG}.sql" | grep -Eiq '\b(insert|update|delete|truncate|drop|alter)\b'; then
  echo "$TAG must only CREATE (no INSERT/UPDATE/DELETE/ALTER/DROP)" >&2
  exit 1
fi
migrate
q -f scripts/fixtures/mission-m2a-seed.sql
# Mock rows in the tables the feature reads or writes: a recap address with
# an N1 record, a limiter ledger, an event.
q -c "UPDATE agent_configs SET owner_recap_email = 'owner@example.com', contact_confirmations = '{\"owner_recap_email\":{\"value\":\"owner@example.com\",\"state\":\"unconfirmed\",\"at\":\"2026-11-14T10:00:00.000Z\"}}' WHERE user_id = '00000000-0000-0000-0000-00000000000a';
      INSERT INTO app_settings (key, value) VALUES ('rate_limit:email_test', '{}');
      INSERT INTO events (user_id, source, event, message) VALUES ('00000000-0000-0000-0000-00000000000a', 'web', 'config_updated', 'mock');"
WHEN="$(TAG="$TAG" node -e 'const j=require("./drizzle/meta/_journal.json");const e=j.entries.find(x=>x.tag===process.env.TAG);if(!e)process.exit(1);console.log(e.when)')"
# Back to the state before 0052.
q -c "DROP TABLE contact_confirmation_codes"
[ "$(q -c "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN} RETURNING 1")" = "1" ]
LEDGER_BEFORE="$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
schema() { q -c "SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1"; }
schema > "$DIR.work/schema-before"
TABLES="$(q -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")"
snap() {
  for t in $TABLES; do
    q -c "SELECT '$t', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM \"$t\" x"
  done
}
snap > "$DIR.work/md5-before"
grep -q '^agent_configs|3|' "$DIR.work/md5-before"
grep -q '^events|1|' "$DIR.work/md5-before"
migrate
snap > "$DIR.work/md5-after"
schema > "$DIR.work/schema-after"
if ! diff -u "$DIR.work/md5-before" "$DIR.work/md5-after"; then
  echo "migration $TAG changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$DIR.work/schema-before" "$DIR.work/schema-after" | grep '^[<>]' | sed 's/^> //' || true)"
EXPECTED="contact_confirmation_codes.attempts integer NO 0
contact_confirmation_codes.code_hash text NO 
contact_confirmation_codes.created_at timestamp with time zone NO now()
contact_confirmation_codes.expires_at timestamp with time zone NO 
contact_confirmation_codes.kind text NO 
contact_confirmation_codes.salt text NO 
contact_confirmation_codes.user_id uuid NO 
contact_confirmation_codes.value_hash text NO "
[ "$SCHEMA_DIFF" = "$EXPECTED" ] || { echo "unexpected schema diff:"; echo "$SCHEMA_DIFF"; exit 1; } >&2
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c 'SELECT count(*) FROM contact_confirmation_codes')" = "0" ]
# A re-run applies nothing and rewrites nothing.
XMIN="$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM agent_configs")"
migrate
q -f "drizzle/${TAG}.sql" 2>/dev/null
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM agent_configs")" = "$XMIN" ]
snap > "$DIR.work/md5-rerun"
diff -u "$DIR.work/md5-before" "$DIR.work/md5-rerun"
echo "migration $TAG: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = the new table only; ledger +1; re-run no-op"

# ── 2. Send / confirm / limits / scans ─────────────────────────────────
# The real sender renders through next-intl's getTranslations: the shared
# test tsconfig maps "next-intl/server" to a stand-in.
source scripts/lib/next-intl-stub-tsconfig.sh
write_next_intl_stub_tsconfig
env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" RECAP_EMAIL_CODE_TEST_DB_URL="$URL" \
  npx tsx scripts/tests/recap-email-code-db.test.ts
