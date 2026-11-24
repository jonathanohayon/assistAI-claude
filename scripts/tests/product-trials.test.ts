// P3 per-product trials, pure parts: productTrialStartable (flag AND cap),
// the enforced caps, signupDoorTrial, trialStates, activeTrialProducts,
// trialUsage, the sales trial cap, and source guards that tie the sales cap
// to the dispatcher (removing the dispatcher's check fails this test).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SALES_TRIAL_CAP_ENFORCED, salesTrialRefusal } from "../../lib/campaigns/sales-trial-cap";
import { TRIAL_CAPS_ENFORCED } from "../../lib/product-trial-caps";
import {
  PRODUCT_TRIAL_DAYS,
  PRODUCT_TRIAL_MINUTES,
  activeTrialProducts,
  isProduct,
  productFlagOn,
  productTrialStartable,
  productTrialWindow,
  signupDoorTrial,
  trialStates,
  trialUsage,
  type TrialCaps,
} from "../../lib/product-trials";
import { PRODUCTS } from "../../lib/product-values";

// ── Constants ─────────────────────────────────────────────────────────────
assert.equal(PRODUCT_TRIAL_DAYS, 7);
assert.equal(PRODUCT_TRIAL_MINUTES, 30);
const T0 = new Date("2026-11-01T10:00:00.000Z");
const w = productTrialWindow(T0);
assert.equal(w.startedAt.toISOString(), "2026-11-01T10:00:00.000Z");
assert.equal(w.endsAt.toISOString(), "2026-11-08T10:00:00.000Z");
assert.equal(w.minutesIncluded, 30);

// ── The enforced caps: only sales, and only through the dispatcher ───────
assert.equal(SALES_TRIAL_CAP_ENFORCED, true);
assert.deepEqual(TRIAL_CAPS_ENFORCED, { reception: false, reception_multi: false, sales: true, connect: false });

