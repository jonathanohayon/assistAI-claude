# Sourced (not run) by the scripts/*-db.sh suites that prove ONE migration
# writes no data. `migrate_upto <tag> <database url> <work dir>` applies the
# migrations up to and including <tag> only, from a truncated copy of
# drizzle/ (SQL files + journal) in <work dir>, with scripts/migrate.mjs and
# a clean env. A later migration on main then never hides the one under
# test (drizzle skips a migration older than the last one applied).
# `migration_sorts_after_all_before <tag>` fails unless <tag>'s timestamp is
# greater than every earlier journal entry's (else prod would skip it).
#
# Usage, from the repo root (every -db.sh cd's there first):
#   source scripts/lib/migrate-upto.sh
#   migrate_upto 0051_contact_confirmations "$URL" "$DIR.work/m"

migrate_upto() {
  local tag="$1" url="$2" work="$3" root
  root="$PWD"
  rm -rf "$work" && mkdir -p "$work/drizzle/meta"
  TAG="$tag" OUT="$work/drizzle" node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
    const i = j.entries.findIndex((e) => e.tag === process.env.TAG);
    if (i < 0) { console.error("unknown migration " + process.env.TAG); process.exit(1); }
    const entries = j.entries.slice(0, i + 1);
    for (const e of entries) fs.copyFileSync(`drizzle/${e.tag}.sql`, `${process.env.OUT}/${e.tag}.sql`);
    fs.writeFileSync(`${process.env.OUT}/meta/_journal.json`, JSON.stringify({ ...j, entries }, null, 2));
  '
  (cd "$work" && env -i "${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" DATABASE_URL="$url" node "$root/scripts/migrate.mjs" >/dev/null)
}

migration_sorts_after_all_before() {
  TAG="$1" node -e '
    const j = require("./drizzle/meta/_journal.json");
    const i = j.entries.findIndex((e) => e.tag === process.env.TAG);
    if (i < 0) { console.error("unknown migration " + process.env.TAG); process.exit(1); }
    const bad = j.entries.slice(0, i).filter((e) => e.when >= j.entries[i].when);
    if (bad.length) { console.error(process.env.TAG + " sorts before " + bad.map((e) => e.tag).join(", ")); process.exit(1); }
  '
}
