#!/usr/bin/env bash
# The account's door (users.door, migration 0054) against a THROWAWAY Postgres
# (127.0.0.1:<free port>, data in the git-ignored .tmp/ folder), then stops it:
#   1. migration 0054 writes NO data: on the seeded database at 0053
#      (scripts/fixtures/mission-m2a-seed.sql + mock rows), the md5 of EVERY
#      public table's rows (over the columns that existed before) is
#      identical before and after; the only schema change is users.door plus
#      its CHECK; every row reads NULL; a re-run (and the raw SQL again) is a
#      no-op;
#   2. scripts/tests/account-door-db.test.ts: the CHECK, the email sign-up,
#      the Google callback (injected cookies), the PUT gate cases;
#   3. worker payloads: scripts/config-bytes-snapshot.ts on origin/main's tree
#      vs this branch, same seed, byte-identical; then again with a door set
#      on every account: still byte-identical (the door is never served).
# Never uses DATABASE_URL from your shell; clean env (no provider key).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/pg-free-port.sh
pick_free_port
TMP=".tmp/account-door-${PORT}"
DIR="$TMP/pg"
BASE="postgres://postgres@127.0.0.1:${PORT}"
URL="$BASE/postgres"
MAIN="$TMP/main-tree"
HOOKS="scripts/tests/fixtures/campaigns-plan-gate/hooks.mjs"
rm -rf "$TMP" && mkdir -p "$TMP/work"
initdb -D "$DIR" -A trust -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p ${PORT} -k '' -c listen_addresses=127.0.0.1" -l "$TMP/pg.log" -w start >/dev/null
pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"'
[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]
CLEAN=(env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8)
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$URL" "$@"; }

# ── 1. Migration 0054 writes no data ────────────────────────────────────
source scripts/lib/migrate-upto.sh
migration_sorts_after_all_before 0054_account_door
migrate_upto 0053_campaign_calls_analysis_claim "$URL" "$TMP/work/m53"
q -f scripts/fixtures/mission-m2a-seed.sql
q -c "INSERT INTO users (id, email, password_hash, role, developer_mode) VALUES ('00000000-0000-4000-8000-0000000000f1', 'mig@example.test', 'x', 'admin', true);
      INSERT INTO events (user_id, source, event, message) VALUES ('00000000-0000-0000-0000-00000000000a', 'web', 'config_updated', 'mock');
      INSERT INTO calls (user_id, duration_seconds) VALUES ('00000000-0000-0000-0000-00000000000a', 42);"
LEDGER_BEFORE="$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
schema() { q -c "SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1"; }
schema > "$TMP/work/schema-before"
TABLES="$(q -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")"
for t in $TABLES; do
  q -c "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$t'" > "$TMP/work/cols-$t"
done
snap() {
  for t in $TABLES; do
    q -c "SELECT '$t', count(*), md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM (SELECT $(cat "$TMP/work/cols-$t") FROM \"$t\") x"
  done
}
snap > "$TMP/work/md5-before"
grep -q '^users|4|' "$TMP/work/md5-before"
grep -q '^agent_configs|3|' "$TMP/work/md5-before"
XMIN="$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")"
migrate_upto 0054_account_door "$URL" "$TMP/work/m54"
snap > "$TMP/work/md5-after"
schema > "$TMP/work/schema-after"
if ! diff -u "$TMP/work/md5-before" "$TMP/work/md5-after"; then
  echo "migration 0054 changed table data" >&2
  exit 1
