// Connectors B4, the pure parts: the CONNECTORS_WRITE switch per value, the
// body validators (create / patch, omitted = absent, the number not
// editable, no client secret), the legacy materialization rule and the
// conversion flag the GET exposes, the generated secret's format, and
// source guards (the routes gate first; the secret is only ever returned as
// generatedSecret; no secret / url in event metadata). Mock data only.
// Run with:  npx tsx scripts/tests/connectors-write.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { legacyConversionView, legacyMaterialization } from "../../lib/connectors/materialize";
import { isConnectorUuid, parseConnectorCreate, parseConnectorPatch } from "../../lib/connectors/validate";
import { CONNECTORS_WRITE_OFF, connectorsWriteAllowed, connectorsWriteMode } from "../../lib/connectors/write-switch";

const ROOT = new URL("../../", import.meta.url).pathname;
const src = (f: string) => readFileSync(join(ROOT, f), "utf8");

// ── The switch ──────────────────────────────────────────────────────────
const modeTable: Array<[string | undefined, string]> = [
  [undefined, "off"],
  ["", "off"],
  ["off", "off"],
  ["all", "off"],
  ["true", "off"],
  ["admin", "admin"],
  [" ADMIN ", "admin"],
  ["on", "on"],
  ["On", "on"],
];
for (const [v, want] of modeTable) assert.equal(connectorsWriteMode(v === undefined ? {} : { CONNECTORS_WRITE: v }), want, `CONNECTORS_WRITE=${v}`);
assert.equal(connectorsWriteAllowed("off", true), false, "off refuses even an admin");
assert.equal(connectorsWriteAllowed("off", false), false);
assert.equal(connectorsWriteAllowed("admin", true), true, "admin mode: an admin session writes");
assert.equal(connectorsWriteAllowed("admin", false), false, "admin mode: a tenant is refused");
assert.equal(connectorsWriteAllowed("on", false), true, "on: every account");
assert.deepEqual(CONNECTORS_WRITE_OFF, { status: 404, body: { error: "connectors_write_off" } });
console.log(`ok: switch (${modeTable.length} values)`);

// ── Validators ──────────────────────────────────────────────────────────
const NUM = "00000000-0000-4000-8000-000000000501";
const good = { name: " Sales bot ", url: " https://agent.example.com/hook ", mode: "lead", phoneNumberId: NUM };
assert.deepEqual(parseConnectorCreate(good), {
  ok: true,
  value: { name: "Sales bot", url: "https://agent.example.com/hook", mode: "lead", phoneNumberId: NUM, enabled: true, acknowledgeLegacyConversion: false },
}, "enabled defaults true; voiceConfig absent stays absent");
const withVoice = parseConnectorCreate({ ...good, voiceConfig: null, enabled: false, acknowledgeLegacyConversion: true });
assert.ok(withVoice.ok && withVoice.value.voiceConfig === null && withVoice.value.enabled === false && withVoice.value.acknowledgeLegacyConversion);
const createBad: Array<[string, unknown, string[]]> = [
  ["not an object", [], []],
  ["missing everything", {}, ["name", "url", "mode", "phoneNumberId"]],
  ["empty name", { ...good, name: "  " }, ["name"]],
  ["long name", { ...good, name: "x".repeat(81) }, ["name"]],
  ["empty url", { ...good, url: "" }, ["url"]],
  ["bad mode", { ...good, mode: "chat" }, ["mode"]],
  ["bad number id", { ...good, phoneNumberId: "+15550000501" }, ["phoneNumberId"]],
  ["client secret refused", { ...good, secret: "mock" }, ["secret"]],
  ["voice not an object", { ...good, voiceConfig: "alloy" }, ["voiceConfig"]],
  ["enabled not boolean", { ...good, enabled: "yes" }, ["enabled"]],
  ["ack not boolean", { ...good, acknowledgeLegacyConversion: 1 }, ["acknowledgeLegacyConversion"]],
];
for (const [label, body, fields] of createBad) {
  const r = parseConnectorCreate(body);
  assert.ok(!r.ok, label);
  assert.equal(r.error, "invalid_body", label);
  assert.deepEqual(r.fields, fields, label);
}
assert.deepEqual(parseConnectorPatch({}), { ok: true, value: { rotateSecret: false, acknowledgeLegacyConversion: false } }, "empty patch: every field omitted");
assert.deepEqual(parseConnectorPatch({ name: "B", enabled: false, rotateSecret: true }), {
  ok: true,
  value: { name: "B", enabled: false, rotateSecret: true, acknowledgeLegacyConversion: false },
}, "only the present fields");
const vNull = parseConnectorPatch({ voiceConfig: null });
assert.ok(vNull.ok && "voiceConfig" in vNull.value && vNull.value.voiceConfig === null, "voiceConfig: null = back to the account voice (present)");
assert.deepEqual(parseConnectorPatch({ phoneNumberId: NUM }), { ok: false, error: "number_not_editable", fields: ["phoneNumberId"] });
const patchBad: Array<[string, unknown, string[]]> = [
  ["unknown key", { secret: "x" }, ["secret"]],
  ["empty name", { name: "" }, ["name"]],
  ["empty url", { url: " " }, ["url"]],
  ["bad mode", { mode: 1 }, ["mode"]],
  ["rotate not boolean", { rotateSecret: "yes" }, ["rotateSecret"]],
];
for (const [label, body, fields] of patchBad) {
  const r = parseConnectorPatch(body);
  assert.ok(!r.ok && r.error === "invalid_body", label);
  assert.deepEqual(!r.ok && r.fields, fields, label);
}
assert.equal(isConnectorUuid(NUM), true);
assert.equal(isConnectorUuid("legacy"), false);
console.log(`ok: validators (${createBad.length + patchBad.length + 6} cases)`);

