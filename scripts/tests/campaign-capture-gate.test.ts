// Campaign "fields to capture" editor: hidden for tenants while the server's
// capture switch is off (admins see it with one "not active yet" line), and
// a 20-field cap on ADDING (a longer existing schema is kept byte-identical).
// Renders the REAL components to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/campaign-capture-gate.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignSetupStep } from "../../app/[locale]/dashboard/campaigns/campaign-setup-step";
import { CaptureFieldsEditor } from "../../app/[locale]/dashboard/campaigns/capture-fields-editor";
import {
  MAX_CAPTURE_FIELDS,
  addCaptureField,
  canAddCaptureField,
  captureEditorView,
  removeCaptureField,
} from "../../lib/campaigns/capture-editor";
import { captureMode } from "../../lib/campaigns/capture-mode";
import {
  DEFAULT_CALL_WINDOW,
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRY_RULES,
  type ExtractionField,
} from "../../lib/campaigns/constants";
import { isDraftDirty, snapshot } from "../../lib/campaigns/edit-guard";
import { planCampaignPatch } from "../../lib/campaigns/patch-plan";
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

const fields = (n: number): ExtractionField[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `field_${i + 1}`,
    label: `Field ${i + 1}`,
    type: i % 3 === 0 ? "enum" : "string",
    ...(i % 3 === 0 ? { options: ["yes", "no"] } : {}),
    ...(i % 5 === 0 ? { required: true } : {}),
  }));

function draftWith(schema: ExtractionField[]): CampaignDraft {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Mock campaign",
    goalPreset: "custom",
    objective: "Mock objective",
    fromNumber: "",
    agentId: null,
    successCriteria: "",
    extractionSchema: schema,
    concurrency: DEFAULT_CONCURRENCY,
    retryRules: { ...DEFAULT_RETRY_RULES },
    callWindow: { ...DEFAULT_CALL_WINDOW },
  };
}

const setup = (o: { captureOn?: boolean; isAdmin?: boolean; schema?: ExtractionField[] }, locale = "fr") =>
  html(
    createElement(CampaignSetupStep, {
      draft: draftWith(o.schema ?? fields(2)),
      onChange: () => {},
      agents: [],
      fromNumbers: [],
      isAdmin: o.isAdmin ?? false,
      captureOn: o.captureOn,
    }),
    locale,
  );
const editor = (schema: ExtractionField[], o: { captureOn?: boolean; isAdmin?: boolean } = {}, locale = "fr") =>
  html(
    createElement(CaptureFieldsEditor, {
      schema,
      onChange: () => {},
      captureOn: o.captureOn ?? true,
      isAdmin: o.isAdmin ?? false,
    }),
    locale,
  );

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const addButton = (s: string) => s.match(/<button[^>]*data-capture-add[^>]*>/)?.[0] ?? "";

// 1. The switch: "on" only when the server env says so (same reader as the routes).
{
  assert.equal(captureMode({}), "off");
  assert.equal(captureMode({ CAMPAIGN_CAPTURE: "dry" }), "off");
  assert.equal(captureMode({ CAMPAIGN_CAPTURE: " ON " }), "on");
  assert.equal(captureEditorView(false, false), "hidden");
  assert.equal(captureEditorView(false, true), "off_admin");
  assert.equal(captureEditorView(true, false), "on");
  assert.equal(captureEditorView(true, true), "on");
}

// 2. Flag off: tenant sees no editor; admin sees the editor plus the one line.
for (const l of LOCALES) {
  const m = messages(l);
  const title = esc(m.DashboardCampaigns.extractionTitle);
  const line = esc(m.DashboardCampaigns.extractionCaptureOff);

  const tenant = setup({ captureOn: false, isAdmin: false }, l);
  assert.ok(!tenant.includes(title), `${l}: tenant, flag off: no editor`);
  assert.ok(!tenant.includes("data-capture-field"), `${l}: tenant, flag off: no field rows`);
  assert.ok(!tenant.includes(line), `${l}: tenant never sees the off line`);
  // The prop absent = off (the safe default).
  assert.ok(!setup({ isAdmin: false }, l).includes(title), `${l}: absent flag = hidden`);

  const admin = setup({ captureOn: false, isAdmin: true }, l);
  assert.ok(admin.includes(title), `${l}: admin, flag off: editor shown`);
  assert.equal(count(admin, /data-capture-field/g), 2, `${l}: admin sees the fields`);
  assert.equal(count(admin, /data-capture-off/g), 1, `${l}: admin sees exactly one off line`);
  assert.ok(admin.includes(line), `${l}: the off line's words`);
  assert.ok(admin.includes(esc(m.ToolsBrick.statusPending)), `${l}: same "Not active yet" prefix as MissionBrick`);
}

