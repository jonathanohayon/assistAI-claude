// Guard for scripts/lib/pg-free-port.sh, the helper every scripts/*-db.sh
// sources to pick and lock a free Postgres port (no Postgres is started here).
// 1. Every suite sources the helper, has no fixed PORT, never sets its own
//    EXIT trap (it would drop the lock release) and keeps the
//    `select inet_server_port()` check against $PORT.
// 2. The helper itself, in separate bash processes, with a private lock root
//    (never the real /tmp locks) and narrow port ranges: concurrent picks get
//    different ports, a stale lock (dead PID) is reclaimed and a live one is
//    not, a port with a listener and skip-list ports are never returned, and
//    the lock is removed on exit, after the suite's cleanup, even when that
//    cleanup fails.
// 3. Every suite starts Postgres through pg_start_throwaway (no raw initdb /
//    `pg_ctl ... start`), defines pg_layout and registers its cleanup first.
// 4. pg_start_throwaway itself, with stub initdb/pg_ctl on PATH (and, when a
//    real pg_ctl is installed, a stub that fails once then delegates to it):
//    a failed start keeps its server log outside the cleaned dirs, prints its
//    tail and retries once on a NEW port with a fresh DIR; a double failure
//    exits non-zero with two logs; a failed initdb is never retried.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { discoverDbSuites } from "../lib/test-discovery.mjs";

const ROOT = path.resolve(__dirname, "..", "..");
const HELPER = path.join(ROOT, "scripts/lib/pg-free-port.sh");

