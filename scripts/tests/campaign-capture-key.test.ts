// Campaign "fields to capture" editor: the technical key is hidden for
// tenants (label only) and derived from the label for NEW fields; a stored
// key never changes. The key input is level 3 (developer mode or admin).
// Renders the REAL component to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/campaign-capture-key.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignSetupStep } from "../../app/[locale]/dashboard/campaigns/campaign-setup-step";
import { CaptureFieldsEditorGate } from "../../app/[locale]/dashboard/campaigns/capture-fields-editor";
import {
  CAPTURE_KEY_SLUG_MAX,
  MAX_CAPTURE_FIELDS,
  captureKeyRenamed,
  isTooManyCaptureFields,
  storedCaptureFields,
  unlabeledCaptureRows,
  addCaptureField,
  deriveCaptureKey,
  removeCaptureField,
  setCaptureLabel,
  slugifyCaptureKey,
  storedCaptureKeys,
} from "../../lib/campaigns/capture-editor";
import { DEFAULT_CALL_WINDOW, DEFAULT_CONCURRENCY, DEFAULT_RETRY_RULES, type ExtractionField } from "../../lib/campaigns/constants";
import { snapshot } from "../../lib/campaigns/edit-guard";
import type { CampaignDraft } from "../../lib/campaigns/types";
import { normalizeExtractionSchema } from "../../lib/campaigns/validate";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html(el: ReactElement, locale = "fr") {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, el),
  );
}

const STORED: ExtractionField[] = [
  { key: "budget", label: "Budget", type: "number" },
  { key: "field_2", label: "תקציב", type: "string", required: true },
  { key: "decision", label: "Décision", type: "enum", options: ["oui", "non"] },
];

const editor = (o: { isAdmin?: boolean; developerMode?: boolean; schema?: ExtractionField[] } = {}, locale = "fr") =>
  html(
    createElement(CaptureFieldsEditorGate, {
      schema: o.schema ?? STORED,
      onChange: () => {},
      captureOn: true,
      isAdmin: o.isAdmin ?? false,
      developerMode: o.developerMode ?? false,
    }),
    locale,
  );
const keyInputs = (s: string) => s.match(/<input[^>]*data-capture-key[^>]*>/g) ?? [];

// 1. A tenant sees the label and type only; developer mode or admin shows the key.
for (const l of LOCALES) {
  const keyWord = esc(messages(l).DashboardCampaigns.extractionKey);
  const tenant = editor({}, l);
  assert.equal(keyInputs(tenant).length, 0, `${l}: tenant: no key input`);
  assert.ok(!tenant.includes(`aria-label="${keyWord}"`), `${l}: tenant: no key label`);
  assert.ok(!tenant.includes('value="budget"'), `${l}: tenant: the key never reaches the DOM`);
  assert.ok(tenant.includes('value="Budget"'), `${l}: tenant: label shown`);
  assert.equal((tenant.match(/<select/g) ?? []).length, 3, `${l}: tenant: type shown`);

  for (const o of [{ developerMode: true }, { isAdmin: true }, { isAdmin: true, developerMode: true }]) {
    const out = editor(o, l);
    const inputs = keyInputs(out);
    assert.equal(inputs.length, 3, `${l} ${JSON.stringify(o)}: one key input per row`);
    assert.match(inputs[0], /value="budget"/);
    assert.match(inputs[0], new RegExp(`aria-label="${keyWord}"`));
    assert.match(inputs[0], /dir="ltr"/, `${l}: the ASCII key stays LTR in RTL`);
    assert.match(inputs[0], /min-h-11/, `${l}: 44 px touch target`);
  }
}
// The real component (store-backed): developer mode is unknown on the server → off.
{
  const draft: CampaignDraft = {
    id: undefined,
    name: "Mock campaign",
    goalPreset: "custom",
    objective: "Mock objective",
    fromNumber: "",
    agentId: null,
    successCriteria: "",
    extractionSchema: STORED,
    concurrency: DEFAULT_CONCURRENCY,
    retryRules: { ...DEFAULT_RETRY_RULES },
    callWindow: { ...DEFAULT_CALL_WINDOW },
  };
  const setup = (isAdmin: boolean) =>
    html(createElement(CampaignSetupStep, { draft, onChange: () => {}, agents: [], fromNumbers: [], isAdmin, captureOn: true }));
  assert.equal(keyInputs(setup(false)).length, 0, "tenant via the setup step: no key");
  assert.equal(keyInputs(setup(true)).length, 3, "admin via the setup step: keys");
  const src = read("app/[locale]/dashboard/campaigns/capture-fields-editor.tsx");
  assert.match(src, /showLevel3\(\{ isAdmin, developerMode \}\)/, "same gate as AgentUrlCard / ApiKeyCard");
  assert.match(src, /useDeveloperMode\(\)/);
}

