#!/usr/bin/env bash
# Runs scripts/tests/client-confirm-db.test.ts against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it.
# Needs initdb/pg_ctl on PATH. Never uses DATABASE_URL from your shell, and runs
# with a clean env so no Twilio/OpenAI credential is visible. Also snapshots
# the "before" /api/calls/end route into .tmp/ so the test can compare the
# owner recap payload of before and of this branch for the same input.
# The "before" route is PINNED to the parent of #306's merge commit (the last
# main that still sent the LLM recap for a call that proved nothing), not
# origin/main: #306 fixed that flaw on main, so the "before still has the
# flaw" check can never hold against origin/main. Override with
# CLIENT_CONFIRM_MAIN_REF=<commit>.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
pg_layout() {
  DIR=".tmp/pg-client-confirm-${PORT}"
  MAIN_ROUTE=".tmp/client-confirm-main-${PORT}/route.ts"
  PREV_END=".tmp/client-confirm-main-${PORT}/prev-end-route.ts"
  PREV_CANCEL=".tmp/client-confirm-main-${PORT}/prev-cancel-route.ts"
  URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
  mkdir -p "$(dirname "$MAIN_ROUTE")"
  rm -rf "$DIR" && mkdir -p "$DIR"
}
pg_layout
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log" "$(dirname "$MAIN_ROUTE")"'
pg_start_throwaway client-confirm
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
# Parent of "Merge pull request #306" (07ffeca^1).
BEFORE_REF="${CLIENT_CONFIRM_MAIN_REF:-e1968760af7bc00e179269a227954fbaa9a05212}"
git show "${BEFORE_REF}:app/api/calls/end/route.ts" > "$MAIN_ROUTE"
# The cancel route and /api/calls/end as on main just BEFORE the follow-ups
# (cancel date + confirm before the summary), PINNED like the ref above: the
# cancel response to the worker and the calls/end response must be
# byte-identical to these. Re-pinned to e782b81 after #328 (it deleted
# lib/demo-sandbox, which the a1dfec0 cancel route imported). Override with
# CLIENT_CONFIRM_PREV_REF=<commit>.
PREV_REF="${CLIENT_CONFIRM_PREV_REF:-e782b813e666221329fd539e41764694743986da}"
git show "${PREV_REF}:app/api/calls/end/route.ts" > "$PREV_END"
git show "${PREV_REF}:app/api/calendar/cancel/route.ts" > "$PREV_CANCEL"
env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$URL" node scripts/migrate.mjs
# The route's owner recap wrapper calls next-intl's getTranslations, which
# only runs inside Next: the shared test tsconfig maps "next-intl/server" to a
# stand-in (scripts/lib/next-intl-stub-tsconfig.sh).
source scripts/lib/next-intl-stub-tsconfig.sh
write_next_intl_stub_tsconfig
env -i PATH="$PATH" HOME="$HOME" TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" CLIENT_CONFIRM_DB_URL="$URL" CLIENT_CONFIRM_MAIN_ROUTE="$PWD/$MAIN_ROUTE" \
  CLIENT_CONFIRM_PREV_END_ROUTE="$PWD/$PREV_END" CLIENT_CONFIRM_PREV_CANCEL_ROUTE="$PWD/$PREV_CANCEL" \
  npx tsx scripts/tests/client-confirm-db.test.ts
