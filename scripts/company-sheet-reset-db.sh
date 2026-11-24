#!/usr/bin/env bash
# The admin company-sheet reset (migration 0064 + /api/admin/users/[userId]/reset-company-sheet)
# against a THROWAWAY Postgres (127.0.0.1:<free port>, data in the
# git-ignored .tmp/ folder), then stops it:
#   1. migration 0064 writes NO data: on a seeded database at 0063
#      (scripts/fixtures/mission-m2a-seed.sql + a mock admin + mock persona
#      resets), the md5 of EVERY public table's rows (over the columns that
#      existed before) is identical before and after; the only schema change
#      is persona_resets.kind (default 'persona', which every existing row
#      reads); ledger +1; no row rewritten (xmin); a re-run (and the raw SQL
#      again) is a no-op;
#   2. scripts/tests/company-sheet-reset-db.test.ts through the real routes
#      (gate cases, the reset, the inbound prompt, the undo rule, kinds
#      independent, the persona routes unchanged).
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/company-sheet-reset-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway company-sheet-reset
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }

# ── 1. Migration 0064 writes no data ────────────────────────────────────
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0064_persona_resets_kind
migrate_upto 0063_persona_resets "$URL" "$TMP/work/m63pre"
q -f scripts/fixtures/mission-m2a-seed.sql
q -c "INSERT INTO users (id, email, password_hash, role, locale) VALUES
        ('00000000-0000-4000-8000-0000000000f1', 'mig-admin@example.test', 'x', 'admin', 'fr');
      INSERT INTO events (user_id, source, event, message) VALUES ('00000000-0000-4000-8000-0000000000f1', 'web', 'config_updated', 'mock');
      INSERT INTO persona_resets (user_id, previous, applied, by_admin, undone_at) VALUES
        ('00000000-0000-4000-8000-0000000000f1', '{\"instructions\":\"Mock old\",\"greetingInstructions\":\"G\",\"agentName\":\"N\",\"personaConfig\":null}', '{\"instructions\":\"Mock new\",\"greetingInstructions\":\"G2\",\"agentName\":\"Tamara\"}', '00000000-0000-4000-8000-0000000000f1', NULL),
        ('00000000-0000-4000-8000-0000000000f1', '{\"instructions\":\"Mock older\",\"greetingInstructions\":\"G\",\"agentName\":\"N\"}', '{\"instructions\":\"Mock new\",\"greetingInstructions\":\"G2\",\"agentName\":\"Tamara\"}', NULL, now());"
LEDGER_BEFORE="$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
schema() { q -c "SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1"; }
schema > "$TMP/work/schema-before"
TABLES="$(q -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")"
# The column lists are taken BEFORE the migration: the md5 covers every column
# that existed, so "unchanged" means every existing value is untouched.
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
grep -q '^agent_configs|3|' "$TMP/work/md5-before"
grep -q '^persona_resets|2|' "$TMP/work/md5-before"
xmin_now() { q -c "SELECT (SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users) || '/' || (SELECT string_agg(xmin::text, ',' ORDER BY id) FROM agent_configs) || '/' || (SELECT string_agg(xmin::text, ',' ORDER BY id) FROM persona_resets)"; }
XMIN="$(xmin_now)"
migrate_upto 0064_persona_resets_kind "$URL" "$TMP/work/m64"
snap > "$TMP/work/md5-after"
schema > "$TMP/work/schema-after"
if ! diff -u "$TMP/work/md5-before" "$TMP/work/md5-after"; then
  echo "migration 0064 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
WANT_DIFF="> persona_resets.kind text NO 'persona'::text"
[ "$SCHEMA_DIFF" = "$WANT_DIFF" ] || { echo "unexpected schema diff: $SCHEMA_DIFF" >&2; exit 1; }
[ "$(q -c "SELECT count(*) FROM persona_resets WHERE kind = 'persona'")" = "2" ] || { echo "existing resets must read kind = persona" >&2; exit 1; }
[ "$(q -c "SELECT count(*) FROM pg_constraint WHERE conname = 'persona_resets_kind_check'")" = "1" ]
if q -c "INSERT INTO persona_resets (user_id, previous, applied, kind) VALUES ('00000000-0000-4000-8000-0000000000f1', '{}', '{}', 'other')" 2>/dev/null; then
  echo "the kind CHECK accepted an unknown kind" >&2; exit 1
fi
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(xmin_now)" = "$XMIN" ] || { echo "migration 0064 rewrote users / agent_configs / persona_resets rows" >&2; exit 1; }
# A re-run applies nothing; the raw SQL again is a no-op (idempotent).
migrate_upto 0064_persona_resets_kind "$URL" "$TMP/work/m64b"
q -f drizzle/0064_persona_resets_kind.sql 2>/dev/null
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(xmin_now)" = "$XMIN" ]
snap > "$TMP/work/md5-rerun"
cmp -s "$TMP/work/md5-before" "$TMP/work/md5-rerun"
md5of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
echo "migration 0064: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after (md5 of the per-table list $(md5of "$TMP/work/md5-after")); schema diff = persona_resets.kind only; existing rows = 'persona'; CHECK enforced; ledger +1; users + agent_configs + persona_resets xmin unchanged; re-run no-op"

# ── 2. The DB test (every migration from here on), through the real routes ─
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
"${CLEAN[@]}" COMPANY_SHEET_RESET_DB_TEST_URL="$URL" npx tsx --import "./$HOOKS" scripts/tests/company-sheet-reset-db.test.ts
