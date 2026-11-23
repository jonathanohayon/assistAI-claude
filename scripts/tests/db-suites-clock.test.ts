// Guard for the DB suites' injected clock (scripts/lib/test-clock.sh +
// scripts/lib/test-clock.mjs): `npm run test:db -- --at <ISO>` must run every
// suite at that wall time, for its Node processes AND its Postgres.
// 1. Every suite (and the helpers they source) carries the clock through
//    every `env -i` (`env -i "${DB_CLOCK_ENV[@]}" ...`), never sets the clock
//    variables itself, and starts Postgres through pg_start_throwaway, which
//    installs the clock (checked statically here and in pg-free-port.sh).
// 2. No app or test code uses a SQL clock the Postgres shim cannot reach
//    (CURRENT_TIMESTAMP, CURRENT_DATE, LOCALTIMESTAMP, 'now' literals).
// 3. The Node hook: shifted Date.now / new Date() / Date(), untouched
//    new Date(x) / Date.UTC / instanceof; a no-op without an offset.
// 4. test-clock.sh: the offset is computed from DB_TEST_AT, an invalid value
//    stops the suite, unset = real time; the runner rejects a bad --at.
// 5. With a real Postgres on PATH: pg_start_throwaway under DB_TEST_AT gives
//    now(), clock_timestamp(), a DEFAULT now() column and a database created
//    afterwards the pinned time, unqualified CREATEs still land in public,
//    and a Node process started with `env -i "${DB_CLOCK_ENV[@]}"` agrees.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverDbSuites } from "../lib/test-discovery.mjs";

const ROOT = path.resolve(__dirname, "..", "..");
const HOOK = path.join(ROOT, "scripts/lib/test-clock.mjs");
const CLOCK_SH = path.join(ROOT, "scripts/lib/test-clock.sh");
const HELPER = path.join(ROOT, "scripts/lib/pg-free-port.sh");
const codeOf = (file: string) =>
  readFileSync(path.join(ROOT, file), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

// ── 1. Every suite carries the clock ───────────────────────────────────
const suites = discoverDbSuites(ROOT);
assert.ok(suites.length > 0, "no scripts/*-db.sh found");
const shellFiles = [...suites.map((s) => s.file), "scripts/lib/migrate-upto.sh", "scripts/run-db-suites.sh"];
let envI = 0;
for (const file of shellFiles) {
  const code = codeOf(file);
  for (const m of code.matchAll(/\benv -i\b(.{0,40})/g)) {
    envI++;
    assert.ok(m[1].startsWith(' "${DB_CLOCK_ENV[@]}" '), `${file}: \`env -i${m[1]}\` drops the injected clock: write env -i "\${DB_CLOCK_ENV[@]}" ...`);
  }
  assert.doesNotMatch(code, /\bDB_TEST_CLOCK_OFFSET_MS=/, `${file} sets the clock offset itself (only test-clock.sh does)`);
  assert.doesNotMatch(code, /\bNODE_OPTIONS=/, `${file} sets NODE_OPTIONS (it would drop the clock hook)`);
  assert.doesNotMatch(code, /faketime|DYLD_INSERT_LIBRARIES/i, `${file}: one clock mechanism only (test-clock.sh)`);
}
for (const { file } of suites) assert.match(codeOf(file), /^source scripts\/lib\/pg-free-port\.sh$/m, `${file} must source the helper (it brings the clock)`);
const helper = codeOf("scripts/lib/pg-free-port.sh");
assert.match(helper, /^source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/test-clock\.sh"$/m, "pg-free-port.sh must source test-clock.sh");
assert.match(helper, /pg_test_clock_install \|\| return 1/, "pg_start_throwaway must install the clock after a start");
console.log(`ok: ${suites.length} DB suites get the clock from the helper; ${envI} \`env -i\` carry DB_CLOCK_ENV`);

// ── 2. No SQL clock outside the shim's reach ───────────────────────────
const UNSHIMMABLE = /\b(current_timestamp|current_date|current_time|localtimestamp|localtime)\b|'now'\s*::|\b(timestamptz|timestamp|date)\s+'now'/i;
const SELF = new Set(["scripts/lib/test-clock.sh", "scripts/tests/db-suites-clock.test.ts"]);
const scanned: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel);
    } else if (/\.(ts|tsx|mjs|js|sql|sh)$/.test(e.name) && !SELF.has(rel)) {
      scanned.push(rel);
    }
  }
};
for (const d of ["app", "lib", "scripts", "drizzle"]) if (statSync(path.join(ROOT, d), { throwIfNoEntry: false })?.isDirectory()) walk(d);
for (const f of scanned) {
  const m = readFileSync(path.join(ROOT, f), "utf8").match(UNSHIMMABLE);
  assert.equal(m, null, `${f} uses \`${m?.[0]}\`: the injected DB clock cannot shift it; use now() / clock_timestamp()`);
}
console.log(`ok: ${scanned.length} files, no CURRENT_TIMESTAMP / CURRENT_DATE / LOCALTIMESTAMP / 'now' literal`);

