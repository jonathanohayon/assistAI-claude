# Sourced (not run) by every scripts/*-db.sh suite. Picks a FREE TCP port for
# the suite's throwaway Postgres and HOLDS it with an atomic lock, so suites
# started at the same time by different sessions on the same machine (several
# `npm run test:db` at once) never collide on a port.
#
# Usage, from the repo root (every -db.sh cd's there first), BEFORE anything
# that derives a path or URL from $PORT:
#   source scripts/lib/pg-free-port.sh
#   pick_free_port                        # sets and exports PORT, takes the lock
#   pg_layout() {                         # every $PORT-derived name, re-run on a retry
#     DIR=".tmp/pg-<suite>-${PORT}"       # per-run data dir (same worktree twice)
#     URL="postgres://postgres@127.0.0.1:${PORT}/postgres"
#     rm -rf "$DIR" && mkdir -p "$DIR"
#   }
#   pg_layout
#   pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR" "$DIR.log"'
#   pg_start_throwaway <suite>            # initdb + start, keeps the log + retries once
#   [ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
#
# pick_free_port installs the suite's EXIT trap itself: on exit it runs the
# cleanup registered with pg_on_exit FIRST (pg_ctl stop, rm -rf ...), then
# releases the port lock, then exits with the suite's status. A suite must
# never call `trap ... EXIT` itself (that would drop the lock release); the
# guard test scripts/tests/db-suites-free-port.test.ts enforces it.
#
# How a port is chosen: walk PG_FREE_PORT_MIN..PG_FREE_PORT_MAX starting at a
# random offset (spreads concurrent sessions). For each candidate:
#   1. skip it if it is on the skip list (ports other tools hold on purpose
#      and may only start listening AFTER our probe) or already has a
#      listener (lsof);
#   2. take the lock: `mkdir <root>/aitamara-pg-port-<p>.lock` (atomic) and
#      write our PID into it. If the dir exists and its PID is dead, the lock
#      is stale: reclaim it (under a second mkdir mutex, so two reclaimers
#      never remove each other's fresh lock) and retry the same port;
#   3. re-check the listener after the lock; if busy, release and move on.
#
# The lock root is /tmp (not $TMPDIR): $TMPDIR may differ between sessions or
# sandboxes, and the locks only work if every session sees the same ones.
# The range 55500-55799 deliberately avoids 55436-55497, the fixed ports the
# suites used before this helper (a checkout of an older main still uses them).
#
# Overrides (tests): PG_FREE_PORT_MIN, PG_FREE_PORT_MAX, PG_FREE_PORT_LOCK_ROOT,
# PG_FREE_PORT_SKIP (extra space-separated ports, added to the built-in list).

# The injected clock (DB_TEST_AT): one source of time for the suite's Node
# processes and its Postgres. See scripts/lib/test-clock.sh.
source "$(dirname "${BASH_SOURCE[0]}")/test-clock.sh"

PG_FREE_PORT_BUILTIN_SKIP="55477 56817 56931 3981"
PG_FREE_PORT_CLEANUP=""
PG_FREE_PORT_LOCK=""

_pg_free_port_root() { echo "${PG_FREE_PORT_LOCK_ROOT:-/tmp}"; }

_pg_free_port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

_pg_free_port_skipped() {
  local s
  for s in $PG_FREE_PORT_BUILTIN_SKIP ${PG_FREE_PORT_SKIP:-}; do
    [ "$s" = "$1" ] && return 0
  done
  return 1
}

_pg_free_port_alive() {
  [ -n "$1" ] || return 1
  kill -0 "$1" 2>/dev/null && return 0
  # kill -0 fails with EPERM for another user's live process: ask ps too.
  ps -p "$1" >/dev/null 2>&1
}

# A lock is stale when its owner PID is dead, or when it has no PID file and
# is over a minute old (its owner died between mkdir and writing the PID).
_pg_free_port_stale() {
  local lock="$1" pid
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    ! _pg_free_port_alive "$pid"
  else
    [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]
  fi
}

