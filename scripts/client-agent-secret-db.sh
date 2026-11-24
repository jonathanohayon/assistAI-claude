#!/usr/bin/env bash
# "Ask your agent": switching it ON creates a secret (shown once), never an
# unsigned call. Runs scripts/tests/client-agent-secret-db.test.ts against a
# THROWAWAY Postgres (127.0.0.1:<free port>, data in the git-ignored .tmp/
# folder), seeded with the mock seed, then stops it. Needs initdb/pg_ctl/psql
# on PATH. Never uses DATABASE_URL from your shell; node runs with a clean env
# (no provider credential), CLIENT_AGENT=all and a MOCK SECRETS_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  DIR=".tmp/pg-client-agent-secret-${PORT}"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  rm -rf "$DIR" && mkdir -p "$DIR"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"'
pg_start_throwaway client-agent-secret
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
psql -X -q -v ON_ERROR_STOP=1 "$URL" -f scripts/fixtures/mission-m2a-seed.sql
MOCK_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
"${CLEAN[@]}" CLIENT_AGENT=all SECRETS_KEY="$MOCK_KEY" SECRETS_KEY_ID=mock1 CLIENT_AGENT_SECRET_DB_TEST_URL="$URL" \
  npx tsx --import ./scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs scripts/tests/client-agent-secret-db.test.ts
