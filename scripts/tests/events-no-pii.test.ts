// No caller numbers or email addresses in clear in the `events` table.
// Mock data only (+1555 numbers, example.com addresses).
//   1. Static: every logEvent(...) / remoteLog(...) call site in app/, lib/
//      and auth.ts puts no email / phone expression in its message and no
//      email / phone key in its metadata (the tenant's own line excepted).
//   2. Dynamic: lib/event-pii.ts on mock events shaped like the call sites
//      and the worker's posts, and the real logEvent() (no DATABASE_URL: the
//      insert fails silently, the stdout mirror prints the stored copy).
//   3. Readers keep working on the new shape (Calls join, Monitoring label,
//      tenant resolution).
// Run with:  npx tsx scripts/tests/events-no-pii.test.ts

import assert from "node:assert/strict";

import { callReceivedEvent } from "../../lib/call-received-event";
import {
  KEPT_KEY_PATHS,
  callerFields,
  emailFields,
  eventForStorage,
  last4,
  maskPii,
  piiHash,
} from "../../lib/event-pii";
import { attachEvents, hashCallId, type JoinEvent } from "../../lib/calls/core";
import { assertScanRead, scanSources } from "./helpers/source-scan";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const E164 = /\+[1-9]\d{6,14}/;

/** Paths (dot-joined) of every string in `v` that matches re, except kept paths. */
function leaks(v: unknown, re: RegExp, path = ""): string[] {
  if (typeof v === "string") return re.test(v.replace(/[\s().-]/g, "")) || re.test(v) ? [path || "(root)"] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaks(x, re, `${path}[${i}]`));
  if (v && typeof v === "object") {
    return Object.entries(v).flatMap(([k, x]) => {
      const p = path ? `${path}.${k}` : k;
      return KEPT_KEY_PATHS.includes(p) ? [] : leaks(x, re, p);
    });
  }
  return [];
}
const assertClean = (label: string, stored: { message: string; metadata: unknown }) => {
  assert.deepEqual(leaks(stored.message, EMAIL), [], `${label}: email in message: ${stored.message}`);
  assert.deepEqual(leaks(stored.message, E164), [], `${label}: number in message: ${stored.message}`);
  assert.deepEqual(leaks(stored.metadata, EMAIL), [], `${label}: email in metadata ${JSON.stringify(stored.metadata)}`);
  assert.deepEqual(leaks(stored.metadata, E164), [], `${label}: number in metadata ${JSON.stringify(stored.metadata)}`);
};

// ── 1. Static scan of the call sites ────────────────────────────────────
// An expression carrying an address or a number (interpolated in a message).
const PII_EXPR = /email|phone|fromNumber|toNumber|calledNumber|callerNumber|ownerWa|ownerWhatsapp|whatsapp|(?<![.\w])(to|from)(?![\w.])/i;
// A metadata key carrying an address or a number. toNumber / tenantLine are
// the tenant's own line (lib/event-pii.ts KEPT_KEY_PATHS).
const PII_KEY = /^(email|phone|phoneNumber|fromNumber|callerPhone|callerNumber|calledPhone|ownerWa|ownerWhatsapp|phoneToBuy|localFromNumber)$|[a-z](Email|Phone|PhoneNumber|FromNumber|Whatsapp|WhatsApp)$/;
const NUMBERISH = /number|phone|whatsapp|ownerWa/i;