// 3. Flag on: editor for tenant and admin, and no off line.
for (const isAdmin of [false, true]) {
  const out = setup({ captureOn: true, isAdmin });
  assert.ok(out.includes(esc(messages("fr").DashboardCampaigns.extractionTitle)), `on, admin=${isAdmin}: editor`);
  assert.equal(count(out, /data-capture-field/g), 2);
  assert.equal(count(out, /data-capture-off/g), 0, `on, admin=${isAdmin}: no off line`);
}

// 4. The cap: add disabled at 20 with its reason; removing still allowed.
{
  assert.equal(MAX_CAPTURE_FIELDS, 20);
  const s19 = fields(19);
  assert.equal(canAddCaptureField(s19), true);
  assert.equal(addCaptureField(s19).length, 20);
  const below = editor(s19);
  assert.ok(!/\sdisabled=""/.test(addButton(below)), "19: add enabled");
  assert.ok(!below.includes(esc(messages("fr").DashboardCampaigns.extractionMax.replace("{max}", "20"))), "19: no cap sentence");

  const s20 = fields(20);
  assert.equal(canAddCaptureField(s20), false);
  assert.equal(addCaptureField(s20), s20, "20: add is a no-op (same array)");
  for (const l of LOCALES) {
    const out = editor(s20, {}, l);
    const btn = addButton(out);
    assert.match(btn, /\sdisabled=""/, `${l}: 20: add disabled`);
    const describedBy = btn.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(describedBy, `${l}: the disabled add names its reason`);
    const sentence = esc(messages(l).DashboardCampaigns.extractionMax.replace("{max}", "20"));
    assert.ok(out.includes(`id="${describedBy}"`), `${l}: the reason's element exists`);
    assert.ok(out.includes(sentence), `${l}: the cap sentence`);
    // Removing still allowed: one enabled remove button per field.
    const removes = out.match(/<button[^>]*data-capture-remove[^>]*>/g) ?? [];
    assert.equal(removes.length, 20);
    assert.ok(removes.every((b) => !/\sdisabled=""/.test(b)), `${l}: removes enabled`);
  }
  assert.equal(removeCaptureField(s20, 0).length, 19);
  // Touch targets: add and remove are at least 44 px (h-11 / min-h-11).
  const out = editor(s20);
  assert.match(addButton(out), /min-h-11/);
  assert.match(out.match(/<button[^>]*data-capture-remove[^>]*>/)?.[0] ?? "", /h-11 w-11/);
}