// 2. Derivation: Latin, accents, Hebrew → field_N, collisions, length.
{
  const none = new Set<string>();
  assert.equal(slugifyCaptureKey("Budget"), "budget");
  assert.equal(slugifyCaptureKey("  Budget max (€) "), "budget_max");
  assert.equal(slugifyCaptureKey("Date de rappel souhaitée"), "date_de_rappel_souhaitee");
  assert.equal(slugifyCaptureKey("Électricité / Ça va ?"), "electricite_ca_va");
  assert.equal(slugifyCaptureKey("Nombre d'œuvres"), "nombre_d_oeuvres", "ligature œ → oe");
  assert.equal(slugifyCaptureKey("Straße Ærø"), "strasse_aero");
  assert.equal(slugifyCaptureKey("תקציב"), "");
  assert.equal(slugifyCaptureKey("Budget תקציב"), "budget");
  assert.equal(slugifyCaptureKey("x".repeat(80)).length, CAPTURE_KEY_SLUG_MAX);
  assert.ok(!slugifyCaptureKey(`${"a".repeat(39)} b`).endsWith("_"), "no trailing underscore after the cut");

  assert.equal(deriveCaptureKey("Budget", 0, none), "budget");
  assert.equal(deriveCaptureKey("", 0, none), "", "empty label: empty key (blank row)");
  assert.equal(deriveCaptureKey("   ", 0, none), "");
  assert.equal(deriveCaptureKey("תקציב", 2, none), "field_3", "Hebrew: field_N from the position");
  assert.equal(deriveCaptureKey("预算", 0, none), "field_1", "non-Latin: field_N");
  assert.equal(deriveCaptureKey("€€", 4, none), "field_5", "symbols only: field_N");
  assert.equal(deriveCaptureKey("תקציב", 2, new Set(["field_3", "field_4"])), "field_5", "field_N: next free number");
  assert.equal(deriveCaptureKey("Budget", 1, new Set(["budget"])), "budget_2", "collision: _2");
  assert.equal(deriveCaptureKey("Budget", 1, new Set(["budget", "budget_2"])), "budget_3", "collision: _3");

  // Two new fields with the same label get distinct keys.
  let s = addCaptureField(addCaptureField([]));
  s = setCaptureLabel(s, 0, "Budget");
  s = setCaptureLabel(s, 1, "Budget");
  assert.deepEqual(s.map((f) => f.key), ["budget", "budget_2"]);
  // A new field never reuses a stored key, even one whose field was removed.
  let r = removeCaptureField(STORED, 0);
  r = addCaptureField(r);
  r = setCaptureLabel(r, r.length - 1, "Budget", STORED.map((f) => f.key));
  assert.equal(r[r.length - 1].key, "budget_2", "a removed stored key is not reused");
}

// 3. A new field's key follows its label as the tenant types.
{
  let s = addCaptureField([...STORED]);
  const i = s.length - 1;
  const stored = STORED.map((f) => f.key);
  for (const [label, key] of [
    ["B", "b"],
    ["Bu", "bu"],
    ["Budget", "budget_2"],
    ["Budget max", "budget_max"],
    ["", ""],
    ["תאריך", "field_4"],
    ["Date", "date"],
  ] as const) {
    s = setCaptureLabel(s, i, label, stored);
    assert.equal(s[i].label, label);
    assert.equal(s[i].key, key, `"${label}" → "${key}"`);
  }
  // A key typed by hand (developer mode) stops following the label.
  s = s.map((f, idx) => (idx === i ? { ...f, key: "custom_key" } : f));
  s = setCaptureLabel(s, i, "Date of call", stored);
  assert.equal(s[i].key, "custom_key");
  // Other rows untouched by a label edit.
  assert.deepEqual(s.slice(0, 3), STORED);
}

