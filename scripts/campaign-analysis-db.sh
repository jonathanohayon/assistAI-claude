#!/usr/bin/env bash
# Runs scripts/tests/campaign-analysis-db.test.ts against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it:
#   1. origin/main's tree: results GET (all calls analysed), campaign-result
#      POST and a cron tick through main's handlers → snapshot;
#   2. this branch: same bytes, GET read-only, analysis after the call,
#      write-once claim, bounded catch-up, retry policy.
# The session is a test double (module hooks); the LLM is injected; dispatch
# stays off: nothing is dialled, no provider is called. Never uses
# DATABASE_URL from your shell; clean env (no provider key is visible).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
TMP=".tmp/campaign-analysis-${PORT}"
DIR="$TMP/pg"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
MAIN="$TMP/main-tree"
SNAP="$PWD/$TMP/main-snapshot.json"
HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
TEST="scripts/tests/campaign-analysis-db.test.ts"
rm -rf "$TMP" && mkdir -p "$TMP"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
mkdir -p "$MAIN"
git archive origin/main | tar -x -C "$MAIN"
ln -s "$PWD/node_modules" "$MAIN/node_modules"

echo "== 0. migration 0053 is add-only: table md5 before/after, on origin/main's schema"
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0053_campaign_calls_analysis_claim
(cd "$MAIN" && "${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs)
psql -q -v ON_ERROR_STOP=1 "$URL" <<'SQL'
INSERT INTO users (id, email, password_hash) VALUES ('00000000-0000-4000-8000-0000000000f1', 'mig@example.test', 'x');
INSERT INTO campaigns (id, user_id, name) VALUES ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f1', 'Mock');
INSERT INTO campaign_contacts (id, campaign_id, user_id, phone_number) VALUES
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f1', '+15555550100');
INSERT INTO campaign_calls (campaign_id, contact_id, user_id, outcome, disposition, sentiment, summary, transcript) VALUES
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f1', 'connected', 'success', 'positive', 'Mock', '[{"role":"user","text":"Mock"}]'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000f1', 'connected', '', '', '', '[{"role":"user","text":"Mock"}]');
SQL
md5q="SELECT md5(string_agg(t::text, ';' ORDER BY t::text)) FROM (SELECT id, campaign_id, contact_id, user_id, call_id, phone_number, outcome, disposition, sentiment, summary, transcript, extracted, duration_seconds, cost_cents, created_at, worker_call_id FROM campaign_calls) t"
before="$(psql -At "$URL" -c "$md5q")"
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs
after="$(psql -At "$URL" -c "$md5q")"
[ -n "$before" ] && [ "$before" = "$after" ] || { echo "campaign_calls md5 changed by the migration" >&2; exit 1; }
[ "$(psql -At "$URL" -c "SELECT count(*) FROM campaign_calls WHERE analysis_claim IS NOT NULL")" = "0" ]
echo "ok: campaign_calls md5 identical ($after), analysis_claim NULL on every row"
psql -q "$URL" -c "DELETE FROM users WHERE id = '00000000-0000-4000-8000-0000000000f1'"

echo "== 1. origin/main handlers"
cp "$TEST" "$MAIN/scripts/tests/"
(cd "$MAIN" && "${CLEAN[@]}" ANALYSIS_DB_TEST_URL="$URL" ANALYSIS_DB_PHASE=main \
  ANALYSIS_DB_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST")
echo "== 2. this branch"
"${CLEAN[@]}" ANALYSIS_DB_TEST_URL="$URL" ANALYSIS_DB_PHASE=branch \
  ANALYSIS_DB_SNAPSHOT="$SNAP" npx tsx --import "./$HOOKS" "$TEST"