// ── The legacy materialization rule (pure) ──────────────────────────────
const tools = (enabled: boolean, url: string, secret: string | null, mode = "voice") => ({
  version: 1,
  booking: { enabled: true, defaultDurationMinutes: null, minNoticeMinutes: null },
  contacts: { enabled: true },
  transfer: { enabled: false, when: "always" },
  orders: { enabled: false, ask: "" },
  clientAgent: { enabled, url, mode, secret },
});
const MAIN = { id: NUM, phoneNumber: "+15550000501" };
const SEALED = "enc:v1:k1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA";
assert.deepEqual(legacyMaterialization({ connectorRowCount: 0, toolsConfig: tools(true, "https://agent.example.com/hook", SEALED), mainNumber: MAIN }), {
  name: "",
  url: "https://agent.example.com/hook",
  mode: "voice",
  secret: SEALED,
  voiceConfig: null,
  enabled: true,
  phoneNumberId: NUM,
}, "zero rows + enabled legacy → the row: url / mode / secret as stored, account voice, main number");
assert.equal(legacyMaterialization({ connectorRowCount: 0, toolsConfig: tools(true, "https://agent.example.com/hook", null), mainNumber: null })?.phoneNumberId, null, "no number → null");
const none: Array<[string, Parameters<typeof legacyMaterialization>[0]]> = [
  ["rows exist", { connectorRowCount: 1, toolsConfig: tools(true, "https://agent.example.com/hook", null), mainNumber: MAIN }],
  ["legacy off", { connectorRowCount: 0, toolsConfig: tools(false, "https://agent.example.com/hook", null), mainNumber: MAIN }],
  ["no url", { connectorRowCount: 0, toolsConfig: tools(true, "", null), mainNumber: MAIN }],
  ["never written", { connectorRowCount: 0, toolsConfig: null, mainNumber: MAIN }],
  ["unparseable", { connectorRowCount: 0, toolsConfig: { nope: true }, mainNumber: MAIN }],
];
for (const [label, input] of none) {
  assert.equal(legacyMaterialization(input), null, label);
  assert.deepEqual(legacyConversionView(input), { willConvert: false, numberE164: null }, label);
}
assert.deepEqual(
  legacyConversionView({ connectorRowCount: 0, toolsConfig: tools(true, "https://agent.example.com/hook", null), mainNumber: MAIN }),
  { willConvert: true, numberE164: "+15550000501" },
);
console.log(`ok: legacy materialization (${none.length + 3} cases)`);

// ── Source guards ───────────────────────────────────────────────────────
const write = src("lib/connectors/write.ts");
assert.match(write, /export const generateConnectorSecret = generateClientAgentSecret;/, "the secret is #437's generator (32 random bytes)");
assert.match(write, /secret: sealForStorage\(secret\)/, "a generated secret is stored sealed");
assert.equal((write.match(/generatedSecret: secret/g) ?? []).length, 2, "generatedSecret is returned by create and rotate only");
assert.equal([...write.matchAll(/metadata: \{([^\n]*)\},?\n/g)].length, 4, "every event's metadata is checked");
for (const m of write.matchAll(/metadata: \{([^\n]*)\},?\n/g)) {
  // The url only ever reaches metadata as its host name (safeHost).
  const rest = m[1].replace(/safeHost\([\w.]+\)/g, "").replace(/patch\.url !== undefined/g, "");
  assert.doesNotMatch(rest, /\bsecret\b|\burl\b/, `no secret or url in event metadata: ${m[1]}`);
}
assert.doesNotMatch(write, /\.select\(\)/, "explicit picks only");
for (const r of ["app/api/dashboard/connectors/[id]/route.ts", "app/api/dashboard/connectors/[id]/test/route.ts"]) {
  const s = src(r);
  for (const fn of s.matchAll(/export async function (\w+)\([^)]*\) \{\n {2}const gate = await connectorsWriteGate\(req\);\n {2}if \(!gate\.ok\) return gate\.response;/g)) assert.ok(fn[1]);
  assert.equal((s.match(/export async function/g) ?? []).length, (s.match(/const gate = await connectorsWriteGate\(req\);\n {2}if \(!gate\.ok\) return gate\.response;/g) ?? []).length, `${r}: every handler gates first`);
}
assert.doesNotMatch(src("app/api/dashboard/connectors/[id]/route.ts"), /export async function DELETE/, "no DELETE in B4 (the soft delete lands in its own PR)");
assert.doesNotMatch(write, /tx\.delete\(|db\.delete\(/, "B4 deletes no row");
const root = src("app/api/dashboard/connectors/route.ts");
assert.match(root, /export async function POST\(req: NextRequest\) \{\n {2}const gate = await connectorsWriteGate\(req\);/, "POST gates first");
assert.doesNotMatch(root.split("export async function POST")[0], /connectorsWriteGate\(/, "the GET is not gated by the switch");
console.log("ok: source guards");

console.log("\nALL CONNECTORS WRITE TESTS PASSED");