// 4. Existing keys never change on a label edit.
{
  const stored = storedCaptureKeys(snapshot({ name: "Mock", extractionSchema: STORED }));
  assert.deepEqual(stored, ["budget", "field_2", "decision"]);
  let s = [...STORED];
  for (const [i, label] of [
    [0, "Budget annuel"],
    [0, ""],
    [1, "Hebrew label edited תאריך"],
    [2, "Decision"],
  ] as const) {
    s = setCaptureLabel(s, i, label, stored);
    assert.equal(s[i].key, STORED[i].key, `stored key kept on "${label}"`);
    assert.equal(s[i].label, label);
  }
  assert.equal(s[1].required, true, "other properties kept");
  assert.deepEqual(s[2].options, ["oui", "non"]);
  // A stored key that differs from its label's slug: still never re-derived.
  const odd: ExtractionField[] = [{ key: "q1_budget", label: "Budget", type: "string" }];
  assert.equal(setCaptureLabel(odd, 0, "Budget total", ["q1_budget"])[0].key, "q1_budget");
  // Even when it equals the slug of the previous label (the stored list wins).
  assert.equal(setCaptureLabel([{ key: "budget", label: "Budget", type: "string" }], 0, "Prix", ["budget"])[0].key, "budget");
  assert.deepEqual(storedCaptureKeys(null), []);
  assert.deepEqual(storedCaptureKeys("not json"), []);
}

// 5. An untouched schema is byte-identical: rendering never calls onChange,
//    and the stored schema survives the server's own normalization.
{
  const storedJson = JSON.stringify(normalizeExtractionSchema(STORED));
  const loaded: ExtractionField[] = JSON.parse(storedJson);
  let calls = 0;
  for (const o of [{}, { developerMode: true }, { isAdmin: true }]) {
    html(
      createElement(CaptureFieldsEditorGate, {
        schema: loaded,
        onChange: () => {
          calls++;
        },
        captureOn: true,
        isAdmin: false,
        developerMode: false,
        ...o,
      }),
    );
  }
  assert.equal(calls, 0, "no write on render");
  assert.equal(JSON.stringify(loaded), storedJson, "byte-identical");
  assert.equal(JSON.stringify(normalizeExtractionSchema(loaded)), storedJson, "re-save is a no-op");
}

// 6. Derived keys pass the server's normalizeExtractionSchema unchanged.
{
  const labels = [
    "Budget",
    "Budget",
    "Date de rappel souhaitée",
    "תקציב",
    "预算",
    "€€",
    "x".repeat(200),
    "x".repeat(200),
    " Leading and trailing spaces ",
    "Nombre d'employés (2024)",
  ];
  let s: ExtractionField[] = [];
  labels.forEach((label, i) => {
    s = addCaptureField(s);
    s = setCaptureLabel(s, i, label);
  });
  const keys = s.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "unique keys");
  for (const k of keys) {
    assert.match(k, /^[a-z0-9_]+$/, `ASCII key: ${k}`);
    assert.ok(k.length <= 60, `≤ 60: ${k}`);
  }
  const norm = normalizeExtractionSchema(s);
  assert.equal(norm.length, s.length, "none dropped");
  assert.deepEqual(norm.map((f) => f.key), keys, "keys kept as-is by the server");
}

// 7. The hint copy in all 3 locales.
{
  assert.equal(messages("fr").DashboardCampaigns.extractionHint, "Ce que nous relevons de chaque conversation.");
  assert.equal(messages("en").DashboardCampaigns.extractionHint, "What we capture from each conversation.");
  assert.equal(messages("he").DashboardCampaigns.extractionHint, "מה שאנחנו אוספים מכל שיחה.");
  for (const l of LOCALES) {
    const hint = messages(l).DashboardCampaigns.extractionHint;
    assert.ok(editor({}, l).includes(esc(hint)), `${l}: hint rendered`);
    assert.doesNotMatch(hint, /agent|סוכן/i, `${l}: not agent-centred until M3b`);
  }
  assert.match(read("app/[locale]/dashboard/campaigns/capture-fields-editor.tsx"), /M3b/, "the M3b comment is there");
}