# Removes a stale lock under a mutex; returns 0 if it removed it.
_pg_free_port_reclaim() {
  local lock="$1" mutex="$1.reclaim" removed=1
  if ! mkdir "$mutex" 2>/dev/null; then
    # A reclaimer that died mid-way leaves its mutex: drop it once old.
    [ -n "$(find "$mutex" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rmdir "$mutex" 2>/dev/null
    return 1
  fi
  # Re-check under the mutex: another session may have reclaimed and re-taken it.
  if [ -d "$lock" ] && _pg_free_port_stale "$lock"; then
    rm -rf "$lock" && removed=0
  fi
  rmdir "$mutex" 2>/dev/null
  return "$removed"
}

pick_free_port() {
  local min="${PG_FREE_PORT_MIN:-55500}" max="${PG_FREE_PORT_MAX:-55799}"
  local root span offset i p lock owner="${PG_FREE_PORT_OWNER_PID:-$$}"
  root="$(_pg_free_port_root)"
  span=$((max - min + 1))
  offset=$((RANDOM % span))
  for ((i = 0; i < span; i++)); do
    p=$((min + (offset + i) % span))
    _pg_free_port_skipped "$p" && continue
    _pg_free_port_listening "$p" && continue
    lock="$root/aitamara-pg-port-$p.lock"
    if ! mkdir "$lock" 2>/dev/null; then
      _pg_free_port_stale "$lock" && _pg_free_port_reclaim "$lock" || continue
      mkdir "$lock" 2>/dev/null || continue
    fi
    echo "$owner" >"$lock/pid"
    if _pg_free_port_listening "$p"; then
      rm -rf "$lock"
      continue
    fi
    PG_FREE_PORT_LOCK="$lock"
    PORT="$p"
    export PORT
    echo "pick_free_port: 127.0.0.1:${PORT} (lock ${lock})" >&2
    trap _pg_free_port_exit EXIT
    # Turn a Ctrl-C / kill into a normal exit so the EXIT trap still cleans up.
    trap 'exit 130' INT
    trap 'exit 143' TERM
    return 0
  done
  echo "pick_free_port: no free port in ${min}-${max}" >&2
  return 1
}

# Registers the suite's cleanup (a string, eval'd at exit like a trap body).
pg_on_exit() { PG_FREE_PORT_CLEANUP="$1"; }

# Removes our lock (only if it is still ours).
release_free_port() {
  local lock="$PG_FREE_PORT_LOCK"
  [ -n "$lock" ] || return 0
  if [ "$(cat "$lock/pid" 2>/dev/null || true)" = "${PG_FREE_PORT_OWNER_PID:-$$}" ]; then
    rm -rf "$lock"
  fi
  PG_FREE_PORT_LOCK=""
}

_pg_free_port_exit() {
  local rc=$?
  # `|| true`: a failing cleanup step (pg_ctl stop on a dead server) must not
  # skip the lock release; set -e is off inside the eval'd list.
  if [ -n "$PG_FREE_PORT_CLEANUP" ]; then
    eval "$PG_FREE_PORT_CLEANUP" || true
  fi
  release_free_port
  exit "$rc"
}

# ── Starting the throwaway Postgres ──────────────────────────────────────
# pg_start_throwaway <suite>: initdb "$DIR" + pg_ctl start on 127.0.0.1:$PORT
# (-w, -t ${PG_START_TIMEOUT:-60}), server log at ${PGLOG:-$DIR.log}. Every
# suite starts its Postgres through it, never with its own `pg_ctl ... start`
# (the guard test enforces it). The suite must, BEFORE calling it:
#   - define pg_layout(): (re)derives every $PORT-derived name (DIR, PGLOG,
#     URL, TMP, ...) and recreates the empty dirs the start needs. The suite
#     calls it once after pick_free_port; the helper calls it again on a retry;
#   - register its cleanup with pg_on_exit (it is also the retry's teardown).
# So nothing but the Postgres layout may exist under the run's dirs at start.
#
# A failed initdb returns 1 at once (set -e: the suite stops; never retried).
# A failed START is kept and retried once:
#   1. the server log ($PGLOG, plus $DIR/log or $DIR/pg_log if any) is copied
#      to ${PG_START_KEEP_DIR:-.tmp}/pg-start-failed-<suite>-<port>-<time>.log,
#      outside every dir a cleanup removes, and its last 40 lines go to stderr;
#   2. anything half-started on $DIR is stopped (-m immediate), the suite's
#      cleanup runs (removes the run's dirs), the port lock is released;
#   3. pick_free_port takes a NEW port (the failed one is added to the skip
#      list), pg_layout re-derives the names, and
#      initdb + start run once more on a fresh DIR.
# If that retry fails too, its log is kept as well and the helper returns 1.
# Commands it runs can be prefixed with a clean env via the array
# PG_START_ENV, e.g. PG_START_ENV=(env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8).

_pg_start_keep_log() {
  local suite="$1" log="$2" keep_dir="${PG_START_KEEP_DIR:-.tmp}" kept f
  mkdir -p "$keep_dir"
  kept="$keep_dir/pg-start-failed-${suite}-${PORT}-$(date +%Y%m%dT%H%M%S)-$$.log"
  {
    echo "# pg_start_throwaway: start failed for suite ${suite} on 127.0.0.1:${PORT}, DIR=${DIR}"
    [ -f "$log" ] && { echo "# --- $log"; cat "$log"; }
    for f in "$DIR"/log/* "$DIR"/pg_log/*; do
      [ -f "$f" ] && { echo "# --- $f"; cat "$f"; }
    done
  } >"$kept" 2>/dev/null || true
  echo "pg_start_throwaway: Postgres did not start (suite ${suite}, port ${PORT}); log kept at ${kept}, last 40 lines:" >&2
  tail -n 40 "$kept" >&2 || true
}

pg_start_throwaway() {
  local suite="${1:?pg_start_throwaway: suite name required}" attempt log
  if ! declare -F pg_layout >/dev/null; then
    echo "pg_start_throwaway: the suite must define pg_layout() before starting" >&2
    return 1
  fi
  for attempt in 1 2; do
    log="${PGLOG:-$DIR.log}"
    ${PG_START_ENV[@]+"${PG_START_ENV[@]}"} initdb -D "$DIR" -A trust -U postgres >/dev/null || return 1
    if ${PG_START_ENV[@]+"${PG_START_ENV[@]}"} pg_ctl -D "$DIR" \
      -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$log" \
      -w -t "${PG_START_TIMEOUT:-60}" start >/dev/null; then
      [ "$attempt" = 1 ] || echo "pg_start_throwaway: retry on 127.0.0.1:${PORT} started (suite ${suite})" >&2
      # With DB_TEST_AT, the server's now() follows the suite's clock.
      pg_test_clock_install || return 1
      return 0
    fi
    _pg_start_keep_log "$suite" "$log"
    pg_ctl -D "$DIR" -m immediate stop >/dev/null 2>&1 || true
    if [ "$attempt" = 2 ]; then
      echo "pg_start_throwaway: retry failed too (suite ${suite}); giving up" >&2
      return 1
    fi
    if [ -n "$PG_FREE_PORT_CLEANUP" ]; then
      { eval "$PG_FREE_PORT_CLEANUP"; } >/dev/null 2>&1 || true
    fi
    release_free_port
    # Never the failed port again (it is free now, the random walk could pick it).
    PG_FREE_PORT_SKIP="${PG_FREE_PORT_SKIP:-} ${PORT}"
    pick_free_port || return 1
    pg_layout
    echo "pg_start_throwaway: retrying once on 127.0.0.1:${PORT} with a fresh DIR (${DIR})" >&2
  done
}
