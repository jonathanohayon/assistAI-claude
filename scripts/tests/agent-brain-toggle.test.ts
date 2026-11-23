// "Use my own agent" switch: a click always does something visible.
//   - no usable address in the field: NO request, "address first" under the
//     switch, the box stays ticked (pending), focus goes to the address field;
//   - Save then sends the switch-on WITH the address (one PUT);
//   - every refusal is shown in words next to the control that caused it;
//   - a switch that can't be used is not rendered (the "contact the team" line).
// Renders the REAL AgentBrainView to static HTML. Mock data only.
// Run with:  npx tsx scripts/tests/agent-brain-toggle.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentBrainView, type AgentBrainViewProps } from "../../app/[locale]/dashboard/settings/agent-brain-section";
// Namespace import on purpose: run against an older module, a missing export
// fails its own assertion instead of the whole file at load time.
import * as ui from "../../app/[locale]/dashboard/settings/agent-brain-ui";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const SECTION = "app/[locale]/dashboard/settings/agent-brain-section.tsx";

const MOCK_URL = "https://agent.example.test/hook";
const ADDRESS_FIRST = { at: "toggle", key: "addressRequired" };

/** A server answer in the #254 shape: the url only for an admin. */
function served(admin: boolean, stored: { enabled: boolean; url: string; secret?: string }): ui.BrainResponse {
  return {
    brain: {
      enabled: stored.enabled,
      url: admin ? stored.url : "",
      urlSet: Boolean(stored.url),
      secretSet: Boolean(stored.secret),
    },
    urlEditable: admin,
  };
}
const ADMIN = { urlEditable: true };
const TENANT = { urlEditable: false };
const saveError = (
  status: number,
  body: ui.BrainResponse | null,
  who: { urlEditable: boolean },
  sent: { enabled: boolean; url?: string },
  from: ui.BrainErrorAt = "toggle",
) => ui.brainSaveError(status, body, { ...who, from, sent } as never) as unknown;

