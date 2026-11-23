#!/usr/bin/env bash
# Engine override per product (E2) against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it:
#   0. migration 0058 (users.sales_engine_override, E2b) writes NO data: on a
#      seeded database at 0057, the md5 of EVERY public table's rows is
#      identical before and after; the only schema change is the new nullable
#      column; users rows are not rewritten (xmin); a re-run is a no-op;
#   1. scripts/tests/engine-override-db.test.ts: the admin catalogue route
#      (gate cases, set / re-send / omitted / clear / not honoured), public
#      pricing never carries it, the banner endpoint, the language guard on
#      the call path (today's payload + one deduplicated alert);
#   2. worker payloads, scripts/config-bytes-snapshot.ts on ONE seeded
#      database (scripts/fixtures/mission-m2a-seed.sql, every migration):
#      (b) the catalogue row ABSENT vs PRESENT with no override → every case
#          byte-identical (a permanent invariant, never a main-vs-branch diff);
#      (c) an override set → ONLY the expected leaves change, on the expected
#          cases (pinned below); a client-set account, another product's
#          calls and the previews never change;
#      (d) E2b: users.sales_engine_override NULL vs set for ONE account →
#          only that account's campaign / outbound_test cases change (model
#          leaves only); inbound cases never change.
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/engine-override-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  BASE="postgres://postgres@127.0.0.1:${PORT}"
  URL="$BASE/postgres"
  HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
  DIFF="scripts/tests/fixtures/engine-override/payload-diff.mjs"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway engine-override
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)

# ── 0. Migration 0058 writes no data ───────────────────────────────────────
MIG="$BASE/mig"
psql -X -q -At "$URL" -c "CREATE DATABASE mig"
mq() { psql -X -q -At -v ON_ERROR_STOP=1 "$MIG" "$@"; }
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0058_users_sales_engine_override
migrate_upto 0057_product_trials "$MIG" "$TMP/work/m57"
mq -f scripts/fixtures/mission-m2a-seed.sql
mq -c "INSERT INTO users (id, email, password_hash, role, products) VALUES ('00000000-0000-4000-8000-0000000000f2', 'mig@engine.example.test', 'x', 'admin', '{\"base\":\"sales\",\"addons\":[]}');
       INSERT INTO calls (user_id, duration_seconds, product) VALUES ('00000000-0000-0000-0000-00000000000a', 42, 'sales');"
LEDGER_BEFORE="$(mq -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
mschema() { mq -c "SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1"; }
mschema > "$TMP/work/schema-before"
TABLES="$(mq -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")"
# The column lists are taken BEFORE the migration: the new column is not in
# the md5, so the md5 compares exactly the data that existed.
for t in $TABLES; do
  mq -c "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$t'" > "$TMP/work/cols-$t"
done
msnap() {
  for t in $TABLES; do
    mq -c "SELECT '$t', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM (SELECT $(cat "$TMP/work/cols-$t") FROM \"$t\") x"
  done
}
msnap > "$TMP/work/md5-before"
grep -q '^users|4|' "$TMP/work/md5-before"
XMIN="$(mq -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")"
migrate_upto 0058_users_sales_engine_override "$MIG" "$TMP/work/m58"
msnap > "$TMP/work/md5-after"
mschema > "$TMP/work/schema-after"
if ! diff -u "$TMP/work/md5-before" "$TMP/work/md5-after"; then
  echo "migration 0058 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
[ "$SCHEMA_DIFF" = "> users.sales_engine_override jsonb YES " ] || { echo "unexpected schema diff: $SCHEMA_DIFF" >&2; exit 1; }
[ "$(mq -c 'SELECT count(*) FROM users WHERE sales_engine_override IS NOT NULL')" = "0" ]
[ "$(mq -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(mq -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")" = "$XMIN" ] || { echo "migration 0058 rewrote users rows" >&2; exit 1; }
migrate_upto 0058_users_sales_engine_override "$MIG" "$TMP/work/m58b"
mq -f drizzle/0058_users_sales_engine_override.sql 2>/dev/null
[ "$(mq -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(mq -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")" = "$XMIN" ]
msnap > "$TMP/work/md5-rerun"
cmp -s "$TMP/work/md5-before" "$TMP/work/md5-rerun"
echo "migration 0058: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after (md5 of the per-table list $(md5 -q "$TMP/work/md5-after" 2>/dev/null || md5sum "$TMP/work/md5-after" | cut -d' ' -f1)); schema diff = users.sales_engine_override (nullable, all NULL); ledger +1; users xmin unchanged; re-run no-op"