/** The text of each `name(` call, parentheses balanced (strings and templates skipped). */
function callBlocks(src: string, name: RegExp): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(name)) {
    const start = (m.index ?? 0) + m[0].length;
    // The definitions themselves are not call sites.
    if (/function\s*$/.test(src.slice(Math.max(0, (m.index ?? 0) - 12), m.index))) continue;
    let depth = 1;
    let i = start;
    let quote: string | null = null;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        else if (quote === "`" && c === "$" && src[i + 1] === "{") {
          // Template interpolation: count its braces, not its parentheses.
          let b = 1;
          i += 2;
          while (i < src.length && b > 0) {
            if (src[i] === "{") b++;
            else if (src[i] === "}") b--;
            i++;
          }
          continue;
        }
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

// Helpers that turn a value into its safe fields: their arguments are fine.
const SAFE_CALL = /\b(?:callerFields|phoneFields|emailFields|last4|piiHash|callReceivedEvent)\((?:[^()]|\([^()]*\))*\)/g;

function offenders(raw: string): string[] {
  const found: string[] = [];
  const block = raw.replace(SAFE_CALL, "safe()");
  for (const m of block.matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    if (PII_EXPR.test(m[1])) found.push(`message interpolates \${${m[1].trim()}}`);
  }
  // Object keys: `key:` or shorthand `key,` / `key }` / `key\n`, outside strings.
  const code = block
    .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/`[^`]*`|"[^"\n]*"|'[^'\n]*'/g, '""');
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*(?::\s*([^,{}\n]*)|(?=\s*[,}\n]))/g)) {
    const key = m[1];
    const value = (m[2] ?? key).trim();
    if (PII_KEY.test(key)) found.push(`metadata key ${key}`);
    else if ((key === "to" || key === "from") && NUMBERISH.test(value)) found.push(`metadata key ${key}: ${value}`);
  }
  return found;
}

{
  // Self-test of the scanner on known shapes, so a broken regex can't pass silently.
  const bad = 'logEvent({ message: `Appel reçu de ${fromNumber} pour ${user.email}`, metadata: { fromNumber, to: cfg.ownerWhatsapp, email: me.email } })';
  const got = callBlocks(bad, /\blogEvent\(/g).flatMap(offenders);
  assert.equal(got.length, 5, `scanner self-test found ${JSON.stringify(got)}`);
  const good = 'logEvent({ message: `Plan ${from} → ${rule.to} (${durationSeconds}s)`.replace(/x/, ""), metadata: { toNumber, to: nextPlan, ...callerFields(fromNumber) } })';
  // `${from}` is a bare identifier: flagged on purpose (it is how numbers leaked).
  assert.deepEqual(callBlocks(good, /\blogEvent\(/g).flatMap(offenders), ["message interpolates ${from}"]);
}

const scan = scanSources(["app", "lib", "auth.ts"], { ext: /\.tsx?$/ });
assertScanRead(scan, "events-no-pii", {
  minFiles: 300,
  sentinels: ["app/api/calls/end/route.ts", "auth.ts", "lib/logger.ts", "app/api/events/route.ts", "lib/campaigns/dispatch.ts"],
});
let callSites = 0;
const report: string[] = [];
for (const [file, src] of scan.text) {
  for (const block of callBlocks(src, /\b(?:logEvent|remoteLog)\(/g)) {
    callSites++;
    for (const o of offenders(block)) report.push(`${file}: ${o}`);
  }
}
// The scan must have seen the real call sites (about 150 on 2026-11-15).
assert.ok(callSites >= 120, `only ${callSites} logEvent/remoteLog call sites found`);
assert.deepEqual(report, [], `PII at logEvent call sites:\n${report.join("\n")}`);

// ── 2. Dynamic: what is stored ──────────────────────────────────────────
{
  const n = "+15550100123";
  assert.equal(piiHash(n), piiHash("+1 555-010-0123"), "hash is format-independent");
  assert.equal(piiHash("Ana@Example.com"), piiHash("ana@example.com"));
  assert.match(piiHash(n), /^[0-9a-f]{12}$/);
  assert.equal(last4(n), "0123");
  assert.equal(maskPii(`from ${n} by ana@example.com`), "from …0123 by [email]");
  assert.deepEqual(callerFields(""), {});
  assert.deepEqual(callerFields(n), { fromHash: piiHash(n), fromLast4: "0123" });
  assert.deepEqual(emailFields("ana@example.com"), { emailHash: piiHash("ana@example.com") });
}

// Shapes of the web call sites (before this PR) and of the worker's posts.
const RAW: Array<[string, { message: string; metadata?: Record<string, unknown> }]> = [
  ["call_received", { message: "Appel reçu de +15550100123 pour owner@example.com", metadata: { fromNumber: "+15550100123", toNumber: "+15550100999", callId: "c1" } }],
  ["login_failed", { message: "Login refusé — email inconnu (ana@example.com)", metadata: { email: "ana@example.com" } }],
  ["whatsapp_sent_owner", { message: "WhatsApp envoyé au proprio whatsapp:+15550100777", metadata: { to: "whatsapp:+15550100777", sid: "SM1" } }],
  ["book_failed", { message: "Réservation refusée", metadata: { name: "Ana", phone: "+1 555 010 0123", date: "2026-11-20" } }],
  ["campaign_call_progress", { message: "Sonne — +15550100456 (3s)", metadata: { campaignId: "k", contactId: "x" } }],
  ["worker call_ended", { message: "Appel terminé · 4 entries · from=+15550100123 to=+15550100999", metadata: { fromNumber: "+15550100123", toNumber: "+15550100999" } }],
  ["worker call_started", { message: "Session démarrée — SIP +15550100999", metadata: { origin: { kind: "sip", calledNumber: "+15550100999", channel: "pstn" }, roomName: "r" } }],
  ["worker chatctx_snapshot", { message: "ChatCtx", metadata: { fromNumber: "+15550100123", toNumber: "+15550100999", callerHintBlock: "Caller +15550100123, ana@example.com", toolsRegistered: ["book_appointment"] } }],
  ["error text", { message: "Envoi échoué", metadata: { error: "Twilio 21211: invalid 'To' +15550100123" } }],
];
for (const [label, ev] of RAW) assertClean(label, eventForStorage(ev));
{
  const s = eventForStorage(RAW[0][1]);
  assert.equal(s.metadata["toNumber"], "+15550100999", "the tenant line stays: logger.ts and the Calls join read it");
  assert.equal(s.metadata["fromHash"], piiHash("+15550100123"));
  assert.equal(s.metadata["fromLast4"], "0123");
  assert.equal(s.metadata["callId"], "c1");
  assert.ok(!("fromNumber" in s.metadata));
  const started = eventForStorage(RAW[6][1]).metadata["origin"] as Record<string, unknown>;
  assert.equal(started["calledNumber"], "+15550100999", "origin.calledNumber stays (tenant resolution)");
  assert.equal(eventForStorage(RAW[3][1]).metadata["date"], "2026-11-20", "non-PII values untouched");
  assert.equal(eventForStorage({ message: "Usage 1200 in / 300 out · $0.0123" }).message, "Usage 1200 in / 300 out · $0.0123");
}

// The call_received builder used by /api/calls/end.
{
  const ev = callReceivedEvent({ fromNumber: "+15550100123", toNumber: "+15550100999", callId: "c1" });
  assertClean("callReceivedEvent", ev);
  assert.equal(ev.metadata.toNumber, "+15550100999");
  assert.equal(ev.metadata.fromLast4, "0123");
  const web = callReceivedEvent({ fromNumber: "", toNumber: "", callId: "c2" });
  assert.equal(web.metadata.toNumber, "", "web session: empty toNumber is kept (lib/calls/query.ts excludes it)");
  assert.ok(!("fromHash" in web.metadata));
}

// ── 3. Readers on the new shape ─────────────────────────────────────────
{
  // A raw room-name call id holding the caller's number is stored as its
  // sha256/16: the Calls join still ties the event to its call.
  const room = "call-_+15550100123_AbCd";
  const stored = eventForStorage({ message: "Transfer", metadata: { callId: room, roomName: room, ok: true } });
  assertClean("raw room-name callId", stored);
  assert.equal(stored.metadata["callId"], hashCallId(room));
  assert.equal(stored.metadata["roomName"], "call-_…0123_AbCd", "room name masked, prefix kept for the inbound filter");
  const e: JoinEvent = { id: "t1", userId: "u1", event: "call_transfer", createdAt: new Date("2026-11-01T10:00:00Z"), metadata: stored.metadata };
  const joined = attachEvents([{ id: "c9", userId: "u1", callId: room, createdAt: new Date("2026-11-01T10:00:05Z"), durationSeconds: 60 }], [e]);
  assert.ok(joined.get("c9")?.some((x) => x.id === "t1"), "hashed call id joins the raw-id call");
}
{
  // Calls page join: call_received is attached by callId (stamped with calls.id).
  const stored = eventForStorage(RAW[0][1]);
  const e: JoinEvent = { id: "e1", userId: "u1", event: "call_received", createdAt: new Date("2026-11-01T10:00:00Z"), metadata: stored.metadata };
  const joined = attachEvents([{ id: "c1", userId: "u1", callId: "room-1", createdAt: new Date("2026-11-01T10:00:05Z"), durationSeconds: 60 }], [e]);
  assert.ok(joined.get("c1")?.some((x) => x.id === "e1"), "call_received still joins its call");
}
{
  // Monitoring (logs-view groupEventsByCall): the SIP label is built from
  // metadata.toNumber and (optionally) a caller field. With fromNumber gone the
  // label becomes "SIP <tenant line>"; fromLast4 is there for a masked caller.
  const m = eventForStorage(RAW[0][1]).metadata;
  const to = m["toNumber"] as string | undefined;
  const from = m["fromNumber"] as string | undefined;
  assert.equal(`SIP ${from ? `${from} → ` : ""}${to}`, "SIP +15550100999");
  assert.equal(`SIP …${m["fromLast4"]} → ${to}`, "SIP …0123 → +15550100999");
}

// The real logEvent(): no DATABASE_URL → insert fails (caught); the stdout
// mirror prints exactly what would be stored.
async function realLogEvent() {
  delete process.env.DATABASE_URL;
  const { logEvent } = await import("../../lib/logger");
  const printed: unknown[][] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => void printed.push(a);
  console.warn = (...a: unknown[]) => void printed.push(a);
  console.error = () => {};
  try {
    for (const [label, ev] of RAW) {
      await logEvent({ source: "agent", event: label.replace(/\W/g, "_"), userId: "u1", level: "warn", ...ev });
    }
  } finally {
    Object.assign(console, orig);
  }
  assert.equal(printed.length, RAW.length);
  for (const [i, [, message, metadata]] of printed.entries()) {
    assertClean(`logEvent ${RAW[i][0]}`, { message: String(message), metadata });
  }
}

realLogEvent().then(
  () => console.log(`events-no-pii: ${callSites} call sites scanned in ${scan.files.length} files, ${RAW.length} shapes stored clean`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
