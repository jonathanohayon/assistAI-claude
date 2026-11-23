# The DB suites' injected clock: ONE source of time for a whole suite, for
# both its Node processes (JS Date) and its throwaway Postgres (SQL now()).
# Sourced by scripts/lib/pg-free-port.sh, so every scripts/*-db.sh gets it.
#
# Input: DB_TEST_AT, an ISO 8601 instant with an offset or Z, e.g.
#   DB_TEST_AT=2026-11-25T11:00:00+02:00     (Wed 11:00 Asia/Jerusalem)
# set by `npm run test:db -- --at <ISO>` (scripts/run-db-suites.sh). Unset or
# empty = real time, nothing is changed.
#
# When set, at source time (= the start of the suite) it computes ONCE
#   DB_TEST_CLOCK_OFFSET_MS = DB_TEST_AT - real now
# and exports it, so the suite starts at DB_TEST_AT and its clock then
# advances in real time (an offset, not a frozen value). Then:
#   - Node: NODE_OPTIONS gets --import=scripts/lib/test-clock.mjs, which
#     shifts Date.now() / new Date() by the offset. Exported for the
#     processes the suite starts directly, AND carried by DB_CLOCK_ENV for
#     the ones it starts with `env -i` (which drops the environment): every
#     `env -i` in a suite must be `env -i "${DB_CLOCK_ENV[@]}" ...` (the guard
#     test scripts/tests/db-suites-clock.test.ts enforces it);
#   - Postgres: pg_start_throwaway calls pg_test_clock_install right after
#     the server starts. In template1 (every later CREATE DATABASE copies it)
#     and in postgres it creates schema test_clock with now(),
#     clock_timestamp(), statement_timestamp() and transaction_timestamp()
#     returning the pg_catalog value + the offset, and sets the server's
#     search_path to "$user", public, test_clock, pg_catalog. pg_catalog
#     is listed LAST explicitly, so an unqualified now() (SQL, column
#     defaults, drizzle's defaultNow()) resolves to test_clock.now(), while
#     unqualified CREATEs still land in public. The SQL keywords
#     CURRENT_TIMESTAMP / CURRENT_DATE / LOCALTIMESTAMP / 'now'::timestamptz
#     cannot be shimmed this way: the guard test forbids them in app and
#     test code.
# Why not libfaketime: it is not installed (and nothing is installed on this
# machine for tests), and on macOS the DYLD_* variables it needs are dropped
# by every SIP-protected binary on the way (/bin/bash, /usr/bin/env, the
# /bin/sh that pg_ctl starts postgres with).

DB_TEST_CLOCK_HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/test-clock.mjs"
DB_TEST_CLOCK_OFFSET_MS=""
if [ -n "${DB_TEST_AT:-}" ]; then
  DB_TEST_CLOCK_OFFSET_MS="$(node -e '
    const at = Date.parse(process.argv[1]);
    if (!/(Z|[+-]\d\d:?\d\d)$/.test(process.argv[1]) || !Number.isFinite(at)) process.exit(1);
    console.log(String(at - Date.now()));
  ' "$DB_TEST_AT")" || {
    echo "test-clock: DB_TEST_AT is not an ISO instant with an offset or Z: ${DB_TEST_AT}" >&2
    exit 1
  }
  case " ${NODE_OPTIONS:-} " in
    *" --import=${DB_TEST_CLOCK_HOOK} "*) ;;
    *) NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--import=${DB_TEST_CLOCK_HOOK}" ;;
  esac
  export NODE_OPTIONS DB_TEST_CLOCK_OFFSET_MS
  echo "test-clock: suite clock starts at ${DB_TEST_AT} (offset ${DB_TEST_CLOCK_OFFSET_MS} ms)" >&2
  DB_CLOCK_ENV=(DB_TEST_CLOCK_OFFSET_MS="$DB_TEST_CLOCK_OFFSET_MS" NODE_OPTIONS="$NODE_OPTIONS")
else
  # Never empty (bash 3.2 + set -u rejects "${a[@]}" on an empty array);
  # an empty offset is the hook's "real time".
  DB_CLOCK_ENV=(DB_TEST_CLOCK_OFFSET_MS=)
fi

# pg_test_clock_install: shims the clock into the throwaway Postgres on
# 127.0.0.1:$PORT (no-op without DB_TEST_AT). Called by pg_start_throwaway.
pg_test_clock_install() {
  [ -n "$DB_TEST_CLOCK_OFFSET_MS" ] || return 0
  local d off="$DB_TEST_CLOCK_OFFSET_MS"
  for d in template1 postgres; do
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d "$d" >/dev/null <<SQL || return 1
CREATE SCHEMA IF NOT EXISTS test_clock;
CREATE OR REPLACE FUNCTION test_clock.now() RETURNS timestamptz LANGUAGE sql STABLE PARALLEL SAFE
  AS \$\$ SELECT pg_catalog.now() + interval '${off} milliseconds' \$\$;
CREATE OR REPLACE FUNCTION test_clock.transaction_timestamp() RETURNS timestamptz LANGUAGE sql STABLE PARALLEL SAFE
  AS \$\$ SELECT pg_catalog.transaction_timestamp() + interval '${off} milliseconds' \$\$;
CREATE OR REPLACE FUNCTION test_clock.statement_timestamp() RETURNS timestamptz LANGUAGE sql STABLE PARALLEL SAFE
  AS \$\$ SELECT pg_catalog.statement_timestamp() + interval '${off} milliseconds' \$\$;
CREATE OR REPLACE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE PARALLEL SAFE
  AS \$\$ SELECT pg_catalog.clock_timestamp() + interval '${off} milliseconds' \$\$;
GRANT USAGE ON SCHEMA test_clock TO PUBLIC;
SQL
  done
  psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d postgres >/dev/null <<'SQL' || return 1
ALTER SYSTEM SET search_path = "$user", public, test_clock, pg_catalog;
SELECT pg_reload_conf();
SQL
  # pg_reload_conf is asynchronous: wait until a new session sees it.
  local i
  for i in $(seq 1 50); do
    [ "$(psql -X -At -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c 'SHOW search_path')" = '"$user", public, test_clock, pg_catalog' ] && return 0
    sleep 0.1
  done
  echo "test-clock: the search_path reload never reached new sessions" >&2
  return 1
}
