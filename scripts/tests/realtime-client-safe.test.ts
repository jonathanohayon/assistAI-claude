// Client code never value-imports lib/realtime.ts: it carries the provider
// catalogue (PROVIDERS, model ids, env names), the demo instructions and the
// tool definitions, and a client import ships them to the browser (the public
// landing demo did, scripts/check-public-bundle.mjs). Same for the
// server-only lib/demo-session.ts (tool names). lib/realtime-provider.ts (the
// admin engine picker's model ids) stays reachable from the admin voice UI only.
//
// Scans every "use client" file under app/, components/ and lib/, plus what
// each one imports from the repo, one level deep. `import type` is fine.
// Run with:  npx tsx scripts/tests/realtime-client-safe.test.ts
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;

/** Specifiers of the value imports / re-exports of a source file (type-only ones skipped). */
export function valueImports(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) out.push(m[1]!);
  return out;
}

function resolveLocal(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

const rel = (p: string) => p.slice(ROOT.length);
const isClient = (src: string) => /^["']use client["']/m.test(src);

/** Repo files a file value-imports: directly, and one level through them. */
function reach(file: string): Map<string, string> {
  const seen = new Map<string, string>(); // target -> via
  for (const spec of valueImports(readFileSync(file, "utf8"))) {
    const t = resolveLocal(spec, file);
    if (!t) continue;
    if (!seen.has(t)) seen.set(t, rel(file));
    for (const spec2 of valueImports(readFileSync(t, "utf8"))) {
      const t2 = resolveLocal(spec2, t);
      if (t2 && !seen.has(t2)) seen.set(t2, `${rel(file)} -> ${rel(t)}`);
    }
  }
  return seen;
}

// 0. The detector itself.
assert.deepEqual(valueImports('import { transportFor } from "@/lib/realtime";'), ["@/lib/realtime"]);
assert.deepEqual(valueImports('import {\n  a,\n  type B,\n} from "@/lib/realtime";'), ["@/lib/realtime"]);
assert.deepEqual(valueImports('import type { Provider } from "@/lib/realtime";'), []);
assert.deepEqual(valueImports('export { PROVIDERS } from "@/lib/realtime";'), ["@/lib/realtime"]);
assert.deepEqual(valueImports('import "@/lib/realtime";'), ["@/lib/realtime"]);
assert.deepEqual(valueImports('import { a } from "@/lib/realtime-events";'), ["@/lib/realtime-events"]);

const REALTIME = join(ROOT, "lib/realtime.ts");
const DEMO_SESSION = join(ROOT, "lib/demo-session.ts");
const PROVIDER_CATALOGUE = join(ROOT, "lib/realtime-provider.ts");
assert.ok(existsSync(REALTIME) && existsSync(DEMO_SESSION) && existsSync(PROVIDER_CATALOGUE));

const clientFiles = ["app", "components", "lib"]
  .flatMap((d) => walk(join(ROOT, d)))
  .filter((p) => isClient(readFileSync(p, "utf8")));
assert.ok(clientFiles.some((p) => rel(p) === "components/VoiceAgent.tsx"), "the scan sees the landing demo");

// 1. lib/realtime.ts and lib/demo-session.ts: no client path to them.
const offenders: string[] = [];
const providerReach: string[] = [];
for (const f of clientFiles) {
  const r = reach(f);
  for (const forbidden of [REALTIME, DEMO_SESSION]) {
    if (r.has(forbidden)) offenders.push(`${r.get(forbidden)} -> ${rel(forbidden)}`);
  }
  if (r.has(PROVIDER_CATALOGUE)) providerReach.push(rel(f));
}
assert.deepEqual(offenders, [], "client code value-imports lib/realtime.ts or lib/demo-session.ts");

// 2. lib/realtime-provider.ts: the admin voice UI only. A new entry here
//    means a new client path to model ids: check it is admin-only first.
assert.deepEqual(providerReach.sort(), ["components/bricks/voice/VoiceAdminFields.tsx"]);

console.log(`realtime-client-safe: ok (${clientFiles.length} client files)`);