// 8. Guard: an unlabeled row blocks the save (pure helper).
{
  const storedFields = storedCaptureFields(snapshot({ name: "Mock", extractionSchema: STORED }));
  assert.deepEqual(storedFields.map((f) => f.key), ["budget", "field_2", "decision"]);
  assert.deepEqual(storedCaptureFields(null), []);
  assert.deepEqual(storedCaptureFields("not json"), []);

  // An untouched schema is never blocked.
  assert.deepEqual(unlabeledCaptureRows(STORED, storedFields), []);
  assert.deepEqual(unlabeledCaptureRows([], []), []);
  // A new row added and never typed in counts as unlabeled.
  const added = addCaptureField([...STORED]);
  assert.deepEqual(unlabeledCaptureRows(added, storedFields), [3]);
  // A row whose label was typed then erased, or is blank.
  let s = setCaptureLabel(added, 3, "Budget", storedFields.map((f) => f.key));
  assert.deepEqual(unlabeledCaptureRows(s, storedFields), [], "labelled: not blocked");
  s = setCaptureLabel(s, 3, "   ", storedFields.map((f) => f.key));
  assert.deepEqual(unlabeledCaptureRows(s, storedFields), [3], "blank label blocks");
  // Clearing a stored row's label blocks too.
  assert.deepEqual(unlabeledCaptureRows(setCaptureLabel([...STORED], 1, ""), storedFields), [1]);
  // A stored item whose stored label is empty: not blocked (it came that way).
  const legacy: ExtractionField[] = [{ key: "legacy_key", label: "", type: "string" }, ...STORED];
  const legacyStored = storedCaptureFields(snapshot({ name: "Mock", extractionSchema: legacy }));
  assert.deepEqual(unlabeledCaptureRows(legacy, legacyStored), [], "stored empty label: not blocked");
  assert.deepEqual(unlabeledCaptureRows(addCaptureField(legacy), legacyStored), [4], "but a new empty row still is");
  // The server would have kept it with the key as its label.
  assert.equal(normalizeExtractionSchema(legacy)[0].label, "legacy_key");
}