// ── 1. Every suite uses the helper ──────────────────────────────────────
const suites = discoverDbSuites(ROOT);
assert.ok(suites.length > 0, "no scripts/*-db.sh found");
for (const { file } of suites) {
  const src = readFileSync(path.join(ROOT, file), "utf8");
  const code = src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
  assert.match(code, /^source scripts\/lib\/pg-free-port\.sh$/m, `${file} must source scripts/lib/pg-free-port.sh`);
  assert.match(code, /^pick_free_port$/m, `${file} must call pick_free_port`);
  assert.doesNotMatch(code, /^\s*PORT=\d+/m, `${file} hardcodes a PORT`);
  assert.doesNotMatch(code, /\b5[0-9]{4}\b/, `${file} has a literal 5xxxx port`);
  assert.doesNotMatch(code, /\btrap\b[^\n]*\bEXIT\b/, `${file} sets its own EXIT trap: use pg_on_exit`);
  assert.match(code, /^\s*pg_on_exit '/m, `${file} must register its cleanup with pg_on_exit`);
  assert.ok(
    code.includes(`[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ]`),
    `${file} lost the inet_server_port check`,
  );
  assert.doesNotMatch(code, /\bpg_ctl\b[^\n]*\bstart\b/, `${file} starts Postgres itself: use pg_start_throwaway`);
  assert.doesNotMatch(code, /\binitdb\b/, `${file} runs initdb itself: use pg_start_throwaway`);
  const name = file.replace(/^scripts\//, "").replace(/-db\.sh$/, "");
  assert.match(code, new RegExp(`^\\s*pg_start_throwaway ${name}$`, "m"), `${file} must call pg_start_throwaway ${name}`);
  assert.match(code, /^pg_layout\(\) \{$/m, `${file} must define pg_layout() (re-run on a retry)`);
  assert.match(code, /^pg_layout$/m, `${file} must call pg_layout after pick_free_port`);
  assert.ok(
    code.search(/^\s*pg_on_exit '/m) < code.search(/^\s*pg_start_throwaway /m),
    `${file} must register pg_on_exit before pg_start_throwaway (it is the retry's teardown)`,
  );
  const pick = code.indexOf("\npick_free_port\n");
  const firstUse = code.search(/\$\{?PORT\b/);
  assert.ok(firstUse === -1 || firstUse > pick, `${file} uses $PORT before pick_free_port`);
}
console.log(`ok: ${suites.length} DB suites source the helper, start via pg_start_throwaway, no fixed port, inet_server_port kept`);

// ── 2. The helper ───────────────────────────────────────────────────────
const lockRoot = mkdtempSync(path.join(os.tmpdir(), "pg-free-port-test-"));
const lockDir = (p: number) => path.join(lockRoot, `aitamara-pg-port-${p}.lock`);

interface Env {
  min: number;
  max: number;
  skip?: string;
}
const envFor = (e: Env): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  NODE_ENV: "test",
  PG_FREE_PORT_LOCK_ROOT: lockRoot,
  PG_FREE_PORT_MIN: String(e.min),
  PG_FREE_PORT_MAX: String(e.max),
  PG_FREE_PORT_SKIP: e.skip ?? "",
});
// `body` runs after pick_free_port, in a `set -euo pipefail` bash like a suite.
const script = (body: string) => `set -euo pipefail\nsource "${HELPER}"\npick_free_port\necho "PORT=$PORT"\n${body}\n`;

function run(e: Env, body = "") {
  const r = spawnSync("bash", ["-c", script(body)], { env: envFor(e), encoding: "utf8" });
  const m = /PORT=(\d+)/.exec(r.stdout);
  return { status: r.status, port: m ? Number(m[1]) : null, stdout: r.stdout, stderr: r.stderr };
}

function runAsync(e: Env, body: string): Promise<{ status: number | null; port: number | null }> {
  return new Promise((resolve) => {
    const c = spawn("bash", ["-c", script(body)], { env: envFor(e) });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("close", (status) => {
      const m = /PORT=(\d+)/.exec(out);
      resolve({ status, port: m ? Number(m[1]) : null });
    });
  });
}

function listen(port = 0): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}
const close = (s: net.Server) => new Promise<void>((r) => s.close(() => r()));

// A port range nothing listens on. Drawn from 41000-48999, below the OS
// ephemeral range (49152+), where other processes' listen(0) and outbound
// sockets come and go and would make a "free" range busy a moment later.
async function freeRange(n: number): Promise<number> {
  for (let tries = 0; tries < 50; tries++) {
    const base = 41000 + Math.floor(Math.random() * (8000 - n));
    let ok = true;
    for (let p = base; p < base + n && ok; p++) {
      try {
        await close(await listen(p));
      } catch {
        ok = false;
      }
    }
    if (ok) return base;
  }
  throw new Error("could not find a free port range");
}

function deadPid(): number {
  const c = spawnSync("bash", ["-c", "echo $$"], { encoding: "utf8" });
  return Number(c.stdout.trim());
}

async function main() {
  try {
    // Concurrent picks hold different ports (6 processes, 8 ports, each holds 1 s).
    {
      const base = await freeRange(8);
      const e = { min: base, max: base + 7 };
      const res = await Promise.all(Array.from({ length: 6 }, () => runAsync(e, "sleep 1")));
      for (const r of res) assert.equal(r.status, 0);
      const ports = res.map((r) => r.port);
      assert.equal(new Set(ports).size, ports.length, `concurrent picks collided: ${ports.join(",")}`);
      for (const p of ports) assert.ok(p !== null && p >= base && p <= base + 7);
      for (const p of ports) assert.ok(!existsSync(lockDir(p as number)), `lock for ${p} left behind`);
      console.log(`ok: 6 concurrent picks got 6 different ports (${ports.join(",")}), no lock left`);
    }

    // A stale lock (dead PID) is reclaimed; a live one is not.
    {
      const base = await freeRange(1);
      const e = { min: base, max: base };
      mkdirSync(lockDir(base));
      writeFileSync(path.join(lockDir(base), "pid"), `${deadPid()}\n`);
      const r = run(e, `[ "$(cat "${lockDir(base)}/pid")" = "$$" ]`);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.port, base);
      assert.ok(!existsSync(lockDir(base)));

      mkdirSync(lockDir(base));
      writeFileSync(path.join(lockDir(base), "pid"), `${process.pid}\n`);
      const live = run(e);
      assert.notEqual(live.status, 0, "a live lock was stolen");
      assert.match(live.stderr, /no free port/);
      assert.equal(readFileSync(path.join(lockDir(base), "pid"), "utf8").trim(), String(process.pid));
      rmSync(lockDir(base), { recursive: true });
      console.log("ok: stale lock reclaimed, live lock kept");
    }

    // A port with a listener is never returned (checked before and after the lock).
    {
      const busy = await freeRange(2);
      const s = await listen(busy);
      const only = run({ min: busy, max: busy });
      assert.notEqual(only.status, 0, "a busy port was returned");
      assert.ok(!existsSync(lockDir(busy)), "a lock was left on a busy port");
      for (let i = 0; i < 5; i++) {
        const r = run({ min: busy, max: busy + 1 });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.port, busy + 1);
      }
      await close(s);
      console.log(`ok: port ${busy} with a listener skipped`);
    }

    // Skip-list ports are never returned (built-in list and PG_FREE_PORT_SKIP).
    {
      assert.match(readFileSync(HELPER, "utf8"), /^PG_FREE_PORT_BUILTIN_SKIP="[^"]*\b55477\b[^"]*\b56817\b[^"]*\b56931\b/m);
      for (const p of [55477, 56817, 56931]) {
        const r = run({ min: p, max: p });
        assert.notEqual(r.status, 0, `skip-list port ${p} was returned`);
      }
      for (let i = 0; i < 5; i++) {
        const r = run({ min: 55476, max: 55478 });
        assert.notEqual(r.port, 55477);
      }
      const base = await freeRange(2);
      for (let i = 0; i < 5; i++) {
        const r = run({ min: base, max: base + 1, skip: String(base) });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.port, base + 1);
      }
      console.log("ok: skip-list ports never returned");
    }

    // On exit: the cleanup runs first (lock still held), then the lock goes,
    // with the suite's status kept, also when the suite fails or the cleanup fails.
    {
      const base = await freeRange(1);
      const e = { min: base, max: base };
      const mark = path.join(lockRoot, "cleanup-saw-lock");
      const cleanup = `pg_on_exit 'false; [ -d "${lockDir(base)}" ] && echo yes > "${mark}"'`;
      const ok = run(e, cleanup);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(readFileSync(mark, "utf8").trim(), "yes", "cleanup did not run before the release");
      assert.ok(!existsSync(lockDir(base)), "lock left after a passing suite");
      rmSync(mark);

      const failing = run(e, `${cleanup}\nfalse\necho unreachable`);
      assert.equal(failing.status, 1);
      assert.doesNotMatch(failing.stdout, /unreachable/);
      assert.equal(readFileSync(mark, "utf8").trim(), "yes");
      assert.ok(!existsSync(lockDir(base)), "lock left after a failing suite");

      const exit3 = run(e, "exit 3");
      assert.equal(exit3.status, 3);
      assert.ok(!existsSync(lockDir(base)));

      // Its own process group, signalled as a whole like a Ctrl-C/kill of a run.
      const killed = spawn("bash", ["-c", script("sleep 30")], { env: envFor(e), detached: true });
      await new Promise((r) => setTimeout(r, 500));
      assert.ok(existsSync(lockDir(base)), "lock not held while the suite runs");
      process.kill(-(killed.pid as number), "SIGTERM");
      await new Promise((r) => killed.on("close", r));
      assert.ok(!existsSync(lockDir(base)), "lock left after SIGTERM");
      console.log("ok: lock released on exit (pass, fail, exit 3, SIGTERM), after the cleanup");
    }

    // ── 4. pg_start_throwaway ───────────────────────────────────────────
    await startHelperTests();
  } finally {
    rmSync(lockRoot, { recursive: true, force: true });
  }
}

