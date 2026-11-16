#!/usr/bin/env bash
# Runs scripts/tests/events-route-mask-db.test.ts against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it.
# Calls the real GET /api/dashboard/events handler as a tenant, as an admin
# with ?asUserId and as an admin on their own events. "@/auth" is mapped to a
# test session stub (scripts/tests/helpers/auth-session-stub.ts) by a test
# tsconfig in .tmp/. Never uses DATABASE_URL from your shell; clean env.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
DIR=".tmp/pg-events-route-mask-${PORT}"
TSCONFIG="$PWD/.tmp/tsconfig.events-route-mask-${PORT}.json"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
rm -rf "$DIR" && mkdir -p "$DIR"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log" "$TSCONFIG"'
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
cat > "$TSCONFIG" <<'JSON'
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "paths": { "@/auth": ["../scripts/tests/helpers/auth-session-stub.ts"], "@/*": ["../*"] }
  }
}
JSON
env -i PATH="$PATH" HOME="$HOME" TSX_TSCONFIG_PATH="$TSCONFIG" EVENTS_MASK_DB_URL="$URL" \
  npx tsx scripts/tests/events-route-mask-db.test.ts
