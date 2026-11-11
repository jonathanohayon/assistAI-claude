// scripts/migrate.mjs runs at EVERY startup (prod included). It must never
// write a persona into an existing agent_configs row, must create a missing
// admin config with the neutral persona only, and a second run must write
// nothing at all.
//
// The pure checks always run. The DB checks need a THROWAWAY Postgres, so in
// a plain `npm test` they skip. Run them with:
//   bash scripts/migrate-startup-db.sh
// which starts a local Postgres on 127.0.0.1:55438 and sets
// MIGRATE_STARTUP_TEST_DATABASE_URL. Only a 127.0.0.1/localhost URL is
// accepted and DATABASE_URL is never read. Mock data only.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { neutralSeed } from "../../lib/neutral-seed";
import { NEUTRAL_FR_GREETING, NEUTRAL_FR_INSTRUCTIONS } from "../neutral-persona-fr.mjs";

import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const ROOT = new URL("../../", import.meta.url).pathname;
const SCRIPT = readFileSync(join(ROOT, "scripts/migrate.mjs"), "utf8");

// ── Pure checks ─────────────────────────────────────────────────────────
// The .mjs copy is byte-identical to the neutral persona of lib/neutral-seed.
assert.equal(NEUTRAL_FR_INSTRUCTIONS, neutralSeed("fr").instructions);
assert.equal(NEUTRAL_FR_GREETING, neutralSeed("fr").greeting);
assert.doesNotMatch(SCRIPT, FIRST_CUSTOMER_FACTS, "no first-customer fact in migrate.mjs");
assert.doesNotMatch(SCRIPT, /update\s+agent_configs/i, "migrate.mjs never updates agent_configs");
assert.doesNotMatch(SCRIPT, /PLACEHOLDER/, "no placeholder-upgrade branch");
console.log("migrate-startup: pure checks passed");

const serverUrl = process.env.MIGRATE_STARTUP_TEST_DATABASE_URL;
if (!serverUrl) {
  console.log("skip: migrate-startup DB checks (no MIGRATE_STARTUP_TEST_DATABASE_URL — see scripts/migrate-startup-db.sh)");
  process.exit(0);
}
const host = new URL(serverUrl).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`refusing to run against non-local database host ${host}`);
}

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "mock-admin-password";
const LEGACY_NUMBER = "+15550000001";
// The placeholder text the old script used to upgrade to the first customer's persona.
const OLD_PLACEHOLDER = "Tu es l'assistant vocal du centre. Réponds chaleureusement et brièvement.";

const dbUrl = (name: string) => {
  const u = new URL(serverUrl);
  u.pathname = `/${name}`;
  return u.toString();
};