// Stub initdb/pg_ctl. pg_ctl `start` fails (writing a FATAL line to its -l
// log) while $STUB_STATE/fails is below $STUB_FAIL_N; after that it delegates
// to $STUB_REAL_PG_CTL when set, else "starts" without doing anything. Every
// start's port goes to $STUB_STATE/starts.
const STUB_PG_CTL = `#!/usr/bin/env bash
orig=("$@")
dir="" opts="" log="" action=""
while [ $# -gt 0 ]; do
  case "$1" in
    -D) dir="$2"; shift 2 ;;
    -o) opts="$2"; shift 2 ;;
    -l) log="$2"; shift 2 ;;
    -m|-t) shift 2 ;;
    -w) shift ;;
    *) action="$1"; shift ;;
  esac
done
if [ "$action" = start ]; then
  port="$(sed -E 's/.*-p ([0-9]+).*/\\1/' <<<"$opts")"
  echo "$port" >>"$STUB_STATE/starts"
  n="$(cat "$STUB_STATE/fails" 2>/dev/null || echo 0)"
  if [ "$n" -lt "\${STUB_FAIL_N:-0}" ]; then
    echo $((n + 1)) >"$STUB_STATE/fails"
    echo "FATAL:  simulated start failure $((n + 1)) on port $port" >>"$log"
    exit 1
  fi
fi
if [ -n "\${STUB_REAL_PG_CTL:-}" ]; then
  exec "$STUB_REAL_PG_CTL" "\${orig[@]}"
fi
exit 0
`;

