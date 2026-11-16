// Test harness: runs the REAL admin route handlers (app/api/admin/**/route.ts)
// against a fake database whose every row has every column filled with a
// sentinel, and a fake session that is an admin. Import it FIRST in a test
// file: it redirects lib/db (and auth.ts) before any route module loads.
//
// - The fake db answers any Drizzle chain (select / insert / update / delete,
//   joins, returning, execute, transaction) with one sentinel row of the
//   table named in the chain, picked down to the selected fields when the
//   chain names them, exactly as Postgres would.
// - Network is off: global fetch rejects, provider credentials are unset.
// Mock values only. Never imports the real database.
import Module from "node:module";
import { join } from "node:path";

import { getTableColumns, getTableName, is, Column, Table } from "drizzle-orm";

const ROOT = new URL("../../../", import.meta.url).pathname;
const REAL_DB = join(ROOT, "lib/db/index.ts");
const REAL_AUTH = join(ROOT, "auth.ts");
const FAKE_DB = join(ROOT, "scripts/tests/lib/admin-route-fake-db.ts");
const FAKE_AUTH = join(ROOT, "scripts/tests/lib/admin-route-fake-auth.ts");

const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
const resolve = M._resolveFilename;
M._resolveFilename = function (req: string, ...rest: unknown[]) {
  const file = resolve.call(this, req, ...rest);
  if (file === REAL_DB) return FAKE_DB;
  if (file === REAL_AUTH) return FAKE_AUTH;
  return file;
};

// No network, no provider credentials, a known internal secret.
for (const k of Object.keys(process.env)) {
  if (/^(TWILIO|OPENAI|REALTIME|GOOGLE|GEMINI|XAI|ELEVENLABS|LIVEKIT|RESEND|HYP|WHATSAPP|META|DATABASE)_?/.test(k)) delete process.env[k];
}
process.env.INTERNAL_SECRET = "internal-secret-mock-0000000000000000";
globalThis.fetch = (async () => {
  throw new Error("network is disabled in this test");
}) as typeof fetch;

export const ADMIN_ID = "admin-mock-id";
export const TARGET_ID = "user-mock-1";

// ── Secret columns, derived from the schema by NAME ────────────────────
export const SECRET_NAME = /hash|token|secret|key|password|pepper|seal/i;
/** Matched by the pattern but a plain setting (a response length cap). */
export const NOT_SECRET = new Set(["maxResponseTokens"]);
/** Secret whatever their name: stored values and records that carry secrets. */
export const EXPLICIT_SECRETS = [
  "passwordHash",
  "hypToken",
  "hypTokenExp",
  "googleRefreshToken",
  // T3: holds the client agent's sealed HMAC secret.
  "toolsConfig",
  // N1: the confirmation records (codes and their state).
  "contactConfirmations",
];

type Columns = Record<string, Column>;

/** Every column of the given tables whose name looks secret, plus the explicit list. */
export function secretColumns(tables: Columns[], explicit: string[] = EXPLICIT_SECRETS): string[] {
  const out = new Set<string>();
  for (const cols of tables) {
    for (const [prop, col] of Object.entries(cols)) {
      if (NOT_SECRET.has(prop)) continue;
      if (SECRET_NAME.test(prop) || SECRET_NAME.test(col.name)) out.add(prop);
    }
  }
  for (const e of explicit) out.add(e);
  return [...out].sort();
}

// ── Sentinel rows ───────────────────────────────────────────────────────
/** Tables whose secret columns are checked (by property name). */
export const CHECKED_TABLES = new Set(["users", "agent_configs"]);
let secretProps: Set<string> = new Set();
export function setSecretProps(names: string[]) {
  secretProps = new Set(names);
}
export const secretSentinel = (prop: string) => `SENTINEL-SECRET-${prop}-9f3a`;
const plainSentinel = (table: string, prop: string) => `sentinel-${table}-${prop}`;

/** A realistic value where a route needs one to go on (ids, the admin role). */
function knownValue(table: string, prop: string): unknown {
  if (prop === "id") return table === "users" ? ADMIN_ID : `${table}-mock-id`;
  if (prop === "userId") return TARGET_ID;
  if (table === "users" && prop === "role") return "admin";
  if (table === "users" && prop === "email") return "admin@example.com";
  return undefined;
}

export function sentinelRow(table: Table): Record<string, unknown> {
  const name = getTableName(table);
  const checked = CHECKED_TABLES.has(name);
  const row: Record<string, unknown> = {};
  for (const [prop, col] of Object.entries(getTableColumns(table) as Columns)) {
    const known = knownValue(name, prop);
    if (known !== undefined) {
      row[prop] = known;
      continue;
    }
    const secret = checked && secretProps.has(prop);
    const s = secret ? secretSentinel(prop) : plainSentinel(name, prop);
    switch (col.dataType) {
      case "number":
        row[prop] = 7;
        break;
      case "boolean":
        row[prop] = true;
        break;
      case "date":
        row[prop] = new Date(Date.UTC(2026, 10, 16, 9, 0, 0));
        break;
      case "json":
        row[prop] = secret ? { nested: { secret: s, sealed: `v1:${s}` } } : {};
        break;
      default:
        row[prop] = s;
    }
  }
  return row;
}

/** One row as Postgres returns it for `fields` (or the whole row). */
export function projectRow(table: Table | null, fields: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) {
  const whole = table ? { ...sentinelRow(table), ...extra } : {};
  if (!fields) return whole;
  const out: Record<string, unknown> = {};
  for (const [alias, f] of Object.entries(fields)) {
    if (is(f, Column)) {
      const t = (f as Column).table as Table;
      const prop = Object.entries(getTableColumns(t) as Columns).find(([, c]) => c === f)?.[0];
      const src = t === table ? whole : sentinelRow(t);
      out[alias] = prop ? src[prop] : null;
    } else if (is(f, Table)) {
      out[alias] = f === table ? whole : sentinelRow(f as Table);
    } else if (f && typeof f === "object" && !("getSQL" in (f as object))) {
      out[alias] = projectRow(table, f as Record<string, unknown>, extra);
    } else {
      out[alias] = 0; // an SQL expression (count, sum…)
    }
  }
  return out;
}

export interface RouteCall {
  file: string;
  method: string;
  status: number | null;
  text: string;
  error?: string;
}
