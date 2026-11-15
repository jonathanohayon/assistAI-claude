#!/usr/bin/env bash
# Runs scripts/tests/contact-confirmation-db.test.ts (verified numbers N1)
# against a THROWAWAY Postgres (127.0.0.1:55489, data in the git-ignored
# .tmp/ folder), then stops it. Discovered by `npm run test:db`
# (scripts/run-db-suites.sh). Needs initdb/pg_ctl on PATH. Never uses
# DATABASE_URL from your shell, and runs with a clean env so no messaging,
# email or voice provider credential is visible. set -e: nothing runs after
# a failed initdb / pg_ctl.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55489
DIR=".tmp/pg-contact-confirmation"
URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port ${PORT} is busy, refusing to start" >&2
  exit 1
fi
rm -rf "$DIR" && mkdir -p "$DIR"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$DIR.log" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"' EXIT
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
# /api/calls/end calls next-intl's getTranslations: the shared test tsconfig
# maps "next-intl/server" to a stand-in (scripts/lib/next-intl-stub-tsconfig.sh).
source scripts/lib/next-intl-stub-tsconfig.sh
write_next_intl_stub_tsconfig
env -i PATH="$PATH" HOME="$HOME" TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" CONTACT_CONFIRMATION_TEST_DB_URL="$URL" \
  npx tsx scripts/tests/contact-confirmation-db.test.ts
