// Engine language table (lib/engine-languages.ts, lib/engine-languages-storage.ts,
// /api/admin/engine-languages): the VP defaults, engineSpeaks (unknown = not
// supported), the strict parser, the stored-row fallback (absent → defaults,
// invalid → defaults + alert), the admin write helper fed the RAW body (the
// four gate cases), the edit-log event (who + before/after, no PII), and
// static guards on the route. Mock data only.
// Run with:  npx tsx scripts/tests/engine-languages.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANY_MODEL,
  DEFAULT_ENGINE_LANGUAGES,
  defaultEngineLanguages,
  engineLanguagesFor,
  engineLanguagesFromStored,
  engineLanguagesWrite,
  engineSpeaks,
  parseEngineLanguages,
  type EngineLanguages,
} from "../../lib/engine-languages";
import { engineLanguagesEditEvent, getEngineLanguages } from "../../lib/engine-languages-storage";
import { eventForStorage } from "../../lib/event-pii";
import { EMAIL_RE, PHONE_RE } from "../../lib/pii-mask";
import { SETTING_KEYS } from "../../lib/settings";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const clone = <T>(x: T): T => structuredClone(x);
const ADMIN = "00000000-0000-0000-0000-00000000ad01";

async function main() {
  // ── Defaults = the VP decision ──────────────────────────────────────────
  assert.equal(SETTING_KEYS.ENGINE_LANGUAGES, "engine_languages_v1");
  assert.deepEqual(DEFAULT_ENGINE_LANGUAGES, {
    openai: { "*": ["fr", "en", "he"] },
    gemini: { "*": ["fr", "en"] },
    xai: { "*": ["fr", "en"] },
  });
  const copy = defaultEngineLanguages();
  copy.openai["*"]!.push("de");
  assert.deepEqual(DEFAULT_ENGINE_LANGUAGES.openai["*"], ["fr", "en", "he"], "defaultEngineLanguages returns a copy");
  console.log("ok: defaults (openai fr/en/he, gemini fr/en, xai fr/en)");

  // ── engineSpeaks: a full table ──────────────────────────────────────────
  const D = DEFAULT_ENGINE_LANGUAGES;
  const table: Array<[string, string | null, unknown, boolean]> = [
    ["openai", null, "fr", true],
    ["openai", null, "en", true],
    ["openai", null, "he", true],
    ["openai", "gpt-realtime-2.1", "he", true], // no model entry → "*"
    ["openai", null, "de", false], // not listed = not supported
    ["gemini", null, "fr", true],
    ["gemini", null, "en", true],
    ["gemini", "gemini-3.8-live", "he", false], // unknown → not supported
    ["xai", null, "fr", true],
    ["xai", null, "en", true],
    ["xai", "grok-voice-3.0", "he", false],
    ["openai", null, " FR ", true], // trimmed + lowercased
    ["mystery", null, "fr", false], // unknown engine
    ["openai", null, "", false],
    ["openai", null, "fra", false],
    ["openai", null, null, false],
    ["openai", null, undefined, false],
    ["openai", null, 1, false],
  ];
  for (const [e, m, l, want] of table) assert.equal(engineSpeaks(e, m, l, D), want, `engineSpeaks(${e}, ${m}, ${JSON.stringify(l)})`);
  // A per-model entry replaces "*" for that model only.
  const perModel: EngineLanguages = clone(D);
  perModel.openai["gpt-realtime-mini"] = ["en"];
  perModel.gemini["gemini-3.8-live"] = ["fr", "en", "he"];
  assert.equal(engineSpeaks("openai", "gpt-realtime-mini", "fr", perModel), false);
  assert.equal(engineSpeaks("openai", "gpt-realtime-mini", "en", perModel), true);
  assert.equal(engineSpeaks("openai", "gpt-realtime-2", "fr", perModel), true, "other models keep *");
  assert.equal(engineSpeaks("gemini", "gemini-3.8-live", "he", perModel), true);
  assert.equal(engineSpeaks("gemini", "gemini-other", "he", perModel), false);
  assert.deepEqual(engineLanguagesFor("xai", null, D), ["fr", "en"]);
  assert.deepEqual(engineLanguagesFor("nope", null, D), []);
  // An engine entry missing from a (hand-built) table → nothing spoken.
  assert.equal(engineSpeaks("xai", null, "fr", { openai: D.openai } as unknown as EngineLanguages), false);
  console.log("ok: engineSpeaks table (unknown = false, per-model entry replaces *)");

  // ── Strict parser ───────────────────────────────────────────────────────
  assert.deepEqual(parseEngineLanguages(clone(D)), D);
  assert.deepEqual(parseEngineLanguages(clone(perModel)), perModel);
  type Loose = Record<string, Record<string, unknown> | unknown>;
  const mutations: Array<[string, (t: Loose) => void]> = [
    ["missing engine", (t) => delete t.xai],
    ["unknown engine", (t) => (t.mistral = { "*": ["fr"] })],
    ["missing *", (t) => (t.gemini = { "gemini-3.8-live": ["fr"] })],
    ["engine is an array", (t) => (t.openai = [])],
    ["engine is null", (t) => (t.openai = null)],
    ["list not an array", (t) => (t.openai = { "*": "fr" })],
    ["uppercase code", (t) => (t.openai = { "*": ["FR"] })],
    ["3-letter code", (t) => (t.openai = { "*": ["fra"] })],
    ["duplicate code", (t) => (t.openai = { "*": ["fr", "fr"] })],
    ["non-string code", (t) => (t.openai = { "*": [1] })],
    ["bad model key", (t) => (t.openai = { "*": ["fr"], "bad model!": ["fr"] })],
  ];
  for (const [name, mutate] of mutations) {
    const t = clone(D) as unknown as Loose;
    mutate(t);
    assert.equal(parseEngineLanguages(t), null, `parse refuses: ${name}`);
  }
  for (const bad of [null, undefined, "x", 1, [], {}]) assert.equal(parseEngineLanguages(bad), null);
  // An empty list is valid (an engine that speaks nothing).
  assert.ok(parseEngineLanguages({ ...clone(D), xai: { "*": [] } }));
  console.log("ok: strict parser");

  // ── Stored row → table, invalid → defaults + alert ──────────────────────
  assert.deepEqual(engineLanguagesFromStored(null), { languages: D, source: "default" });
  assert.deepEqual(engineLanguagesFromStored(JSON.stringify(perModel)), { languages: perModel, source: "stored" });
  for (const raw of ["", "{", "null", "[]", JSON.stringify({ openai: D.openai })]) {
    assert.deepEqual(engineLanguagesFromStored(raw), { languages: D, source: "invalid" }, `invalid row ${raw} → defaults`);
  }
  let alerts = 0;
  const deps = (raw: string | null) => ({ read: async () => raw, onInvalid: () => void alerts++ });
  assert.deepEqual(await getEngineLanguages(deps(null)), D);
  assert.deepEqual(await getEngineLanguages(deps(JSON.stringify(perModel))), perModel);
  assert.equal(alerts, 0, "absent / valid rows never alert");
  assert.deepEqual(await getEngineLanguages(deps("{oops")), D);
  assert.deepEqual(await getEngineLanguages(deps(JSON.stringify({ openai: 1 }))), D);
  assert.equal(alerts, 2, "an invalid row falls back AND alerts");
  console.log("ok: stored row fallback + alert");

  // ── Admin write helper, fed the RAW body: the four gate cases ───────────
  const stored = perModel;
  // Case 1 — other fields pass: editing xai leaves every other entry as stored.
  {
    const w = engineLanguagesWrite(stored, { languages: { xai: { "*": ["fr", "en", "es"] } } });
    assert.ok(w.ok && w.changed);
    const want = clone(stored);
    want.xai["*"] = ["fr", "en", "es"];
    assert.deepEqual(w.ok && w.value, want);
    assert.deepEqual(w.ok && w.changes, [{ engine: "xai", model: "*", before: ["fr", "en"], after: ["fr", "en", "es"] }]);
    assert.deepEqual(stored.xai["*"], ["fr", "en"], "the stored value is never mutated");
  }
  // Case 2 — an unchanged re-send passes, changed=false, no change logged.
  assert.deepEqual(engineLanguagesWrite(stored, { languages: clone(stored) }), { ok: true, value: stored, changed: false, changes: [] });
  // Case 3 — a change is refused when invalid (every path named, nothing
  // written); a non-admin never reaches the helper (static guard below: 403).
  assert.deepEqual(
    engineLanguagesWrite(stored, {
      languages: {
        mistral: { "*": ["fr"] },
        openai: { "*": ["FR"], "gpt-realtime-mini": null, "bad key!": ["fr"] },
        gemini: { "*": null },
        xai: "fr",
      },
      extra: 1,
    }),
    {
      ok: false,
      error: "invalid_engine_languages",
      fields: ["extra", "languages.mistral", "languages.openai.*", "languages.openai.bad key!", "languages.gemini.*", "languages.xai"],
    },
  );
  for (const body of [null, "x", [], 3]) assert.equal(engineLanguagesWrite(stored, body).ok, false, `body ${JSON.stringify(body)} refused`);
  assert.equal(engineLanguagesWrite(stored, { languages: "x" }).ok, false);
  // Case 4 — OMITTED = unchanged (empty body, no languages key, empty patches).
  for (const body of [{}, { languages: {} }, { languages: { openai: {} } }]) {
    assert.deepEqual(engineLanguagesWrite(stored, body), { ok: true, value: stored, changed: false, changes: [] }, `omitted: ${JSON.stringify(body)}`);
  }
  // A partial write of one model keeps the engine's other entries.
  {
    const w = engineLanguagesWrite(stored, { languages: { openai: { "gpt-realtime-2.1": ["fr"] } } });
    assert.ok(w.ok);
    assert.deepEqual(w.ok && w.value.openai, { "*": ["fr", "en", "he"], "gpt-realtime-mini": ["en"], "gpt-realtime-2.1": ["fr"] });
    assert.deepEqual(w.ok && w.changes, [{ engine: "openai", model: "gpt-realtime-2.1", before: null, after: ["fr"] }]);
  }
  // null removes a per-model entry (logged before → null); removing an absent one is no change.
  {
    const w = engineLanguagesWrite(stored, { languages: { openai: { "gpt-realtime-mini": null, "gpt-absent": null } } });
    assert.ok(w.ok && w.changed);
    assert.deepEqual(w.ok && w.value.openai, { "*": ["fr", "en", "he"] });
    assert.deepEqual(w.ok && w.changes, [{ engine: "openai", model: "gpt-realtime-mini", before: ["en"], after: null }]);
  }
  // Every accepted write still passes the strict parser.
  {
    const w = engineLanguagesWrite(stored, { languages: { gemini: { "*": ["fr", "en", "he"] } } });
    assert.ok(w.ok && parseEngineLanguages(w.value));
  }
  console.log("ok: admin write helper (4 gate cases: others pass, re-send, invalid named, omitted = unchanged)");

  // ── Edit-log event: who + what (before/after), no PII ───────────────────
  {
    const w = engineLanguagesWrite(stored, { languages: { gemini: { "*": ["fr", "en", "he"] } } });
    assert.ok(w.ok);
    const ev = engineLanguagesEditEvent(ADMIN, w.ok ? w.changes : []);
    assert.deepEqual(ev, {
      source: "web",
      event: "admin_engine_languages_updated",
      message: `Admin ${ADMIN} edited engine_languages (1 entry)`,
      userId: ADMIN,
      metadata: {
        keys: ["engine_languages"],
        adminId: ADMIN,
        changes: [{ engine: "gemini", model: "*", before: ["fr", "en"], after: ["fr", "en", "he"] }],
      },
    });
    const text = JSON.stringify(ev);
    assert.equal(text.match(EMAIL_RE), null, "no email address");
    assert.equal(text.match(PHONE_RE), null, "no phone number");
    assert.deepEqual(Object.keys(ev.metadata).sort(), ["adminId", "changes", "keys"], "only ids and language lists");
    // The stored copy (what logEvent inserts) is the event unchanged: nothing to mask.
    const storedEv = eventForStorage({ message: ev.message, metadata: ev.metadata });
    assert.deepEqual(storedEv.metadata, ev.metadata);
    assert.equal(storedEv.message, ev.message);
  }
  console.log("ok: edit-log event (admin id + before/after lists, no PII)");

  // ── Static guards on the route ──────────────────────────────────────────
  const route = code("app/api/admin/engine-languages/route.ts");
  for (const m of ["GET", "PUT"]) {
    const body = route.slice(route.indexOf(`export async function ${m}`));
    assert.match(body.slice(0, 200), /const guard = await requireAdmin\(\);\s*if \(!guard\.ok\) return guard\.response;/, `${m} is admin-only first`);
  }
  assert.match(route, /engineLanguagesWrite\(stored, body\)/, "PUT goes through the raw-body helper");
  assert.match(route, /if \(w\.changed\) \{\s*await setEngineLanguages\(w\.value\);\s*await logEvent\(engineLanguagesEditEvent\(guard\.admin\.id, w\.changes\)\);/, "every change is written then logged");
  assert.match(route, /status: 400/);
  // Nothing on the call path reads the table yet (E2 wires it).
  for (const f of ["app/api/agent/session-config/route.ts", "app/api/agent/config/route.ts", "lib/voice/engine.ts"]) {
    assert.doesNotMatch(code(f), /engine-languages|engine-resolve/, `${f} does not read the table yet`);
  }
  assert.equal(ANY_MODEL, "*");

  console.log("ALL ENGINE-LANGUAGES TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
