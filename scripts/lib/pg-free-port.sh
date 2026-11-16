# Sourced (not run) by every scripts/*-db.sh suite. Picks a FREE TCP port for
# the suite's throwaway Postgres and HOLDS it with an atomic lock, so suites
# started at the same time by different sessions on the same machine (several
# `npm run test:db` at once) never collide on a port.
#
# Usage, from the repo root (every -db.sh cd's there first), BEFORE anything
# that derives a path or URL from $PORT:
#   source scripts/lib/pg-free-port.sh
#   pick_free_port                        # sets and exports PORT, takes the lock
#   DIR=".tmp/pg-<suite>-${PORT}"         # per-run data dir (same worktree twice)
#   ...initdb / pg_ctl start...
#   pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null; rm -rf "$DIR"'
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