// 9. The marked row and its line render with the aria wiring.
for (const l of LOCALES) {
  const schema = addCaptureField([...STORED]);
  const render = (saveCheck: number) =>
    html(
      createElement(CaptureFieldsEditorGate, {
        schema,
        onChange: () => {},
        captureOn: true,
        isAdmin: false,
        developerMode: false,
        storedKeys: STORED.map((f) => f.key),
        storedFields: STORED.map(({ key, label }) => ({ key, label })),
        saveCheck,
      }),
      l,
    );
  const line = esc(messages(l).DashboardCampaigns.extractionUnlabeled);
  const before = render(0);
  assert.ok(!before.includes("aria-invalid"), `${l}: no mark before a save attempt`);
  assert.ok(!before.includes(line), `${l}: no line before a save attempt`);

  const out = render(1);
  const labels = out.match(/<input[^>]*data-capture-label[^>]*>/g) ?? [];
  assert.equal(labels.length, 4);
  const marked = labels.filter((x) => /aria-invalid="true"/.test(x));
  assert.equal(marked.length, 1, `${l}: only the unlabeled row is marked`);
  assert.equal(marked[0], labels[3], `${l}: the new row`);
  assert.match(marked[0], /border-\[#dc2626\]/, `${l}: visible border state`);
  const describedBy = marked[0].match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(describedBy, `${l}: aria-describedby`);
  const p = out.match(new RegExp(`<p id="${describedBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)</p>`));
  assert.ok(p, `${l}: the described element exists`);
  assert.equal(p[1], line, `${l}: our line`);
  assert.equal((out.match(/data-capture-unlabeled-line/g) ?? []).length, 1, `${l}: one line`);
  assert.equal((out.match(/data-capture-unlabeled=""/g) ?? []).length, 1, `${l}: one marked row`);
  // An untouched schema after a refused save elsewhere: nothing marked.
  const untouched = html(
    createElement(CaptureFieldsEditorGate, {
      schema: STORED,
      onChange: () => {},
      captureOn: true,
      isAdmin: false,
      developerMode: false,
      storedKeys: STORED.map((f) => f.key),
      storedFields: STORED.map(({ key, label }) => ({ key, label })),
      saveCheck: 3,
    }),
    l,
  );
  assert.ok(!untouched.includes("aria-invalid"), `${l}: untouched schema never marked`);
}
// The workspace refuses the save before the fetch, and focus goes to the row.
{
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  const save = ws.slice(ws.indexOf("const save = async"));
  assert.ok(save.indexOf("unlabeledCaptureRows(") > 0 && save.indexOf("unlabeledCaptureRows(") < save.indexOf("dataFetch("), "checked before the fetch");
  const src = read("app/[locale]/dashboard/campaigns/capture-fields-editor.tsx");
  assert.match(src, /data-capture-label\]\[aria-invalid="true"\]'\)\?\.focus\(\)/, "focus moves to the marked label input");
}

// 10. Developer mode: the rename warning only for a stored key that differs.
{
  const stored = STORED.map((f) => f.key);
  assert.equal(captureKeyRenamed("budget", "budget", stored), false, "unchanged");
  assert.equal(captureKeyRenamed("budget", "budget_total", stored), true, "stored key renamed");
  assert.equal(captureKeyRenamed(null, "anything", stored), false, "new row");
  assert.equal(captureKeyRenamed("not_stored", "other", stored), false, "origin not stored");
  assert.equal(captureKeyRenamed("budget", "budget_total", []), false, "nothing stored");

  const renamedSchema = STORED.map((f, i) => (i === 0 ? { ...f, key: "budget_total" } : f));
  const withNew = addCaptureField(renamedSchema).map((f, i) => (i === 3 ? { ...f, label: "New", key: "custom" } : f));
  const render = (o: { developerMode?: boolean; isAdmin?: boolean }, l = "fr") =>
    html(
      createElement(CaptureFieldsEditorGate, {
        schema: withNew,
        onChange: () => {},
        captureOn: true,
        isAdmin: o.isAdmin ?? false,
        developerMode: o.developerMode ?? false,
        storedKeys: stored,
        initialKeyOrigins: [...stored, null],
      }),
      l,
    );
  for (const l of LOCALES) {
    const line = esc(messages(l).DashboardCampaigns.extractionKeyRenamed);
    const out = render({ developerMode: true }, l);
    assert.equal((out.match(/data-capture-renamed/g) ?? []).length, 1, `${l}: one warning (row 0 only)`);
    assert.ok(out.includes(line), `${l}: the warning's words`);
    const keys = keyInputs(out);
    const describedBy = (keys[0] ?? "").match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(describedBy && out.includes(`id="${describedBy}"`), `${l}: key input described by the warning`);
    assert.ok(keys.slice(1).every((k) => !k.includes("aria-describedby")), `${l}: other keys: no warning`);
    // Tenant: no key input, no warning.
    assert.ok(!render({}, l).includes(line), `${l}: tenant never sees it`);
  }
  // At mount (default origins) nothing is renamed.
  const fresh = html(
    createElement(CaptureFieldsEditorGate, {
      schema: STORED,
      onChange: () => {},
      captureOn: true,
      isAdmin: true,
      developerMode: true,
      storedKeys: stored,
    }),
  );
  assert.ok(!fresh.includes("data-capture-renamed"), "untouched: no warning");
}

// 11. Server 400 too_many_fields → our line, never the server's text.
{
  const body = { error: "too_many_fields", field: "extractionSchema", max: 20 };
  assert.equal(isTooManyCaptureFields(400, body), true);
  assert.equal(isTooManyCaptureFields(409, body), false);
  assert.equal(isTooManyCaptureFields(400, { error: "too_many_fields", field: "locations" }), false);
  assert.equal(isTooManyCaptureFields(400, null), false);
  assert.equal(isTooManyCaptureFields(400, "too_many_fields"), false);
  const ws = read("app/[locale]/dashboard/campaigns/campaigns-workspace.tsx");
  assert.match(ws, /isTooManyCaptureFields\(400, await res\.json\(\)[^\n]*\n[^\n]*\n[^\n]*\n\s*setSaveError\(t\("extractionMax", \{ max: MAX_CAPTURE_FIELDS \}\)\)/, "our sentence in the save error line");
  assert.match(ws, /<span role="alert"[^>]*>\{saveError\}<\/span>/, "shown where save errors appear");
  for (const l of LOCALES) assert.equal(messages(l).DashboardCampaigns.extractionMax.replace("{max}", String(MAX_CAPTURE_FIELDS)).includes("too_many"), false);
}

// 12. Identical keys in fr/en/he, and the copy.
{
  const fr = messages("fr").DashboardCampaigns;
  const en = messages("en").DashboardCampaigns;
  assert.equal(fr.extractionUnlabeled, "Donnez un nom à cette information");
  assert.equal(en.extractionUnlabeled, "Give this information a name");
  assert.equal(fr.extractionKeyRenamed, "Les relevés déjà faits gardent l'ancienne clé");
  assert.equal(en.extractionKeyRenamed, "Values already captured keep the old key");
  for (const l of LOCALES)
    for (const k of ["extractionUnlabeled", "extractionKeyRenamed"]) {
      const v = messages(l).DashboardCampaigns[k];
      assert.ok(typeof v === "string" && v.trim(), `${l}.${k}`);
      assert.doesNotMatch(v, /extrai|extract|חילוץ/i, `${l}.${k}: no "extract"`);
    }
  const keys = (l: string) => Object.keys(messages(l).DashboardCampaigns).sort();
  assert.deepEqual(keys("en"), keys("fr"));
  assert.deepEqual(keys("he"), keys("fr"));
}

console.log("campaign-capture-key: all assertions passed");