# ── 1. The DB test ─────────────────────────────────────────────────────────
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$URL" -f scripts/fixtures/mission-m2a-seed.sql
"${CLEAN[@]}" ENGINE_OVERRIDE_DB_TEST_URL="$URL" npx tsx --import "./$HOOKS" scripts/tests/engine-override-db.test.ts

# ── 2. Worker payloads ─────────────────────────────────────────────────────
SNAP="$BASE/snap"
psql -X -q -At "$URL" -c "CREATE DATABASE snap"
"${CLEAN[@]}" DATABASE_URL="$SNAP" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$SNAP" -f scripts/fixtures/mission-m2a-seed.sql
sq() { psql -X -q -At -v ON_ERROR_STOP=1 "$SNAP" "$@"; }
snapshot() { "${CLEAN[@]}" SNAP_OUT="$PWD/$TMP/$1" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts >/dev/null; }
md5of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
# The row exactly as the admin route stores it (lib/product-catalogue-row.ts).
row() { "${CLEAN[@]}" npx tsx scripts/tests/fixtures/engine-override/row.ts "$1"; }
set_row() {
  row "$1" > "$TMP/work/row.json"
  # psql interpolates :'v' (quoted literal) only in script input, not in -c.
  sq -v v="$(cat "$TMP/work/row.json")" <<< "INSERT INTO app_settings (key, value) VALUES ('product_catalogue_v1', :'v') ON CONFLICT (key) DO UPDATE SET value = excluded.value"
  [ "$(sq -c "SELECT value FROM app_settings WHERE key = 'product_catalogue_v1'")" = "$(cat "$TMP/work/row.json")" ]
}
reset() { sq -c "DELETE FROM app_settings WHERE key IN ('product_catalogue_v1', 'admin_alert_ledger')"; }

reset
snapshot absent.json
N="$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length)' "$TMP/absent.json")"
[ "$N" -gt 0 ] || { echo "empty payload snapshot" >&2; exit 1; }
set_row '{}'
# A row with no override is the pre-E2 bytes (row.ts --plain = JSON.stringify(prices)).
[ "$(cat "$TMP/work/row.json")" = "$("${CLEAN[@]}" npx tsx scripts/tests/fixtures/engine-override/row.ts --plain)" ]
snapshot present.json
if ! cmp -s "$TMP/absent.json" "$TMP/present.json"; then
  echo "(b) payloads differ between no catalogue row and a row with no override:" >&2
  node "$DIFF" "$TMP/absent.json" "$TMP/present.json" >&2
  exit 1
fi
echo "(b) worker payloads: ${N} responses byte-identical, catalogue row absent vs present without override (md5 $(md5of "$TMP/absent.json") / $(md5of "$TMP/present.json"))"

# (c) An override set → only the pinned leaves change, on the pinned cases.
check() { # $1 = label, $2 = overrides JSON, $3 = the expected diff lines
  reset
  set_row "$2"
  snapshot "c-$1.json"
  node "$DIFF" "$TMP/absent.json" "$TMP/c-$1.json" > "$TMP/c-$1.diff"
  if [ "$(cat "$TMP/c-$1.diff")" != "$3" ]; then
    echo "(c) $1: unexpected payload diff (expected vs got):" >&2
    diff -u <(printf '%s\n' "$3") "$TMP/c-$1.diff" >&2 || true
    exit 1
  fi
  echo "(c) $1: $(grep -c . "$TMP/c-$1.diff" || true) changed leaves, as pinned (md5 $(md5of "$TMP/c-$1.json"))"
}
T=$'\t'
# The seed's three accounts are "trialing" → entitled to reception_multi
# (lib/product-entitlement.ts); a is client set (its own Grok), b (he) and c
# (en) are not.
# reception_multi → OpenAI gpt-realtime-2.1: b and c change their model only;
# a (client set), campaigns, outbound tests and previews don't move.
check multi-openai '{"reception_multi":{"engine":"openai","model":"gpt-realtime-2.1"}}' "$(printf '%s\n' \
  "config phone c${T}model" "config phone c${T}voiceConfig.advanced.model" \
  "config web b${T}model" "config web b${T}voiceConfig.advanced.model" \
  "session phone c${T}model" "session phone c${T}voiceConfig.advanced.model" \
  "session web b${T}model" "session web b${T}voiceConfig.advanced.model")"
