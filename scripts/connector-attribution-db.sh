#!/usr/bin/env bash
# Connectors B3 (calls/end attributes a call to its connector from the signed
# route token session-config served) against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it:
# scripts/tests/connector-attribution-db.test.ts runs the REAL session-config
# handler and the REAL /api/calls/end handler (zero rows = attribution
# bypassed byte for byte; connector on B; OFF; CLIENT_AGENT off;
# clientAgentReached; invalid tokens + throw injections; deleted connector).
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  TMP=".tmp/connector-attribution-${PORT}"
  DIR="$TMP/pg"
  PGLOG="$TMP/pg.log"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  rm -rf "$TMP" && mkdir -p "$TMP"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
pg_start_throwaway connector-attribution
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
# /api/calls/end calls next-intl's getTranslations, which only runs inside
# Next: the shared test tsconfig maps "next-intl/server" to a stand-in.
source scripts/lib/next-intl-stub-tsconfig.sh
write_next_intl_stub_tsconfig
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" \
  CONNECTOR_ATTRIBUTION_DB_URL="$URL" npx tsx scripts/tests/connector-attribution-db.test.ts