fi
SCHEMA_DIFF="$(diff "$TMP/work/schema-before" "$TMP/work/schema-after" | grep '^[<>]' || true)"
[ "$SCHEMA_DIFF" = "> users.door text YES " ] || { echo "unexpected schema diff: $SCHEMA_DIFF" >&2; exit 1; }
[ "$(q -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'users_door_check'")" = "CHECK ((door = ANY (ARRAY['reception'::text, 'sales'::text, 'connect'::text])))" ]
[ "$(q -c 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = "$((LEDGER_BEFORE + 1))" ]
[ "$(q -c 'SELECT count(*) FROM users WHERE door IS NOT NULL')" = "0" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")" = "$XMIN" ] || { echo "migration 0054 rewrote users rows" >&2; exit 1; }
# A re-run applies nothing; the raw SQL again is a no-op (idempotent constraint).
migrate_upto 0054_account_door "$URL" "$TMP/work/m54b"
q -f drizzle/0054_account_door.sql 2>/dev/null
[ "$(q -c "SELECT count(*) FROM pg_constraint WHERE conname = 'users_door_check'")" = "1" ]
[ "$(q -c "SELECT string_agg(xmin::text, ',' ORDER BY id) FROM users")" = "$XMIN" ]
echo "migration 0054: $(echo "$TABLES" | wc -w | tr -d ' ') tables, row md5 identical before/after; schema diff = users.door only (+ its CHECK); ledger +1; users xmin unchanged; re-run no-op"

# ── 2. The DB test (every migration from here on) ───────────────────────
"${CLEAN[@]}" DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null
"${CLEAN[@]}" ACCOUNT_DOOR_DB_TEST_URL="$URL" npx tsx --import "./$HOOKS" scripts/tests/account-door-db.test.ts

# ── 3. Worker payloads: origin/main vs this branch, byte for byte ───────
mkdir -p "$MAIN"
git archive origin/main | tar -x -C "$MAIN"
ln -s "$PWD/node_modules" "$MAIN/node_modules"
# ONE database (the seed has random agent_configs ids): origin/main's
# migrations + seed → main's snapshot; then this branch's migration on the
# same rows → the branch's snapshot; then a door on every account → again.
SNAP="$BASE/snap"
q -c "CREATE DATABASE snap"
(cd "$MAIN" && "${CLEAN[@]}" DATABASE_URL="$SNAP" node scripts/migrate.mjs >/dev/null)
psql -X -q -v ON_ERROR_STOP=1 "$SNAP" -f scripts/fixtures/mission-m2a-seed.sql
door_cols() { psql -At "$SNAP" -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'door'"; }
[ "$(door_cols)" = "0" ]
(cd "$MAIN" && "${CLEAN[@]}" SNAP_OUT="$PWD/../snap-main.json" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts)
"${CLEAN[@]}" DATABASE_URL="$SNAP" node scripts/migrate.mjs >/dev/null
[ "$(door_cols)" = "1" ]
"${CLEAN[@]}" SNAP_OUT="$PWD/$TMP/snap-branch.json" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts
psql -X -q -v ON_ERROR_STOP=1 "$SNAP" -c "UPDATE users SET door = CASE WHEN id::text LIKE '%a' THEN 'sales' ELSE 'connect' END"
[ "$(psql -At "$SNAP" -c "SELECT count(*) FROM users WHERE door IS NULL")" = "0" ]
"${CLEAN[@]}" SNAP_OUT="$PWD/$TMP/snap-branch-door.json" DATABASE_URL="$SNAP" INTERNAL_SECRET=mock npx tsx scripts/config-bytes-snapshot.ts
N="$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length)' "$TMP/snap-main.json")"
same() {
  cmp -s "$1" "$2" && return 0
  echo "payload snapshot differs: $1 vs $2" >&2
  node -e '
    const fs = require("fs");
    const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.error("  differs: " + k);
    }' "$1" "$2"
  return 1
}
same "$TMP/snap-main.json" "$TMP/snap-branch.json"
same "$TMP/snap-main.json" "$TMP/snap-branch-door.json"
echo "worker payloads: ${N} responses byte-identical main vs branch (md5 $(md5 -q "$TMP/snap-main.json" 2>/dev/null || md5sum "$TMP/snap-main.json" | cut -d' ' -f1)), and with a door on every account"
