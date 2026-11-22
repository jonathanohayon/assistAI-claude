#!/usr/bin/env bash
# Engine override per product (E2) against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it:
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
#          calls and the previews never change.
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
TMP=".tmp/engine-override-${PORT}"
DIR="$TMP/pg"
BASE="postgres://postgres@127.0.0.1:${PORT}"
URL="$BASE/postgres"
HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
DIFF="scripts/tests/fixtures/engine-override/payload-diff.mjs"
rm -rf "$TMP" && mkdir -p "$TMP/work"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)

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
grep -c engineOverride "$TMP"/c-*.json >/dev/null && { echo "a payload carries engineOverride" >&2; exit 1; } || true
echo "never served: no snapshot carries engineOverride"