function render(d: ui.BrainResponse, locale = "en", extra: Partial<AgentBrainViewProps> = {}) {
  const { view } = ui.toBrainState(d);
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
const esc = (s: string) => s.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const checkbox = (html: string) => html.match(/<input type="checkbox"[^>]*>/)?.[0] ?? null;

// 1. The silent downgrade (main): PUT { enabled: true } answered 200 with the
//    agent stored OFF. main maps that to "no error" and the box unticks
//    without a word; now it is the "address first" line under the switch.
{
  const off = served(true, { enabled: false, url: "" });
  assert.deepEqual(saveError(200, off, ADMIN, { enabled: true, url: "" }), ADDRESS_FIRST, "200 + stored off when asked on: said in words");
  assert.deepEqual(saveError(200, served(false, { enabled: false, url: MOCK_URL }), TENANT, { enabled: true }), ADDRESS_FIRST);
  // Asked off, stored off: a normal save.
  assert.equal(saveError(200, off, ADMIN, { enabled: false, url: "" }), null);
  // Asked on, stored on: a normal save.
  assert.equal(saveError(200, served(true, { enabled: true, url: MOCK_URL }), ADMIN, { enabled: true, url: MOCK_URL }), null);
}

// 2. The code-to-sentence mapping (tamaraVlad's contract), the four rows.
{
  // Row 1: 400, body EXACTLY {"error":"address_required"} -> "address first", under the switch.
  const addressRequired = JSON.parse('{"error":"address_required"}') as ui.BrainResponse;
  for (const who of [ADMIN, TENANT])
    for (const from of ["toggle", "url", "secret"] as const)
      assert.deepEqual(saveError(400, addressRequired, who, { enabled: true, url: "" }, from), ADDRESS_FIRST, `address_required from ${from}`);
  // Row 2: 400 unsafe_url on an EMPTY / whitespace address (main today) -> the same sentence, under the switch.
  for (const url of ["", "   ", undefined])
    for (const from of ["toggle", "url"] as const)
      assert.deepEqual(saveError(400, { error: "unsafe_url" }, ADMIN, { enabled: true, url }, from), ADDRESS_FIRST, `unsafe_url on "${url}"`);
  // Row 3: 400 unsafe_url on a real address -> "can't be used", under the address field (admin);
  //        a tenant can't see the field: the long line under the control used.
  for (const from of ["toggle", "url", "secret"] as const) {
    assert.deepEqual(saveError(400, { error: "unsafe_url" }, ADMIN, { enabled: true, url: MOCK_URL }, from), { at: "url", key: "unsafeUrl" });
    assert.deepEqual(saveError(400, { error: "unsafe_url" }, TENANT, { enabled: true }, from), { at: from, key: "unsafeUrlTenant" });
  }
  // Row 4: the defensive 200 with enabled:false (section 1).
  assert.deepEqual(saveError(200, served(true, { enabled: false, url: "" }), ADMIN, { enabled: true, url: MOCK_URL }), ADDRESS_FIRST);
  // Other refusals: in words, next to the control used.
  assert.deepEqual(saveError(403, { error: "admin_only", fields: ["url"] }, ADMIN, { enabled: true, url: MOCK_URL }), { at: "url", key: "adminOnly" });
  for (const from of ["toggle", "url", "secret"] as const) {
    assert.deepEqual(saveError(500, null, ADMIN, { enabled: false }, from), { at: from, key: "generic" });
    assert.deepEqual(saveError(400, { error: "Bad JSON" }, TENANT, { enabled: true }, from), { at: from, key: "generic" });
  }
  // The sentence itself, exact (tamaraVP), and present in the three languages.
  assert.equal(messages("fr").AgentBrain.errors.addressRequired, "Indiquez d'abord l'adresse de votre agent.");
  assert.equal(messages("en").AgentBrain.errors.addressRequired, "Enter your agent's address first.");
  assert.ok(/[֐-׿]/.test(messages("he").AgentBrain.errors.addressRequired), "he: Hebrew copy");
  for (const l of LOCALES)
    assert.notEqual(messages(l).AgentBrain.errors.addressRequired, messages(l).AgentBrain.errors.unsafeUrl, `${l}: never "can't be used"`);
}

// 3. No PUT without a usable address: the plan refuses before any request.
{
  assert.equal(typeof ui.brainSavePlan, "function", "the section plans its save before sending");
  const admin = ui.toBrainState(served(true, { enabled: false, url: "" }));
  for (const url of ["", "   ", undefined, "agent.example.test/hook", "ftp://agent.example.test"])
    assert.deepEqual(ui.brainSavePlan(admin, { enabled: true, url }), { refuse: ADDRESS_FIRST }, `no PUT for "${url}"`);
  // Same rule from the address Save and a secret save that keeps the agent on.
  assert.deepEqual(ui.brainSavePlan(admin, { enabled: true, url: "", secret: "s" }), { refuse: ADDRESS_FIRST });
  // Turning off never needs an address.
  assert.deepEqual(ui.brainSavePlan(admin, { enabled: false, url: "" }), { put: { enabled: false, url: "" } });
  // A tenant never carries a url: the server keeps (and checks) the stored one.
  const tenant = ui.toBrainState(served(false, { enabled: false, url: MOCK_URL }));
  assert.deepEqual(ui.brainSavePlan(tenant, { enabled: true, url: "" }), { put: { enabled: true } });
  // A stored valid address: ticking saves at once.
  const adminWithUrl = ui.toBrainState(served(true, { enabled: false, url: MOCK_URL }));
  assert.deepEqual(ui.brainSavePlan(adminWithUrl, { enabled: true, url: MOCK_URL }), { put: { enabled: true, url: MOCK_URL } });

  // The rule (the server's, tamaraVlad #411): trimmed, starts with "http", scheme in any case.
  for (const [url, ok] of [
    [MOCK_URL, true],
    [`  ${MOCK_URL}  `, true],
    ["http://agent.example.test/hook", true],
    ["HTTPS://agent.example.test/hook", true],
    ["Https://agent.example.test/hook", true],
    ["", false],
    ["   ", false],
    ["agent.example.test", false],
    ["ftp://agent.example.test", false],
  ] as const) {
    assert.equal(ui.brainUrlUsable(url), ok, `usable: "${url}"`);
  }
  // An upper-case scheme is an address: no "address first", the PUT goes out with it.
  const upper = "HTTPS://agent.example.test/hook";
  assert.deepEqual(ui.brainSavePlan(admin, { enabled: true, url: upper }), { put: { enabled: true, url: upper } });
  assert.deepEqual(ui.brainSavePlan(admin, { enabled: true, url: ` ${upper} ` }), { put: { enabled: true, url: upper } });

  // The section sends only what the plan allows, and only after it.
  const src = read(SECTION);
  const body = src.slice(src.indexOf("const save = async"), src.indexOf("/** Checks the endpoint"));
  assert.ok(body.indexOf("brainSavePlan(") > 0 && body.indexOf("brainSavePlan(") < body.indexOf("fetch(API"), "plan before fetch");
  const refused = body.match(/if \("refuse" in plan\) \{([^{}]*)\}/)?.[1] ?? "";
  assert.match(refused, /showError\(plan\.refuse\);\s*return false;\s*$/, "a refused plan says why and returns before fetch");
  assert.match(body, /body: JSON\.stringify\(plan\.put\)/, "the PUT body is the plan's");
  assert.equal((src.match(/fetch\(API,/g) ?? []).length, 1, "one PUT path");
}

// 4. Save sends the switch-on together with the address (one PUT, enabled:true + url).
{
  const src = read(SECTION);
  assert.match(src, /onSaveUrl=\{\(\) => void save\("url", \{ enabled: state\.view\.enabled \|\| pendingOn, url: urlDraft \}\)\}/);
  const pending = ui.toBrainState(served(true, { enabled: false, url: "" }));
  assert.deepEqual(ui.brainSavePlan(pending, { enabled: true, url: ` ${MOCK_URL} ` }), { put: { enabled: true, url: MOCK_URL } });
  // "Address first" ticks the box (pending) and moves focus to the address field.
  assert.match(src, /e\.key === "addressRequired"\) \{\s*setPendingOn\(true\);[\s\S]*?urlRef\.current\?\.focus\(\)/);
  assert.match(src, /AgentBrainView\(\{ urlRef, \.\.\.props \}/, "the view takes the ref");
  assert.match(src, /<input\s+ref=\{urlRef\}\s+id=\{`\$\{ids\}-url`\}/, "on the address field");
  // Unticking a pending (never stored) switch sends nothing.
  assert.match(src, /if \(!enabled && pendingOn && !state\.view\.enabled\) \{\s*setPendingOn\(false\);\s*setError\(null\);\s*return;/);
  // A successful save clears the pending state.
  assert.match(src, /setPendingOn\(false\);\s*setSaved\(true\);/);
}

// 5. A test per state.
for (const l of LOCALES) {
  const m = messages(l).AgentBrain;
  // Tenant, no address, off: the switch couldn't be used -> not rendered; who to contact instead.
  {
    const html = render(served(false, { enabled: false, url: "" }), l);
    assert.equal(checkbox(html), null, `${l}: no checkbox when it can't be used`);
    assert.ok(html.includes(esc(m.connectViaTeam)), `${l}: contact the team`);
  }
  // Tenant, address configured, off: a usable switch, unticked.
  {
    const cb = checkbox(render(served(false, { enabled: false, url: MOCK_URL }), l))!;
    assert.ok(cb && !/checked/.test(cb) && !/disabled/.test(cb), `${l}: tenant off, usable`);
  }
  // Tenant, address configured, on.
  {
    const html = render(served(false, { enabled: true, url: MOCK_URL }), l);
    const cb = checkbox(html)!;
    assert.ok(/checked/.test(cb) && !/disabled/.test(cb), `${l}: tenant on, usable`);
    assert.ok(html.includes(esc(m.personaUnused)));
  }
  // Tenant, on with no address (stale): still switchable off, and says who to contact.
  {
    const html = render(served(false, { enabled: true, url: "" }), l);
    const cb = checkbox(html)!;
    assert.ok(/checked/.test(cb) && !/disabled/.test(cb), `${l}: stale on, can be turned off`);
    assert.ok(html.includes(esc(m.connectViaTeam)));
  }
  // Admin, no address, off: a usable switch and the address field.
  {
    const html = render(served(true, { enabled: false, url: "" }), l);
    const cb = checkbox(html)!;
    assert.ok(cb && !/checked/.test(cb) && !/disabled/.test(cb), `${l}: admin off, usable`);
    assert.match(html, /type="url"/);
    assert.doesNotMatch(html, /role="alert"/, `${l}: no message before a click`);
  }
  // Admin, ticked with no address: pending-on (ticked) and the sentence directly under the switch.
  {
    const html = render(served(true, { enabled: false, url: "" }), l, { pendingOn: true, error: { at: "toggle", key: "addressRequired" } });
    const cb = checkbox(html)!;
    assert.ok(/checked/.test(cb) && !/disabled/.test(cb), `${l}: pending-on shows ticked`);
    assert.ok(html.includes(esc(m.errors.addressRequired)), `${l}: the sentence`);
    assert.ok(!html.includes(esc(m.personaUnused)), `${l}: not "on" yet (persona line only once stored)`);
    const alertAt = html.indexOf('role="alert"');
    assert.ok(alertAt > html.indexOf('type="checkbox"') && alertAt < html.indexOf('type="url"'), `${l}: under the switch, above the field`);
    const id = html.match(/<p id="([^"]+)" role="alert"/)?.[1];
    assert.ok(id && cb.includes(`aria-describedby="${id}"`), `${l}: the switch is described by the sentence`);
  }
  // Admin, address stored, on.
  {
    const cb = checkbox(render(served(true, { enabled: true, url: MOCK_URL }), l))!;
    assert.ok(/checked/.test(cb) && !/disabled/.test(cb), `${l}: admin on`);
  }
  // A save in flight: the switch waits.
  assert.match(checkbox(render(served(true, { enabled: false, url: MOCK_URL }), l, { busy: true }))!, /disabled/, `${l}: busy`);
}

// 6. Each message sits next to the control that caused it, never at the bottom of the card.
for (const l of LOCALES) {
  const m = messages(l).AgentBrain;
  const pos = (html: string) => ({
    alert: html.indexOf('role="alert"'),
    toggle: html.indexOf('type="checkbox"'),
    url: html.indexOf('type="url"'),
    secret: html.indexOf('type="password"'),
    secretHelp: html.indexOf("X-Tamara-Signature"),
    contract: html.indexOf(esc(m.contractTitle)),
  });
  const admin = served(true, { enabled: true, url: MOCK_URL });
  for (const [at, key] of [
    ["toggle", "addressRequired"],
    ["url", "unsafeUrl"],
    ["secret", "generic"],
  ] as const) {
    const html = render(admin, l, { error: { at, key } });
    assert.equal((html.match(/role="alert"/g) ?? []).length, 1, `${l}/${at}: one message`);
    assert.ok(html.includes(`data-error-at="${at}"`), `${l}/${at}: tagged`);
    const p = pos(html);
    if (at === "toggle") assert.ok(p.toggle < p.alert && p.alert < p.url, `${l}: toggle message under the switch`);
    if (at === "url") assert.ok(p.url < p.alert && p.alert < p.secret, `${l}: address message under the field`);
    if (at === "secret") assert.ok(p.secret < p.alert && p.alert < p.secretHelp, `${l}: secret message in the secret block`);
    assert.ok(p.alert < p.contract, `${l}/${at}: never at the bottom`);
  }
  // The address field is marked invalid by its own message only.
  assert.match(render(admin, l, { error: { at: "url", key: "unsafeUrl" } }), /type="url"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(render(admin, l, { error: { at: "toggle", key: "addressRequired" } }), /aria-invalid/);
  // A tenant's messages: under the switch or in the secret block (no address field).
  const tenant = served(false, { enabled: true, url: MOCK_URL });
  for (const at of ["toggle", "secret"] as const) {
    const html = render(tenant, l, { error: { at, key: "unsafeUrlTenant" } });
    const p = pos(html);
    assert.ok(html.includes(esc(m.errors.unsafeUrlTenant)), `${l}/tenant/${at}: shown`);
    assert.ok(at === "toggle" ? p.toggle < p.alert && p.alert < p.secret : p.secret < p.alert && p.alert < p.secretHelp);
  }
  // No shared line left at the bottom of the card.
  const src = read(SECTION);
  assert.doesNotMatch(src, /\{error && \(/, "no single shared error line");
}

console.log("agent-brain-toggle: ok");
