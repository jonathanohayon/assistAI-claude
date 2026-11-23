#!/usr/bin/env bash
# Runs scripts/tests/agent-state-db.test.ts against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it.
# Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and
# runs with a clean env so no LiveKit/Twilio/OpenAI/email credential is
# visible. Also snapshots origin/main's lib/dashboard-stats.ts into .tmp/ so
# the test can compare the hero's other fields byte for byte (override the ref
# with AGENT_STATE_MAIN_REF=<commit>).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  DIR=".tmp/pg-agent-state-${PORT}"
  MAIN_DIR=".tmp/agent-state-main-${PORT}"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  mkdir -p "$MAIN_DIR"
  git show "${AGENT_STATE_MAIN_REF:-origin/main}:lib/dashboard-stats.ts" > "$MAIN_DIR/dashboard-stats.ts"
  rm -rf "$DIR" && mkdir -p "$DIR"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log" "$MAIN_DIR"'
pg_start_throwaway agent-state
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" AGENT_STATE_DB_URL="$URL" AGENT_STATE_MAIN_STATS="$PWD/$MAIN_DIR/dashboard-stats.ts" \
  npx tsx scripts/tests/agent-state-db.test.ts