// ── productTrialStartable(product, env, caps): a table ───────────────────
const ALL_ON: TrialCaps = { reception: true, reception_multi: true, sales: true, connect: true };
const ALL_OFF: TrialCaps = { reception: false, reception_multi: false, sales: false, connect: false };
const ENVS: Array<[string, Record<string, string | undefined>]> = [
  ["unset", {}],
  ["dispatch on", { CAMPAIGN_DISPATCH: "on" }],
  ["dispatch ON (case, spaces)", { CAMPAIGN_DISPATCH: " ON " }],
  ["dispatch dry", { CAMPAIGN_DISPATCH: "dry" }],
  ["client agent all", { CLIENT_AGENT: "all" }],
  ["client agent admin", { CLIENT_AGENT: "admin" }],
  ["both on", { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" }],
];
const flag = (p: string, e: Record<string, string | undefined>) => {
  const d = (e.CAMPAIGN_DISPATCH ?? "").trim().toLowerCase() === "on";
  const c = (e.CLIENT_AGENT ?? "").trim().toLowerCase() === "all";
  return p === "sales" ? d : p === "connect" ? c : true;
};
let n = 0;
for (const [ename, env] of ENVS) {
  for (const p of PRODUCTS) {
    assert.equal(productFlagOn(p, env), flag(p, env), `flag ${p} / ${ename}`);
    // Real caps: reception, reception_multi and connect are NEVER startable.
    const want = p === "sales" && flag(p, env);
    assert.equal(productTrialStartable(p, env, TRIAL_CAPS_ENFORCED), want, `startable ${p} / ${ename} (real caps)`);
    assert.equal(productTrialStartable(p, env, ALL_ON), flag(p, env), `startable ${p} / ${ename} (all caps)`);
    assert.equal(productTrialStartable(p, env, ALL_OFF), false, `startable ${p} / ${ename} (no cap)`);
    n += 3;
  }
}

// ── signupDoorTrial: each door × usable / unusable ───────────────────────
const ON = { CAMPAIGN_DISPATCH: "on", CLIENT_AGENT: "all" };
const doorCases: Array<[string | null, Record<string, string | undefined>, TrialCaps, string | null]> = [
  [null, ON, TRIAL_CAPS_ENFORCED, null],
  ["reception", ON, ALL_ON, null],
  ["reception", {}, ALL_ON, null],
  ["sales", ON, TRIAL_CAPS_ENFORCED, "sales"],
  ["sales", {}, TRIAL_CAPS_ENFORCED, null],
  ["sales", { CAMPAIGN_DISPATCH: "dry" }, TRIAL_CAPS_ENFORCED, null],
  ["sales", ON, ALL_OFF, null],
  ["connect", ON, TRIAL_CAPS_ENFORCED, null], // cap not enforced → never at sign-up today
  ["connect", ON, ALL_ON, "connect"],
  ["connect", {}, ALL_ON, null],
  ["junk", ON, ALL_ON, null],
];
for (const [door, env, caps, want] of doorCases) {
  assert.equal(signupDoorTrial(door, env, caps), want, `signupDoorTrial ${door} ${JSON.stringify(env)}`);
}

// ── isProduct ─────────────────────────────────────────────────────────────
for (const p of PRODUCTS) assert.ok(isProduct(p));
for (const x of ["", "Sales", "gold", null, 1, {}, ["sales"]]) assert.equal(isProduct(x), false, `isProduct ${JSON.stringify(x)}`);

// ── trialStates / activeTrialProducts ─────────────────────────────────────
const NOW = new Date("2026-11-05T00:00:00.000Z");
const row = (product: string, start: string, end: string) => ({ product, startedAt: new Date(start), endsAt: new Date(end), minutesIncluded: 30 });
const ACTIVE_SALES = row("sales", "2026-11-01T00:00:00.000Z", "2026-11-08T00:00:00.000Z");
const USED_CONNECT = row("connect", "2026-10-01T00:00:00.000Z", "2026-10-08T00:00:00.000Z");
const AVAIL = { state: "available" } as const;
const stateCases: Array<[string, Parameters<typeof trialStates>[0], ReturnType<typeof trialStates>]> = [
  ["no rows", [], { reception: AVAIL, sales: AVAIL, connect: AVAIL }],
  [
    "active sales, used connect",
    [ACTIVE_SALES, USED_CONNECT],
    { reception: AVAIL, sales: { state: "active", endsAt: "2026-11-08T00:00:00.000Z" }, connect: { state: "used", endsAt: "2026-10-08T00:00:00.000Z" } },
  ],
  ["ends exactly now = used", [row("sales", "2026-10-29T00:00:00.000Z", "2026-11-05T00:00:00.000Z")], { reception: AVAIL, sales: { state: "used", endsAt: "2026-11-05T00:00:00.000Z" }, connect: AVAIL }],
  ["not started yet = used", [row("sales", "2026-11-06T00:00:00.000Z", "2026-11-13T00:00:00.000Z")], { reception: AVAIL, sales: { state: "used", endsAt: "2026-11-13T00:00:00.000Z" }, connect: AVAIL }],
  [
    "reception_multi maps to the reception entry; active beats used",
    [row("reception", "2026-10-01T00:00:00.000Z", "2026-10-08T00:00:00.000Z"), row("reception_multi", "2026-11-04T00:00:00.000Z", "2026-11-11T00:00:00.000Z")],
    { reception: { state: "active", endsAt: "2026-11-11T00:00:00.000Z" }, sales: AVAIL, connect: AVAIL },
  ],
  ["unknown product ignored", [row("gold", "2026-11-01T00:00:00.000Z", "2026-11-08T00:00:00.000Z")], { reception: AVAIL, sales: AVAIL, connect: AVAIL }],
];
for (const [name, rows, want] of stateCases) assert.deepEqual(trialStates(rows, NOW), want, `trialStates: ${name}`);
assert.deepEqual(activeTrialProducts([ACTIVE_SALES, USED_CONNECT, ACTIVE_SALES], NOW), ["sales"]);
assert.deepEqual(activeTrialProducts([], NOW), []);

// ── trialUsage ────────────────────────────────────────────────────────────
const at = (s: string) => new Date(s);
const usage = trialUsage(
  [ACTIVE_SALES, USED_CONNECT],
  [
    { durationSeconds: 120, product: "sales", createdAt: at("2026-11-02T00:00:00.000Z") },
    { durationSeconds: 600, product: null, createdAt: at("2026-11-02T00:00:00.000Z") }, // reception: not a trial entry
    { durationSeconds: 90, product: "connect", createdAt: at("2026-10-02T00:00:00.000Z") },
    { durationSeconds: 999, product: "connect", createdAt: at("2026-10-08T00:00:00.000Z") }, // at ends_at: outside
  ],
  [
    { durationSeconds: 300, createdAt: at("2026-11-03T00:00:00.000Z") },
    { durationSeconds: 777, createdAt: at("2026-10-31T23:59:59.000Z") }, // before the sales trial
    { durationSeconds: -5, createdAt: at("2026-11-03T00:00:00.000Z") },
  ],
  NOW,
);
assert.deepEqual(usage, [
  { product: "sales", entry: "sales", state: "active", startedAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-08T00:00:00.000Z", minutesIncluded: 30, usedSeconds: 420, usedMinutes: 7 },
  { product: "connect", entry: "connect", state: "used", startedAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-08T00:00:00.000Z", minutesIncluded: 30, usedSeconds: 90, usedMinutes: 2 },
]);

// ── salesTrialRefusal: a table ────────────────────────────────────────────
const TRIAL = { startedAt: at("2026-11-01T00:00:00.000Z"), endsAt: at("2026-11-08T00:00:00.000Z"), minutesIncluded: 30 };
const capCases: Array<[string, Parameters<typeof salesTrialRefusal>[0], ReturnType<typeof salesTrialRefusal>]> = [
  ["no trial row", { salesEntitledWithoutTrial: false, trial: null, usedSeconds: 99999, now: NOW }, null],
  ["paid / grandfathered, trial exhausted", { salesEntitledWithoutTrial: true, trial: TRIAL, usedSeconds: 99999, now: at("2026-12-01T00:00:00.000Z") }, null],
  ["active, unused", { salesEntitledWithoutTrial: false, trial: TRIAL, usedSeconds: 0, now: NOW }, null],
  ["active, 1 s short", { salesEntitledWithoutTrial: false, trial: TRIAL, usedSeconds: 1799, now: NOW }, null],
  ["active, exactly 30 min", { salesEntitledWithoutTrial: false, trial: TRIAL, usedSeconds: 1800, now: NOW }, "sales_trial_minutes_used"],
  ["active, over", { salesEntitledWithoutTrial: false, trial: TRIAL, usedSeconds: 5000, now: NOW }, "sales_trial_minutes_used"],
  ["junk seconds = 0", { salesEntitledWithoutTrial: false, trial: TRIAL, usedSeconds: Number.NaN, now: NOW }, null],
  ["now = ends_at", { salesEntitledWithoutTrial: false, trial: TRIAL, usedSeconds: 0, now: TRIAL.endsAt }, "sales_trial_ended"],
  ["ended and exhausted: ended first", { salesEntitledWithoutTrial: false, trial: TRIAL, usedSeconds: 5000, now: at("2026-12-01T00:00:00.000Z") }, "sales_trial_ended"],
];
for (const [name, input, want] of capCases) assert.equal(salesTrialRefusal(input), want, `salesTrialRefusal: ${name}`);

// ── Source guards: the sales cap is enforced ONLY through the dispatcher ─
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const dispatch = code("lib/campaigns/dispatch.ts");
assert.match(dispatch, /salesTrialGate:\s*\(userId\)\s*=>\s*salesTrialGate\(userId\)/, "the dispatcher's default deps wire the real sales trial gate");
const loop = dispatch.slice(dispatch.indexOf("for (const job of jobs)"));
const gateAt = loop.indexOf("d.salesTrialGate(job.userId)");
const dialAt = loop.indexOf("d.dial(");
assert.ok(gateAt > 0 && dialAt > gateAt, "the dispatcher checks the sales trial cap before dialling");
assert.match(loop.slice(gateAt, dialAt), /if \(refusal\)[\s\S]*continue;/, "a refusal skips the dial");
const caps = code("lib/product-trial-caps.ts");
assert.match(caps, /sales:\s*SALES_TRIAL_CAP_ENFORCED/, "the sales cap reads the dispatcher-backed constant");
assert.match(caps, /reception:\s*false/);
assert.match(caps, /reception_multi:\s*false/);
assert.match(caps, /connect:\s*false/);
// The trial POST, accountProducts' startable and sign-up all use the enforced
// caps (never ALL_ON-like literals). The POST's check is trialStartDecision
// (lib/product-trial-decision.ts), which calls productTrialStartable.
assert.match(code("lib/product-trials-start.ts"), /trialStartDecision\(product, [^;]*, env, TRIAL_CAPS_ENFORCED\)/);
assert.match(code("lib/products.ts"), /trialStartDecision\(TRIAL_PRODUCT_OF_ENTRY\[e\], account, env, TRIAL_CAPS_ENFORCED\)/);
assert.match(code("lib/product-trial-decision.ts"), /productTrialStartable\(product, env, caps\)/);
assert.match(code("lib/auth/provision-tenant.ts"), /signupDoorTrial\([^)]*TRIAL_CAPS_ENFORCED\)/);
// Pure modules stay pure.
const imports = (p: string) => [...readFileSync(p, "utf8").matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
assert.deepEqual(imports("lib/campaigns/sales-trial-cap.ts"), []);
assert.deepEqual(imports("lib/campaigns/dispatch-mode.ts"), []);
assert.deepEqual(imports("lib/tools/client-agent-switch.ts"), []);
assert.deepEqual(imports("lib/product-trials.ts").sort(), ["./campaigns/dispatch-mode", "./product-values", "./tools/client-agent-switch"]);
for (const p of ["lib/product-trials.ts", "lib/campaigns/sales-trial-cap.ts", "lib/product-trial-caps.ts"]) {
  assert.ok(!/server-only|@\/lib\/db|drizzle/.test(readFileSync(p, "utf8")), `${p} stays pure`);
}

console.log(`product-trials: ${n} startable cases, ${doorCases.length} door cases, ${capCases.length} cap cases ok`);
