#!/usr/bin/env bash
# `npm run test:db`: discovers every scripts/*-db.sh and runs them one after
# the other (never in parallel: each suite owns a fixed Postgres port). Each
# script checks its own port and starts/stops its own throwaway Postgres; this
# runner starts nothing itself. Stops on the first failure.
#   npm run test:db                    run all suites
#   npm run test:db -- --list          print the discovered suites
#   npm run test:db -- --only <name>   run one suite (<name> = file name without -db.sh)
set -uo pipefail
cd "$(dirname "$0")/.."

suites=()
for f in scripts/*-db.sh; do
  [ -f "$f" ] || continue
  n="${f#scripts/}"
  suites+=("${n%-db.sh}")
done

usage() { echo "usage: $0 [--list | --only <name>]" >&2; }

only=""
case "${1:-}" in
  "") ;;
  --list)
    printf '%s\n' "${suites[@]}"
    exit 0
    ;;
  --only)
    only="${2:-}"
    if [ -z "$only" ]; then usage; exit 1; fi
    found=0
    for s in "${suites[@]}"; do [ "$s" = "$only" ] && found=1; done
    if [ "$found" -ne 1 ]; then
      echo "unknown DB suite: $only" >&2
      echo "valid names:" >&2
      printf '  %s\n' "${suites[@]}" >&2
      exit 1
    fi
    ;;
  *) usage; exit 1 ;;
esac

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
echo "DB suites:"
printf '  %s\n' "${status[@]}"
exit "$failed"