# reception_multi → Grok: c (en) moves engine + voice (equivalence table); b (he:
# Grok speaks no Hebrew) is ignored → today's bytes (+ an admin alert).
check multi-xai '{"reception_multi":{"engine":"xai","model":null}}' "$(printf '%s\n' \
  "config phone c${T}realtimeProvider" "config phone c${T}voiceConfig.advanced.voiceOverrides.xai" "config phone c${T}voiceConfig.engine" "config phone c${T}voiceProfile.voiceOverrides.xai" \
  "session phone c${T}realtimeProvider" "session phone c${T}voiceConfig.advanced.voiceOverrides.xai" "session phone c${T}voiceConfig.engine" "session phone c${T}voiceProfile.voiceOverrides.xai")"
# reception (a product none of them has) → nothing moves.
check reception-unowned '{"reception":{"engine":"openai","model":"gpt-realtime-2.1"}}' ""
# sales → OpenAI gpt-realtime-2.1: every campaign / outbound test changes its
# model only; no realtimeProvider appears; inbound and previews don't move.
SALES=""
for c in "campaign d1" "campaign d2" "campaign d3" "campaign d4" "campaign d5" "campaign d6" "campaign d7" "campaign d8" "campaign d9" \
         "otest c1" "otest c2" "otest c3" \
         "session campaign d1" "session campaign d2" "session campaign d3" "session campaign d4" "session campaign d5" "session campaign d6" "session campaign d7" "session campaign d8" "session campaign d9" \
         "session outbound_test c1" "session outbound_test c2" "session outbound_test c3"; do
  SALES+="${c}${T}model"$'\n'"${c}${T}voiceConfig.advanced.model"$'\n'
done
check sales-openai '{"sales":{"engine":"openai","model":"gpt-realtime-2.1"}}' "$(printf '%s' "$SALES" | LC_ALL=C sort)"
reset

# (d) E2b: the client sales override on ONE account (b: agent c2, campaigns
# d2 + d9) → only b's campaign / outbound_test cases change, model leaves
# only; a's and c's sales calls, every inbound call and the previews don't.
[ "$(sq -c 'SELECT count(*) FROM users WHERE sales_engine_override IS NOT NULL')" = "0" ]
snapshot d-null.json
cmp -s "$TMP/absent.json" "$TMP/d-null.json" || { echo "(d) a NULL client sales override changed a payload" >&2; node "$DIFF" "$TMP/absent.json" "$TMP/d-null.json" >&2; exit 1; }
sq -c "UPDATE users SET sales_engine_override = '{\"engine\":\"openai\",\"model\":\"gpt-realtime-2.1\"}'::jsonb WHERE id = '00000000-0000-0000-0000-00000000000b'"
snapshot d-set.json
node "$DIFF" "$TMP/d-null.json" "$TMP/d-set.json" > "$TMP/d.diff"
DWANT=""
for c in "campaign d2" "campaign d9" "otest c2" "session campaign d2" "session campaign d9" "session outbound_test c2"; do
  DWANT+="${c}${T}model"$'\n'"${c}${T}voiceConfig.advanced.model"$'\n'
done
DWANT="$(printf '%s' "$DWANT" | LC_ALL=C sort)"
if [ "$(cat "$TMP/d.diff")" != "$DWANT" ]; then
  echo "(d) client sales override: unexpected payload diff (expected vs got):" >&2
  diff -u <(printf '%s\n' "$DWANT") "$TMP/d.diff" >&2 || true
  exit 1
fi
echo "(d) client sales override on one account: $(grep -c . "$TMP/d.diff") changed leaves, as pinned; inbound untouched (md5 null $(md5of "$TMP/d-null.json") / set $(md5of "$TMP/d-set.json"))"
sq -c "UPDATE users SET sales_engine_override = NULL"
grep -c -e engineOverride -e salesEngineOverride -e sales_engine_override "$TMP"/c-*.json "$TMP"/d-*.json >/dev/null && { echo "a payload carries an engine override" >&2; exit 1; } || true
echo "never served: no snapshot carries engineOverride / the client sales override"