// ── 3. The Node hook ───────────────────────────────────────────────────
const probe = `const a = Date.now(); console.log(JSON.stringify({
  now: a, newDate: new Date().getTime(), str: Date(), fixed: new Date(0).getTime(), parsed: new Date("2020-01-01T00:00:00Z").getTime(),
  utc: Date.UTC(2020, 0, 1), inst: new Date() instanceof Date, real: a }))`;
const node = (env: Record<string, string>) => {
  const r = spawnSync("node", ["-e", probe], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as Record<string, unknown> & { now: number; newDate: number; str: string };
};
{
  const DAY = 86_400_000;
  const before = Date.now();
  const shifted = node({ DB_TEST_CLOCK_OFFSET_MS: String(3 * DAY), NODE_OPTIONS: `--import=${HOOK}` });
  const after = Date.now();
  assert.ok(shifted.now >= before + 3 * DAY && shifted.now <= after + 3 * DAY, "Date.now() shifted by the offset");
  assert.ok(Math.abs(shifted.newDate - shifted.now) < 1000, "new Date() shifted like Date.now()");
  assert.ok(Math.abs(Date.parse(shifted.str) - shifted.now) < 2000, "Date() as a function is shifted too");
  assert.deepEqual([shifted.fixed, shifted.parsed, shifted.utc, shifted.inst], [0, 1577836800000, 1577836800000, true], "explicit dates untouched");
  const off = node({ DB_TEST_CLOCK_OFFSET_MS: "", NODE_OPTIONS: `--import=${HOOK}` });
  assert.ok(Math.abs(off.now - Date.now()) < 5000, "empty offset: real time");
  const bad = spawnSync("node", ["-e", "1"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", DB_TEST_CLOCK_OFFSET_MS: "soon", NODE_OPTIONS: `--import=${HOOK}` } as unknown as NodeJS.ProcessEnv });
  assert.notEqual(bad.status, 0, "a non-numeric offset fails loudly");
}
console.log("ok: Node hook shifts Date.now / new Date() / Date(), leaves explicit dates alone, no-op without an offset");

// ── 4. test-clock.sh and the runner ────────────────────────────────────
const bash = (body: string, env: Record<string, string> = {}) =>
  spawnSync("bash", ["-c", `set -euo pipefail\nsource "${CLOCK_SH}"\n${body}`], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv,
  });
{
  const AT = "2026-11-28T03:00:00+02:00";
  const t0 = Date.now();
  const r = bash('echo "$DB_TEST_CLOCK_OFFSET_MS|$NODE_OPTIONS|${DB_CLOCK_ENV[*]}"', { DB_TEST_AT: AT });
  assert.equal(r.status, 0, r.stderr);
  const [offset, nodeOptions, carried] = r.stdout.trim().split("|");
  assert.ok(Math.abs(Number(offset) - (Date.parse(AT) - t0)) < 5000, `offset ${offset} = DB_TEST_AT - now`);
  assert.equal(nodeOptions, `--import=${HOOK}`);
  assert.equal(carried, `DB_TEST_CLOCK_OFFSET_MS=${offset} NODE_OPTIONS=--import=${HOOK}`);
  const twice = bash('source "$CLOCK_SH"; echo "$NODE_OPTIONS"', { DB_TEST_AT: AT, CLOCK_SH, NODE_OPTIONS: "--max-old-space-size=512" });
  assert.equal(twice.stdout.trim(), `--max-old-space-size=512 --import=${HOOK}`, "existing NODE_OPTIONS kept, hook added once");
  for (const badAt of ["2026-11-28T03:00:00", "tomorrow"]) {
    const b = bash("echo unreachable", { DB_TEST_AT: badAt });
    assert.notEqual(b.status, 0, `DB_TEST_AT=${badAt} must stop the suite`);
    assert.doesNotMatch(b.stdout, /unreachable/);
  }
  const real = bash('echo "[$DB_TEST_CLOCK_OFFSET_MS|${NODE_OPTIONS:-}|${DB_CLOCK_ENV[*]}]"; pg_test_clock_install && echo noop');
  assert.equal(real.stdout.trim(), "[||DB_TEST_CLOCK_OFFSET_MS=]\nnoop", "unset = real time, no hook, install is a no-op");
  const runner = spawnSync("bash", [path.join(ROOT, "scripts/run-db-suites.sh"), "--at", "2026-11-28T03:00:00"], { encoding: "utf8" });
  assert.notEqual(runner.status, 0, "the runner rejects an --at without an offset");
}
console.log("ok: test-clock.sh computes the offset once, rejects a bad DB_TEST_AT, real time when unset; runner rejects a bad --at");

// ── 5. A real throwaway Postgres under the clock ───────────────────────
const has = (b: string) => spawnSync("bash", ["-c", `command -v ${b}`]).status === 0;
if (has("initdb") && has("pg_ctl") && has("psql")) {
  const work = mkdtempSync(path.join(os.tmpdir(), "db-clock-test-"));
  try {
    const AT = "2026-11-25T11:00:00+02:00";
    const body = [
      "set -euo pipefail",
      `source "${HELPER}"`,
      "pick_free_port",
      'pg_layout() { DIR="$WORK/pg-${PORT}"; URL="postgres://postgres@127.0.0.1:${PORT}/postgres"; rm -rf "$DIR" && mkdir -p "$DIR"; }',
      "pg_layout",
      `pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$DIR" "$DIR.log"'`,
      "pg_start_throwaway clock-guard",
      `[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]`,
      'q() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }',
      `q "$URL" -c "CREATE TABLE t (id int, at timestamptz NOT NULL DEFAULT now()); INSERT INTO t (id) VALUES (1)"`,
      `echo "now=$(q "$URL" -c "SELECT extract(epoch FROM now()) * 1000")"`,
      `echo "clock=$(q "$URL" -c "SELECT extract(epoch FROM clock_timestamp()) * 1000")"`,
      `echo "default=$(q "$URL" -c "SELECT extract(epoch FROM at) * 1000 FROM t")"`,
      `echo "schema=$(q "$URL" -c "SELECT table_schema FROM information_schema.tables WHERE table_name = 't'")"`,
      `echo "coldefault=$(q "$URL" -c "SELECT column_default FROM information_schema.columns WHERE table_name = 't' AND column_name = 'at'")"`,
      `q "$URL" -c "CREATE DATABASE later"`,
      `echo "later=$(q "\${URL%/postgres}/later" -c "SELECT extract(epoch FROM now()) * 1000")"`,
      `echo "node=$(env -i "\${DB_CLOCK_ENV[@]}" PATH="$PATH" HOME="$HOME" node -e 'console.log(Date.now())')"`,
    ].join("\n");
    const t0 = Date.now();
    const r = spawnSync("bash", ["-c", body], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "en_US.UTF-8", WORK: work, DB_TEST_AT: AT, PG_START_KEEP_DIR: work } as unknown as NodeJS.ProcessEnv,
    });
    assert.equal(r.status, 0, r.stderr);
    const out = Object.fromEntries(r.stdout.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    // The clock starts at AT when the suite starts and advances in real time.
    const span = Date.now() - t0 + 2000;
    for (const k of ["now", "clock", "default", "later", "node"]) {
      const v = Number(out[k]) - Date.parse(AT);
      assert.ok(v > -2000 && v < span, `${k}: ${out[k]} is not ~${AT} (delta ${v} ms)`);
    }
    assert.equal(out.schema, "public", "unqualified CREATE lands in public");
    assert.equal(out.coldefault, "now()", "column default reads now()");
    assert.deepEqual(readdirSync(work).filter((f) => f.startsWith("pg-")), [], "throwaway DIR removed");
    console.log(`ok: real Postgres under DB_TEST_AT=${AT}: now(), clock_timestamp(), DEFAULT now(), a later database and an env -i Node process agree`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
} else {
  console.log("skip: no initdb/pg_ctl/psql on PATH, real-Postgres clock case not run");
}
