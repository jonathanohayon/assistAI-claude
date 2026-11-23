#!/usr/bin/env bash
# `npm run test:db`: discovers every scripts/*-db.sh and runs them one after
# the other. Each script picks and locks a free port for its own throwaway
# Postgres (scripts/lib/pg-free-port.sh), so several runs at once, from other
# sessions or the same checkout, never collide; this runner starts nothing
# itself. Stops on the first failure.
#   npm run test:db                    run all suites
#   npm run test:db -- --list          print the discovered suites
#   npm run test:db -- --only <name>   run one suite (<name> = file name without -db.sh)
#   npm run test:db -- --at <ISO>      run at a FIXED wall time: every suite's
#                                      clock (JS Date and its Postgres's now())
#                                      starts at <ISO> (with an offset or Z,
#                                      e.g. 2026-11-28T03:00:00+02:00) and
#                                      advances from there; combinable with
#                                      --only. Default: real time.
#                                      Mechanism: scripts/lib/test-clock.sh.
set -uo pipefail
cd "$(dirname "$0")/.."

suites=()
for f in scripts/*-db.sh; do
  [ -f "$f" ] || continue
  n="${f#scripts/}"
  suites+=("${n%-db.sh}")
done

usage() { echo "usage: $0 [--list | --only <name>] [--at <ISO instant>]" >&2; }

only=""
at=""
list=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --list) list=1; shift ;;
    --only)
      only="${2:-}"
      if [ -z "$only" ]; then usage; exit 1; fi
      shift 2
      ;;
    --at)
      at="${2:-}"
      if [ -z "$at" ]; then usage; exit 1; fi
      shift 2
      ;;
    *) usage; exit 1 ;;
  esac
done
if [ "$list" -eq 1 ]; then
  printf '%s\n' "${suites[@]}"
  exit 0
fi
if [ -n "$only" ]; then
  found=0
  for s in "${suites[@]}"; do [ "$s" = "$only" ] && found=1; done
  if [ "$found" -ne 1 ]; then
    echo "unknown DB suite: $only" >&2
    echo "valid names:" >&2
    printf '  %s\n' "${suites[@]}" >&2
    exit 1
  fi
fi
if [ -n "$at" ]; then
  # Validated here once (each suite re-reads it in scripts/lib/test-clock.sh).
  if ! node -e 'const s = process.argv[1]; process.exit(/(Z|[+-]\d\d:?\d\d)$/.test(s) && Number.isFinite(Date.parse(s)) ? 0 : 1)' "$at"; then
    echo "--at needs an ISO instant with an offset or Z, e.g. 2026-11-25T11:00:00+02:00: $at" >&2
    exit 1
  fi
  export DB_TEST_AT="$at"
  echo "DB suites at a fixed wall time: each suite's clock starts at $at"
else
  # Real time: never inherit a stray DB_TEST_AT from the shell.
  unset DB_TEST_AT
fi

declare -a status
failed=0
for s in "${suites[@]}"; do
  if [ -n "$only" ] && [ "$s" != "$only" ]; then
    status+=("skipped  $s")
    continue
  fi
  if [ "$failed" -ne 0 ]; then
    status+=("skipped  $s")
    continue
  fi
  echo "› scripts/${s}-db.sh"
  if bash "scripts/${s}-db.sh"; then
    status+=("passed   $s")
  else
    status+=("FAILED   $s")
    failed=1
  fi
done

echo
echo "DB suites${at:+ (clock at $at)}:"
printf '  %s\n' "${status[@]}"
exit "$failed"
