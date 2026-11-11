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

/**
 * A server answer in the #254 shape (lib/agent-brain-guard brainView): the url
 * and the secret value only for an admin; urlSet / secretSet for everyone.
 * `urlEditable: undefined` = an older server that doesn't send the flag.
 */
function served(
  urlEditable: boolean | undefined,
  stored: { enabled: boolean; url: string; secret?: string },
): BrainResponse {
  const admin = urlEditable === true;
  return {
    brain: {
      enabled: stored.enabled,
      url: admin ? stored.url : "",
      urlSet: Boolean(stored.url),
      secretSet: Boolean(stored.secret),
      ...(admin && stored.secret ? { secret: stored.secret } : {}),
    },
    ...(urlEditable === undefined ? {} : { urlEditable }),
  };
}
// Belt and braces: even if a server echoed the values to a tenant again, the
// screen must not show them.
const leakyTenant = (stored: { enabled: boolean; url: string; secret?: string }): BrainResponse => ({
  brain: { ...stored, urlSet: Boolean(stored.url), secretSet: Boolean(stored.secret) },
  urlEditable: false,
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
  const leaky = render(leakyTenant({ enabled: true, url: MOCK_URL, secret: MOCK_SECRET }), l);
  assert.equal(leaky, html, `${l}: an echoed url/secret changes nothing on screen`);
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
  // Design review: no setup form for something the tenant can't set up — only who can connect one.
  assert.ok(html.includes(esc(m.connectViaTeam)), `${l}: who can connect it`);
  assert.ok(!/type="checkbox"/.test(html), `${l}: no switch`);
  assert.ok(!/type="password"|type="text"|<input/.test(html), `${l}: no input at all`);
  for (const k of ["secretLabel", "secretNotSet", "secretSet", "contractTitle", "toggleLabel"] as const)
    assert.ok(!html.includes(esc(m[k])), `${l}: no ${k}`);
  assert.ok(!html.includes("HMAC"), `${l}: no signature sentence`);
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
for (const d of [
  served(true, { enabled: true, url: MOCK_URL, secret: MOCK_SECRET }),
  served(false, { enabled: true, url: MOCK_URL, secret: MOCK_SECRET }),
  leakyTenant({ enabled: true, url: MOCK_URL, secret: MOCK_SECRET }),
]) {
  const st = toBrainState(d);
  assert.ok(!JSON.stringify(st).includes(MOCK_SECRET), "no secret in state");
  assert.equal(st.view.secretSet, true);
}
assert.ok(!JSON.stringify(toBrainState(leakyTenant({ enabled: true, url: MOCK_URL }))).includes(MOCK_URL), "tenant state: no url");
assert.equal(toBrainState(served(true, { enabled: false, url: "", secret: "" })).view.secretSet, false);
// The component source has no path to the value either.
{
  const src = read("app/[locale]/dashboard/settings/agent-brain-section.tsx");
  assert.doesNotMatch(src, /brain\.secret|\.secret\b(?!Draft)/, "component never reads a secret value");
  assert.doesNotMatch(src, /clipboard/, "no copy-secret path");
}

// 5. PUT body: a tenant's never carries a non-empty url; an admin's carries what they typed
{
  for (const d of [served(false, { enabled: true, url: MOCK_URL }), leakyTenant({ enabled: true, url: MOCK_URL })]) {
    const tenant = toBrainState(d);
    for (const next of [
      { enabled: false, url: "https://other.example.test/x" },
      { enabled: true, url: MOCK_URL },
      { enabled: true },
      { enabled: true, secret: "  s3cret " },
    ]) {
      const body = brainPutBody(tenant, next);
      assert.ok(!("url" in body) || body.url === "", `tenant body never carries a url: ${JSON.stringify(body)}`);
    }
    assert.deepEqual(brainPutBody(tenant, { enabled: false, url: "https://other.example.test/x" }), { enabled: false });
    assert.deepEqual(brainPutBody(tenant, { enabled: true, secret: "  s3cret " }), { enabled: true, secret: "s3cret" });
  }
  const admin = toBrainState(served(true, { enabled: false, url: MOCK_URL }));
  assert.deepEqual(brainPutBody(admin, { enabled: true, url: " https://new.example.test/a " }), {
    enabled: true,
    url: "https://new.example.test/a",
  });
}

// 6. Error mapping: our keys only, never the server's message or code.
//    unsafe_url reads by role: tenant -> the long key (who can fix it), admin -> the short one.
{
  const leaky = "Resolves to 127.0.0.1 (loopback)";
  const TENANT = { urlEditable: false };
  const ADMIN = { urlEditable: true };
  for (const who of [TENANT, ADMIN]) {
    assert.equal(brainSaveError(403, { error: "admin_only", fields: ["url"] }, who), "adminOnly");
    assert.equal(brainSaveError(400, { error: "Bad JSON" }, who), "generic");
    assert.equal(brainSaveError(403, { error: "Forbidden" }, who), "generic");
    assert.equal(brainSaveError(403, { error: "unsafe_url" }, who), "generic");
    assert.equal(brainSaveError(500, null, who), "generic");
    assert.equal(brainSaveError(200, { error: "x" }, who), "generic");
    assert.equal(brainSaveError(200, { brain: { enabled: true, url: "" } }, who), null);
  }
  assert.equal(brainSaveError(400, { error: "unsafe_url", message: leaky }, TENANT), "unsafeUrlTenant");
  assert.equal(brainSaveError(400, { error: "unsafe_url", message: leaky }, ADMIN), "unsafeUrl");
  // The section passes the view's urlEditable (from the server answer, missing = tenant).
  for (const [d, key] of [
    [served(false, { enabled: true, url: MOCK_URL }), "unsafeUrlTenant"],
    [served(undefined, { enabled: true, url: MOCK_URL }), "unsafeUrlTenant"],
    [served(true, { enabled: true, url: MOCK_URL }), "unsafeUrl"],
  ] as const) {
    const { view } = toBrainState(d);
    assert.equal(brainSaveError(400, { error: "unsafe_url", message: leaky }, { urlEditable: view.urlEditable }), key);
  }
  assert.match(
    read("app/[locale]/dashboard/settings/agent-brain-section.tsx"),
    /brainSaveError\(res\.status, d, \{ urlEditable: state\.view\.urlEditable \}\)/,
    "the section branches on the server's urlEditable",
  );
  // Exact copy (tamaraVP).
  assert.equal(
    messages("fr").AgentBrain.errors.unsafeUrlTenant,
    "Cette adresse ne peut pas être utilisée. Contactez l'équipe Tamara pour la mettre à jour, ou désactivez l'agent.",
  );
  assert.equal(
    messages("en").AgentBrain.errors.unsafeUrlTenant,
    "This address can't be used. Contact the Tamara team to update it, or turn the agent off.",
  );
  assert.equal(messages("fr").AgentBrain.errors.unsafeUrl, "Cette adresse ne peut pas être utilisée.");

  for (const l of LOCALES) {
    const m = messages(l).AgentBrain;
    for (const key of ["adminOnly", "unsafeUrl", "unsafeUrlTenant", "generic"] as BrainErrorKey[]) {
      const urlEditable = key !== "unsafeUrlTenant";
      const html = render(served(urlEditable, { enabled: true, url: "http://127.0.0.1/x" }), l, { error: key });
      assert.match(html, /role="alert"/, `${l}/${key}: alert`);
      assert.ok(html.includes(esc(m.errors[key])), `${l}/${key}: our words`);
      for (const bad of [leaky, "admin_only", "unsafe_url", "loopback"]) {
        assert.ok(!html.includes(bad), `${l}/${key}: never "${bad}"`);
      }
    }
    // The tenant line is longer than the admin one and starts with it.
    assert.ok(m.errors.unsafeUrlTenant.startsWith(m.errors.unsafeUrl), `${l}: tenant line extends the short one`);
    assert.notEqual(m.errors.unsafeUrlTenant, m.errors.unsafeUrl, `${l}: tenant line differs`);
    // One plain line, no address detail in our own copy either.
    for (const k of ["unsafeUrl", "unsafeUrlTenant"] as const)
      assert.doesNotMatch(m.errors[k], /\d+\.\d+|\bIP\b|localhost/i, `${l}/${k}: no detail`);
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

// Live bug guard (until the server fix): PUT treats an OMITTED `enabled` as false and switches the
// customer's agent off. Every save from this section must carry `enabled`, including a secret-only save.
{
  const src = read("app/[locale]/dashboard/settings/agent-brain-section.tsx");
  const saves = src.match(/save\(\{[^}]*\}\)/g) ?? [];
  assert.ok(saves.length >= 3, "the section's save calls were found");
  for (const call of saves) assert.match(call, /\benabled\b/, `every save carries enabled: ${call}`);
  assert.match(src, /save\(\{ enabled: state\.view\.enabled, url: urlDraft, secret: secretDraft \}\)/, "secret-only save keeps the current value");
  for (const urlEditable of [true, false]) {
    const st = toBrainState(served(urlEditable, { enabled: true, url: MOCK_URL }));
    assert.equal(brainPutBody(st, { enabled: true, secret: "x" }).enabled, true);
    assert.ok("enabled" in brainPutBody(st, { enabled: false }));
  }
}

console.log("agent-brain-url-lock: ok");
