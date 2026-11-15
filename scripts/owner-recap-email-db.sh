#!/usr/bin/env bash
# Runs scripts/tests/owner-recap-email-db.test.ts against a THROWAWAY
# Postgres (127.0.0.1:55451, data in the git-ignored .tmp/ folder), then stops
# it. Discovered by `npm run test:db` (scripts/run-db-suites.sh). Needs
# initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and runs with
# a clean env so no email or messaging provider credential is visible.
# The "before" route the test compares with is PINNED to the parent of #297's
# merge commit (92bff0e^1, the last main without the owner recap email), not
# origin/main: #297 is merged, so origin/main's route already carries the
# recap and the "reference is the route before this change" check can never
# hold against it. Override with OWNER_RECAP_EMAIL_MAIN_REF=<commit>.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=55451
DIR=".tmp/pg-owner-recap-email"
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
# Parent of "Merge pull request #297" (92bff0e^1).
MAIN_REF="${OWNER_RECAP_EMAIL_MAIN_REF:-2c4e2e96462fe539daabcb29968d5e838dbadad1}"
# /api/calls/end calls next-intl's getTranslations (since #299), which only
# runs inside Next: the shared test tsconfig maps "next-intl/server" to a
# stand-in (scripts/lib/next-intl-stub-tsconfig.sh).
source scripts/lib/next-intl-stub-tsconfig.sh
write_next_intl_stub_tsconfig
env -i PATH="$PATH" HOME="$HOME" TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" OWNER_RECAP_EMAIL_TEST_DB_URL="$URL" \
  OWNER_RECAP_EMAIL_MAIN_REF="$MAIN_REF" npx tsx scripts/tests/owner-recap-email-db.test.ts
