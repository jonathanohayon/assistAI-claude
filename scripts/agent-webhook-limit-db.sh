#!/usr/bin/env bash
# Runs scripts/tests/agent-webhook-limit-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:55497, data in the git-ignored .tmp/ folder), then stops
# it. Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and
# runs with a clean env so no LLM provider credential is visible.
# The previous route (origin/main before the shared limit, pinned below) is
# copied into .tmp/ so the test can compare responses byte for byte.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55497
DIR=".tmp/pg-agent-webhook-limit"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
# The last commit whose route had the in-memory limiter only.
BASE=416ca763
MAIN_DIR=".tmp/agent-webhook-main"
if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is busy, refusing to start" >&2
  exit 1
fi
rm -rf "$MAIN_DIR" && mkdir -p "$MAIN_DIR"
git show "${BASE}:app/api/v1/agent/[token]/route.ts" \
  | sed 's|"@/lib/agent-turn-limit"|"./agent-turn-limit"|' >"$MAIN_DIR/route.ts"
git show "${BASE}:lib/agent-turn-limit.ts" >"$MAIN_DIR/agent-turn-limit.ts"
rm -rf "$DIR" && mkdir -p "$DIR"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log" "$MAIN_DIR"' EXIT
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 DATABASE_URL="$URL" node scripts/migrate.mjs
env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 AGENT_WEBHOOK_LIMIT_DB_URL="$URL" \
  npx tsx scripts/tests/agent-webhook-limit-db.test.ts