/** Runs migrate.mjs with a clean env (no credential of the shell). */
function runMigrate(name: string, extra: Record<string, string> = {}): string {
  return execFileSync("node", ["scripts/migrate.mjs"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: dbUrl(name), ...extra } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
}
const ADMIN_ENV = { ADMIN_EMAIL, ADMIN_PASSWORD };

async function main() {
  const { default: postgres } = await import("postgres");
  const { default: bcrypt } = await import("bcryptjs");
  const server = postgres(serverUrl!, { max: 1, onnotice: () => {} });
  const open = (name: string) => postgres(dbUrl(name), { max: 1 });

  /** md5 of every table's content, in every non-system schema. */
  async function checksums(sql: ReturnType<typeof postgres>): Promise<Record<string, string>> {
    const tables = await sql<{ s: string; t: string }[]>`
      select table_schema as s, table_name as t from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
      order by 1, 2`;
    const out: Record<string, string> = {};
    for (const { s, t } of tables) {
      const q = `select coalesce(md5(string_agg(x::text, '' order by x::text)), 'empty') as h from "${s}"."${t}" x`;
      const [r] = await sql.unsafe<{ h: string }[]>(q);
      out[`${s}.${t}`] = r.h;
    }
    assert.ok(Object.keys(out).length > 10, "the schema is migrated");
    return out;
  }
  const rows = async (sql: ReturnType<typeof postgres>) =>
    (await sql<{ j: string }[]>`select row_to_json(a)::text as j from agent_configs a order by id`).map((r) => r.j);
  const noFacts = async (sql: ReturnType<typeof postgres>) => {
    for (const j of await rows(sql)) assert.doesNotMatch(j, FIRST_CUSTOMER_FACTS);
  };

  for (const n of ["fresh", "seeded", "nocfg"]) {
    await server.unsafe(`drop database if exists ${n}`);
    await server.unsafe(`create database ${n}`);
  }

  // A. Fresh DB: the admin and its config are created, with the neutral persona.
  {
    runMigrate("fresh", ADMIN_ENV);
    const sql = open("fresh");
    const cfg = await sql`select a.instructions, a.greeting_instructions from agent_configs a join users u on u.id = a.user_id where u.email = ${ADMIN_EMAIL}`;
    assert.equal(cfg.length, 1);
    assert.equal(cfg[0].instructions, neutralSeed("fr").instructions);
    assert.equal(cfg[0].greeting_instructions, neutralSeed("fr").greeting);
    await noFacts(sql);
    const c1 = await checksums(sql);
    runMigrate("fresh", ADMIN_ENV);
    assert.deepEqual(await checksums(sql), c1, "fresh: the second run writes nothing");
    await sql.end();
    console.log("migrate-startup: A fresh DB ok");
  }

  // B. Seeded copy with an existing admin config (the old "placeholder" one)
  //    and another tenant: the startup run changes nothing, twice.
  {
    runMigrate("seeded"); // schema only (no ADMIN_* env → no seed)
    const sql = open("seeded");
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 4);
    const [admin] = await sql`insert into users (email, password_hash, role, display_name) values (${ADMIN_EMAIL}, ${hash}, 'admin', 'Admin') returning id`;
    const [other] = await sql`insert into users (email, password_hash, display_name) values ('tenant-b@example.com', 'x', 'Mock Tenant B') returning id`;
    await sql`insert into agent_configs (user_id, instructions, greeting_instructions, business) values
      (${admin.id}, ${OLD_PLACEHOLDER}, 'Mock admin greeting', ${sql.json({ identity: { name: "Demo Salon A", tagline: "", email: "" }, centres: [], services: [] })})`;
    await sql`insert into agent_configs (user_id, instructions, greeting_instructions) values (${other.id}, 'Mock tenant B instructions', 'Mock tenant B greeting')`;
    await sql`insert into phone_numbers (user_id, phone_number, label) values (${admin.id}, ${LEGACY_NUMBER}, 'Mock label')`;
    const before = await rows(sql);
    const c0 = await checksums(sql);
    const env = { ...ADMIN_ENV, TWILIO_PHONE_NUMBER: LEGACY_NUMBER };
    runMigrate("seeded", env);
    assert.deepEqual(await rows(sql), before, "seeded: agent_configs rows byte-identical after the first run");
    assert.deepEqual(await checksums(sql), c0, "seeded: the first run changes no table");
    runMigrate("seeded", env);
    assert.deepEqual(await rows(sql), before, "seeded: agent_configs rows byte-identical after the second run");
    assert.deepEqual(await checksums(sql), c0, "seeded: the second run changes no table");
    await noFacts(sql);

    // A new ADMIN_PASSWORD still resets the password — and touches nothing else.
    runMigrate("seeded", { ...env, ADMIN_PASSWORD: "mock-new-password" });
    const c1 = await checksums(sql);
    const changed = Object.keys(c0).filter((k) => c0[k] !== c1[k]);
    assert.deepEqual(changed, ["public.users"], "a password change writes users only");
    assert.deepEqual(await rows(sql), before);
    const [u] = await sql`select password_hash, role from users where email = ${ADMIN_EMAIL}`;
    assert.ok(await bcrypt.compare("mock-new-password", u.password_hash));
    assert.equal(u.role, "admin");
    runMigrate("seeded", { ...env, ADMIN_PASSWORD: "mock-new-password" });
    assert.deepEqual(await checksums(sql), c1, "same new password: the next run writes nothing");
    await sql.end();
    console.log("migrate-startup: B seeded DB ok");
  }

  // C. Existing admin WITHOUT a config: only that config is inserted (neutral).
  {
    runMigrate("nocfg");
    const sql = open("nocfg");
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 4);
    await sql`insert into users (email, password_hash, role, display_name) values (${ADMIN_EMAIL}, ${hash}, 'admin', 'Admin')`;
    const c0 = await checksums(sql);
    runMigrate("nocfg", ADMIN_ENV);
    const c1 = await checksums(sql);
    assert.deepEqual(Object.keys(c0).filter((k) => c0[k] !== c1[k]), ["public.agent_configs"]);
    const cfg = await sql`select instructions, greeting_instructions from agent_configs`;
    assert.equal(cfg.length, 1);
    assert.equal(cfg[0].instructions, neutralSeed("fr").instructions);
    assert.equal(cfg[0].greeting_instructions, neutralSeed("fr").greeting);
    await noFacts(sql);
    runMigrate("nocfg", ADMIN_ENV);
    assert.deepEqual(await checksums(sql), c1, "nocfg: the second run writes nothing");
    await sql.end();
    console.log("migrate-startup: C admin without config ok");
  }

  await server.end();
  console.log("ALL MIGRATE-STARTUP TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
