#!/usr/bin/env bash
# Finance per engine / model (E3) against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it:
# scripts/tests/finance-by-engine-db.test.ts seeds mock calls + usage events
# and checks GET /api/admin/finance-stats: byEngine grouping (event metadata,
# the calls fallback, unknown), costs, Σ byEngine == totals.openai, and that
# the response minus byEngine is byte-identical to computeFinanceStatsBase.
# No migration. Never uses DATABASE_URL from your shell; clean env.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/finance-by-engine-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  BASE="postgres://postgres@127.0.0.1:${PORT}"
  URL="$BASE/postgres"
  HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
  rm -rf "$TMP" && mkdir -p "$TMP/work"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway finance-by-engine
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
"${CLEAN[@]}" ${FINANCE_MAIN_MODULE:+FINANCE_MAIN_MODULE="$FINANCE_MAIN_MODULE"} FINANCE_BY_ENGINE_DB_TEST_URL="$URL" npx tsx --import "./$HOOKS" scripts/tests/finance-by-engine-db.test.ts
