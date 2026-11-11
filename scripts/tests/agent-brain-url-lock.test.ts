// "Who answers the phone" after the SSRF fix (#253): a tenant gets no url
// input, only a calm "configured by the Tamara team" line; the signing secret
// is write-only; a refused save maps to our own words, never the server's.
// Renders the REAL AgentBrainView to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/agent-brain-url-lock.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentBrainView, type AgentBrainViewProps } from "../../app/[locale]/dashboard/settings/agent-brain-section";
import {
  brainPutBody,
  brainSaveError,
  toBrainState,
  type BrainErrorKey,
  type BrainResponse,
} from "../../app/[locale]/dashboard/settings/agent-brain-ui";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;

// Mock values that must never appear in a tenant's markup.
const MOCK_URL = "https://agent.example.test/hook";
const MOCK_SECRET = "mock-secret-0123456789abcdef";

const served = (urlEditable: boolean | undefined, brain: BrainResponse["brain"]): BrainResponse => ({
  brain,
  ...(urlEditable === undefined ? {} : { urlEditable }),
});

function render(d: BrainResponse, locale = "en", extra: Partial<AgentBrainViewProps> = {}) {
  const { view } = toBrainState(d);
  const props: AgentBrainViewProps = {
    view,
    urlDraft: view.url,
    secretDraft: "",
    busy: false,
    saved: false,
    error: null,
    probe: null,
    onToggle: () => {},
    onUrlChange: () => {},
    onSaveUrl: () => {},
    onTest: () => {},
    onSecretChange: () => {},
    onSaveSecret: () => {},
    ...extra,
  };
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(AgentBrainView, props),
    ),
  );
}

const urlInputs = (html: string) => (html.match(/type="url"/g) ?? []).length;
const esc = (s: string) => s.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

// 1. Tenant (urlEditable false) with a configured webhook: no url input, no url, the calm line
for (const l of LOCALES) {
  const m = messages(l).AgentBrain;
  const html = render(served(false, { enabled: true, url: MOCK_URL, secret: MOCK_SECRET }), l);
  assert.equal(urlInputs(html), 0, `${l}: no url input`);
  assert.ok(!html.includes(MOCK_URL) && !html.includes("agent.example.test"), `${l}: never the url`);
  assert.ok(!html.includes(m.urlLabel), `${l}: no url label`);
  assert.ok(!html.includes(`>${m.test}<`), `${l}: no test button`);
  assert.ok(html.includes(esc(m.configuredByTeam)), `${l}: configured line`);
  // The rest stays usable: the switch and the secret.
  assert.match(html, /type="checkbox"[^>]*checked=""/, `${l}: switch on`);
  assert.doesNotMatch(html, /type="checkbox"[^>]*disabled/, `${l}: switch usable`);
  assert.match(html, /type="password"/, `${l}: secret input`);
  assert.ok(html.includes(esc(m.secretSet)), `${l}: secret "set"`);
  assert.ok(!html.includes(MOCK_SECRET), `${l}: never the secret`);
}

// 2. Tenant with no webhook: nothing about the url at all
for (const l of LOCALES) {
  const m = messages(l).AgentBrain;
  const html = render(served(false, { enabled: false, url: "" }), l);
  assert.equal(urlInputs(html), 0, `${l}: no url input`);
  assert.ok(!html.includes(esc(m.configuredByTeam)), `${l}: no configured line`);
  assert.ok(!html.includes(m.urlLabel), `${l}: no url label`);
  assert.ok(html.includes(esc(m.secretNotSet)), `${l}: secret "not set"`);
}
// An older server without urlEditable is treated as a tenant (safe default).
assert.equal(urlInputs(render(served(undefined, { enabled: true, url: MOCK_URL }))), 0);
assert.equal(toBrainState(served(undefined, { enabled: true, url: MOCK_URL })).view.url, "");

