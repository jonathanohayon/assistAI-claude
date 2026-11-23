#!/usr/bin/env bash
# Runs scripts/tests/trial-cleanup-db.test.ts against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it.
# Discovered by `npm run test:db` (scripts/run-db-suites.sh). Needs
# initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and runs with
# a clean env so no email or messaging provider credential is visible: the
# e-mail senders and the number release are injected mocks.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  DIR=".tmp/pg-trial-cleanup-${PORT}"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  rm -rf "$DIR" && mkdir -p "$DIR"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"'
pg_start_throwaway trial-cleanup
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
# The route imports lib/email.ts (next-intl's getTranslations): the shared
# test tsconfig maps "next-intl/server" to a stand-in.
source scripts/lib/next-intl-stub-tsconfig.sh
write_next_intl_stub_tsconfig
env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" TRIAL_CLEANUP_TEST_DB_URL="$URL" \
  npx tsx scripts/tests/trial-cleanup-db.test.ts