// 5. 23 fields: kept untouched — never truncated, never rewritten on save.
{
  // As stored: the server's own normalization (the POST/PATCH write path).
  const stored = normalizeExtractionSchema(fields(23));
  assert.equal(stored.length, 23, "the server keeps 23 (its own cap is 30)");
  const storedJson = JSON.stringify(stored);

  // Loaded into the editor as the workspace does (openExisting), then render.
  const loaded = draftWith(JSON.parse(storedJson));
  const savedSnap = snapshot(loaded);
  const out = editor(loaded.extractionSchema, { captureOn: true });
  assert.equal(count(out, /data-capture-field/g), 23, "all 23 shown");
  assert.match(addButton(out), /\sdisabled=""/, "23: add disabled");
  assert.equal(addCaptureField(loaded.extractionSchema), loaded.extractionSchema, "23: add is a no-op");
  // Hidden (tenant, flag off) renders nothing and touches nothing either.
  assert.equal(editor(loaded.extractionSchema, { captureOn: false, isAdmin: false }), "");

  // Save something else: change the name only. The body the workspace sends
  // (the whole draft) carries the 23 byte-identical, and the server plan
  // writes no extractionSchema at all, for every editable status.
  const edited = { ...loaded, name: "Mock campaign renamed" };
  assert.ok(isDraftDirty(edited, savedSnap));
  const body = JSON.parse(JSON.stringify(edited)) as Record<string, unknown>;
  assert.equal(JSON.stringify(body.extractionSchema), storedJson, "body carries the 23 byte-identical");
  for (const status of ["draft", "paused", "running", "completed"]) {
    const plan = planCampaignPatch({ status, ...draftWith(stored) }, body);
    assert.ok(plan.ok, `${status}: a rename is accepted`);
    if (plan.ok) assert.ok(!("extractionSchema" in plan.changes), `${status}: schema not rewritten`);
  }
  assert.equal(JSON.stringify(stored), storedJson, "stored schema unchanged");

  // Removing one of 23 still works (22, still above the cap: add stays off).
  const s22 = removeCaptureField(loaded.extractionSchema, 3);
  assert.equal(s22.length, 22);
  assert.deepEqual(s22, [...stored.slice(0, 3), ...stored.slice(4)]);
  assert.equal(canAddCaptureField(s22), false);
  const plan = planCampaignPatch({ status: "draft", ...draftWith(stored) }, { extractionSchema: s22 });
  assert.ok(plan.ok && JSON.stringify(plan.changes.extractionSchema) === JSON.stringify(s22), "a removal saves exactly 22");
}

// 6. Same keys in fr/en/he, non-empty, the cap sentence carries {max}.
{
  for (const k of ["extractionCaptureOff", "extractionMax"]) {
    for (const l of LOCALES) {
      const v = messages(l).DashboardCampaigns[k];
      assert.equal(typeof v, "string", `${l}.${k}`);
      assert.ok(v.trim().length > 0, `${l}.${k} non-empty`);
    }
  }
  for (const l of LOCALES) assert.ok(messages(l).DashboardCampaigns.extractionMax.includes("{max}"), `${l}: {max}`);
  const keys = (l: string) => Object.keys(messages(l).DashboardCampaigns).sort();
  assert.deepEqual(keys("en"), keys("fr"), "en = fr keys");
  assert.deepEqual(keys("he"), keys("fr"), "he = fr keys");
}

// 7. The switch reaches the client as one boolean from the server page; no
//    client file reads the env or imports the server reader.
{
  const page = read("app/[locale]/dashboard/campaigns/page.tsx");
  assert.match(page, /captureOn=\{captureMode\(\) === "on"\}/);
  for (const f of [
    "campaigns-page-client.tsx",
    "outbound-home.tsx",
    "campaigns-workspace.tsx",
    "campaign-setup-step.tsx",
    "capture-fields-editor.tsx",
  ]) {
    const src = read(`app/[locale]/dashboard/campaigns/${f}`);
    assert.ok(!src.includes("capture-mode"), `${f}: no server reader`);
    assert.ok(!src.includes("process.env"), `${f}: no env`);
  }
  assert.ok(!read("lib/campaigns/capture-editor.ts").includes("process.env"));
}

// VP review: a sales manager's words, one colon, no switch named on screen.
{
  const fr = messages("fr").DashboardCampaigns;
  assert.equal(fr.extractionTitle, "Informations à relever");
  assert.equal(fr.extractionCaptureOff, "le relevé des informations est éteint sur la plateforme, rien n'est rempli pour l'instant.");
  assert.equal(fr.extractionMax.replace("{max}", "20"), "20 informations maximum par campagne.");
  for (const l of LOCALES) {
    const c = messages(l).DashboardCampaigns;
    for (const k of ["extractionTitle", "extractionHint", "extractionAddField", "extractionCaptureOff", "extractionMax"])
      assert.doesNotMatch(c[k], /extrai|extract|données structurées|structured data|CAMPAIGN_CAPTURE|חילוץ/i, `${l} ${k}`);
    assert.equal((c.extractionCaptureOff.match(/:/g) ?? []).length, 0, `${l}: no colon inside the line (the prefix brings one)`);
  }
}

console.log("campaign-capture-gate: all assertions passed");