// 3. Admin (urlEditable true): the field works as before
{
  const html = render(served(true, { enabled: true, url: MOCK_URL, secret: MOCK_SECRET }));
  assert.equal(urlInputs(html), 1, "url input");
  assert.ok(html.includes(`value="${MOCK_URL}"`), "admin sees the url");
  assert.ok(!html.includes(MOCK_SECRET), "admin: secret still never rendered");
}

// 4. The secret is never in the view, the state or the markup, whoever looks
for (const editable of [true, false]) {
  const st = toBrainState(served(editable, { enabled: true, url: MOCK_URL, secret: MOCK_SECRET }));
  assert.ok(!JSON.stringify(st).includes(MOCK_SECRET), "no secret in state");
  assert.equal(st.view.secretSet, true);
}
assert.equal(toBrainState(served(true, { enabled: false, url: "", secret: "" })).view.secretSet, false);
// The component source has no path to the value either.
{
  const src = read("app/[locale]/dashboard/settings/agent-brain-section.tsx");
  assert.doesNotMatch(src, /brain\.secret|\.secret\b(?!Draft)/, "component never reads a secret value");
  assert.doesNotMatch(src, /clipboard/, "no copy-secret path");
}

// 5. PUT body: a tenant sends the stored url back unchanged; an admin what they typed
{
  const tenant = toBrainState(served(false, { enabled: true, url: MOCK_URL }));
  assert.deepEqual(brainPutBody(tenant, { enabled: false, url: "https://other.example.test/x" }), {
    enabled: false,
    url: MOCK_URL,
  });
  assert.deepEqual(brainPutBody(tenant, { enabled: true, secret: "  s3cret " }), {
    enabled: true,
    url: MOCK_URL,
    secret: "s3cret",
  });
  const admin = toBrainState(served(true, { enabled: false, url: MOCK_URL }));
  assert.deepEqual(brainPutBody(admin, { enabled: true, url: " https://new.example.test/a " }), {
    enabled: true,
    url: "https://new.example.test/a",
  });
}

// 6. Error mapping: three keys, never the server's message or code
{
  const leaky = "Resolves to 127.0.0.1 (loopback)";
  assert.equal(brainSaveError(403, { error: "admin_only", fields: ["url"] }), "adminOnly");
  assert.equal(brainSaveError(400, { error: "unsafe_url", message: leaky }), "unsafeUrl");
  assert.equal(brainSaveError(400, { error: "Bad JSON" }), "generic");
  assert.equal(brainSaveError(403, { error: "Forbidden" }), "generic");
  assert.equal(brainSaveError(500, null), "generic");
  assert.equal(brainSaveError(200, { error: "x" }), "generic");
  assert.equal(brainSaveError(200, { brain: { enabled: true, url: "" } }), null);

  for (const l of LOCALES) {
    const m = messages(l).AgentBrain;
    for (const key of ["adminOnly", "unsafeUrl", "generic"] as BrainErrorKey[]) {
      const html = render(served(true, { enabled: false, url: "http://127.0.0.1/x" }), l, { error: key });
      assert.match(html, /role="alert"/, `${l}/${key}: alert`);
      assert.ok(html.includes(esc(m.errors[key])), `${l}/${key}: our words`);
      for (const bad of [leaky, "admin_only", "unsafe_url", "loopback"]) {
        assert.ok(!html.includes(bad), `${l}/${key}: never "${bad}"`);
      }
    }
    // One plain line, no address detail in our own copy either.
    assert.doesNotMatch(m.errors.unsafeUrl, /\d+\.\d+|IP|localhost/i, `${l}: no detail`);
  }
}

// 7. Every key exists in the three languages
{
  const keys = (o: Record<string, unknown>, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
  const fr = keys(messages("fr").AgentBrain).sort();
  for (const l of ["en", "he"]) assert.deepEqual(keys(messages(l).AgentBrain).sort(), fr, `${l}: same keys as fr`);
  // Hebrew renders right-to-left content without breaking the url-less layout.
  const he = render(served(false, { enabled: true, url: MOCK_URL }), "he");
  assert.ok(he.includes(messages("he").AgentBrain.configuredByTeam));
}

console.log("agent-brain-url-lock: ok");