function realBin(name: string): string | null {
  const r = spawnSync("bash", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

async function startHelperTests() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pg-start-test-"));
  try {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "pg_ctl"), STUB_PG_CTL, { mode: 0o755 });
    const fakeInitdb = path.join(root, "fake-initdb");
    mkdirSync(fakeInitdb);
    writeFileSync(
      path.join(fakeInitdb, "initdb"),
      `#!/usr/bin/env bash\n[ -n "\${STUB_INITDB_FAIL:-}" ] && { echo "initdb: simulated failure" >&2; exit 1; }\nwhile [ $# -gt 0 ]; do [ "$1" = -D ] && mkdir -p "$2"; shift; done\n`,
      { mode: 0o755 },
    );

    let caseNo = 0;
    async function runStart(opts: { failN: number; real?: string | null; initdbFail?: boolean }) {
      const c = path.join(root, `case-${++caseNo}`);
      const work = path.join(c, "work");
      const keep = path.join(c, "keep");
      const state = path.join(c, "state");
      mkdirSync(work, { recursive: true });
      mkdirSync(state);
      const base = await freeRange(4);
      const body = [
        "set -euo pipefail",
        `source "${HELPER}"`,
        "pick_free_port",
        "FIRST=$PORT",
        'pg_layout() { DIR="$WORK/pg-${PORT}"; URL="postgres://postgres@127.0.0.1:${PORT}/postgres"; rm -rf "$DIR" && mkdir -p "$DIR"; }',
        "pg_layout",
        `pg_on_exit 'pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$DIR" "$DIR.log"'`,
        "pg_start_throwaway guard",
        'echo "FIRST=$FIRST PORT=$PORT"',
        opts.real ? `[ "$(psql -At "$URL" -c 'select inet_server_port()')" = "$PORT" ] && echo CHECKED` : "",
      ].join("\n");
      const PATH = [bin, ...(opts.real ? [] : [fakeInitdb]), process.env.PATH ?? ""].join(":");
      const r = spawnSync("bash", ["-c", body], {
        encoding: "utf8",
        env: {
          ...envFor({ min: base, max: base + 3 }),
          PATH,
          LANG: "en_US.UTF-8",
          WORK: work,
          PG_START_KEEP_DIR: keep,
          PG_START_TIMEOUT: "20",
          STUB_STATE: state,
          STUB_FAIL_N: String(opts.failN),
          STUB_REAL_PG_CTL: opts.real ?? "",
          STUB_INITDB_FAIL: opts.initdbFail ? "1" : "",
        },
      });
      const starts = existsSync(path.join(state, "starts"))
        ? readFileSync(path.join(state, "starts"), "utf8").trim().split("\n").filter(Boolean).map(Number)
        : [];
      const kept = existsSync(keep) ? readdirSync(keep).sort() : [];
      return { r, base, work, keep, starts, kept, left: readdirSync(work) };
    }
    const noLocks = (base: number) => {
      for (let p = base; p < base + 4; p++) assert.ok(!existsSync(lockDir(p)), `lock for ${p} left behind`);
    };

    // One failed start: log kept, tail printed, retry on a new port + fresh DIR.
    {
      const t = await runStart({ failN: 1 });
      assert.equal(t.r.status, 0, t.r.stderr);
      assert.equal(t.starts.length, 2, `expected 2 starts, got ${t.starts.join(",")}`);
      const [first, second] = t.starts;
      assert.notEqual(first, second, "the retry reused the failed port");
      assert.match(t.r.stdout, new RegExp(`FIRST=${first} PORT=${second}`));
      assert.equal(t.kept.length, 1, `kept logs: ${t.kept.join(",")}`);
      assert.match(t.kept[0], new RegExp(`^pg-start-failed-guard-${first}-\\d{8}T\\d{6}-\\d+\\.log$`));
      assert.match(readFileSync(path.join(t.keep, t.kept[0]), "utf8"), /simulated start failure 1 on port/);
      assert.match(t.r.stderr, /log kept at .*pg-start-failed-guard-/);
      assert.match(t.r.stderr, /FATAL: {2}simulated start failure 1/, "the log tail was not printed");
      assert.match(t.r.stderr, /retrying once on 127\.0\.0\.1:\d+ with a fresh DIR/);
      assert.deepEqual(t.left, [], `run dirs left behind: ${t.left.join(",")}`);
      noLocks(t.base);
      console.log(`ok: a failed start keeps its log and retries once on a new port (${first} -> ${second})`);
    }

    // Two failed starts: non-zero, two logs (one per port), nothing else left.
    {
      const t = await runStart({ failN: 2 });
      assert.notEqual(t.r.status, 0, "a double start failure passed");
      assert.doesNotMatch(t.r.stdout, /FIRST=/);
      assert.equal(t.starts.length, 2, `expected exactly 2 starts, got ${t.starts.join(",")}`);
      assert.notEqual(t.starts[0], t.starts[1]);
      assert.equal(t.kept.length, 2, `kept logs: ${t.kept.join(",")}`);
      for (const p of t.starts) {
        assert.ok(t.kept.some((k) => k.startsWith(`pg-start-failed-guard-${p}-`)), `no kept log for port ${p}`);
      }
      assert.match(t.r.stderr, /retry failed too/);
      assert.deepEqual(t.left, []);
      noLocks(t.base);
      console.log("ok: a double start failure exits non-zero with two kept logs");
    }

    // A failed initdb is never retried and never reaches pg_ctl start.
    {
      const t = await runStart({ failN: 0, initdbFail: true });
      assert.notEqual(t.r.status, 0);
      assert.deepEqual(t.starts, [], "pg_ctl start ran after a failed initdb");
      assert.deepEqual(t.kept, []);
      noLocks(t.base);
      console.log("ok: a failed initdb stops the suite, no start, no retry");
    }

    // With a real Postgres: the stub fails the first start, then delegates.
    const real = realBin("pg_ctl");
    if (real && realBin("initdb") && realBin("psql")) {
      const t = await runStart({ failN: 1, real });
      assert.equal(t.r.status, 0, t.r.stderr);
      assert.match(t.r.stdout, /CHECKED/, "inet_server_port check did not run on the retry's port");
      assert.equal(t.starts.length, 2);
      assert.notEqual(t.starts[0], t.starts[1]);
      assert.equal(t.kept.length, 1);
      assert.deepEqual(t.left, [], "the real server's DIR was not removed");
      noLocks(t.base);
      console.log(`ok: real Postgres started on the retry port ${t.starts[1]} after a simulated failure`);
    } else {
      console.log("skip: no initdb/pg_ctl/psql on PATH, real-Postgres retry case not run");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
