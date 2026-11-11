// Tools brick, "Ask your agent" (T5b): the row exists only when the server
// says visible; test results and refused saves in our words only; the
// signing secret is write-only (shown once, then only "set"). Renders the
// REAL ToolsBrick to static HTML. Mock data only — no network.
// Run with:  npx tsx scripts/tests/tools-brick-client-agent.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { toolsFromTileToggles } from "../../lib/tools/adapters";
import { effectiveCapabilities, publicTools, type Tools } from "../../lib/tools/contract";
import { ToolsBrick } from "../../components/bricks/tools/ToolsBrick";
import {
  activeCount,
  clientAgentRowVisible,
  clientAgentSaveRefusal,
  clientAgentTestBody,
  clientAgentTestWords,
  clientAgentView,
  generateClientAgentSecret,
  SECRET_BYTES,
  secretState,
  toolsSaveBody,
  type ClientAgentRefusal,
  type ScreenTools,
  type ToolsKind,
  type ToolsResponse,
} from "../../components/bricks/tools/tools-ui";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"];
// React escapes ' in text: compare against what it renders.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const URL_OK = "https://agent.example.test/ask";
const SECRET_MOCK = "mock-stored-secret-never-shown";

function stored(over: Partial<Tools["clientAgent"]> = {}): Tools {
  const base = toolsFromTileToggles({ calendar: true, customers: true, orders: false });
  return { ...base, clientAgent: { ...base.clientAgent, ...over } };
}

/** A receptionist answer as GET /api/dashboard/tools returns it (#255). */
function served(visible: boolean | undefined, tools: Tools): ToolsResponse {
  const capabilities = effectiveCapabilities(
    { recipe: "receptionist", tools, clientAgentUrlOk: tools.clientAgent.url.startsWith("https://") },
    { transferNumber: "+15555550100", googleConnected: true, clientAgentEnabled: visible === true },
    DEFAULT_MATRIX.premium,
  );
  return {
    tools: publicTools(tools),
    capabilities,
    account: { googleConnected: true, transferNumberSet: true, transferNumber: "+15555550100" },
    upgrade: {},
    ...(visible === undefined ? {} : { clientAgentTool: { visible } }),
  };
}

function render(
  s: ToolsResponse,
  tools: ScreenTools,
  { locale = "en", kind = "inbound" as ToolsKind, refused = null as ClientAgentRefusal | null } = {},
) {
  const brick = createElement(ToolsBrick, { kind, served: s, tools, onChange: () => {}, returnTo: "/dashboard?tile=tools", clientAgentRefused: refused });
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, brick));
}

const en = messages("en").ToolsBrick;

// 1. visible=false (CLIENT_AGENT unset: the default) → no row at all
{
  for (const v of [false, undefined]) {
    const s = served(v, stored({ enabled: true, url: URL_OK, secret: SECRET_MOCK }));
    assert.equal(clientAgentRowVisible("inbound", s), false);
    const html = render(s, s.tools);
    assert.ok(!html.includes(en.cap.clientAgent.name), `visible=${v}: no row`);
    assert.ok(!html.includes("tools-clientAgent-label") && !html.includes(en.agent.testButton), `visible=${v}: no switch, no test`);
    assert.equal((html.match(/role="switch"/g) ?? []).length, 4, "the four capabilities only");
  }
  assert.equal(clientAgentRowVisible("inbound", null), false, "loading: no row");
  // Never on an outbound agent, even if a server said visible.
  assert.equal(clientAgentRowVisible("outbound", { ...served(true, stored()), outboundTools: { visible: true } }), false);
}

// 2. visible=true → the row, off by default, with its fields; "Not active yet: why" in words
{
  const s = served(true, stored());
  assert.equal(clientAgentRowVisible("inbound", s), true);
  for (const l of LOCALES) {
    const m = messages(l).ToolsBrick;
    const html = render(s, s.tools, { locale: l });
    assert.ok(html.includes(esc(m.cap.clientAgent.name)), `${l}: row name`);
    assert.equal((html.match(/role="switch"/g) ?? []).length, 5, `${l}: one more switch`);
    assert.match(html, /aria-labelledby="tools-clientAgent-label"/);
    assert.ok(html.includes(esc(m.agent.url)) && html.includes('type="url"') && html.includes('dir="ltr"'), `${l}: url field, LTR`);
    for (const mode of ["lead", "voice"]) assert.ok(html.includes(esc(m.agent.modes[mode])), `${l}: mode ${mode}`);
    assert.ok(html.includes(esc(m.agent.testButton)), `${l}: test button`);
    assert.match(html, /role="status" aria-live="polite"/, `${l}: the test result is announced`);
    assert.ok(html.includes(esc(m.agent.secretUnset)), `${l}: not set`);
    assert.ok(html.includes(esc(m.agent.generate)), `${l}: generate`);
  }
  // Switched on without an address: why, in words.
  const on: ScreenTools = { ...s.tools, clientAgent: { ...s.tools.clientAgent, enabled: true } };
  assert.equal(clientAgentView(s, on).status, "pending");
  assert.equal(clientAgentView(s, on).missing, "no_agent_url");
  const html = render(s, on);
  assert.ok(html.includes(esc(en.statusPending)) && html.includes(esc(en.missing.no_agent_url)));
  assert.ok(!html.includes("no_agent_url"), "never the code");
  // Saved with a safe address: active, and the stored values on screen.
  const live = served(true, stored({ enabled: true, url: URL_OK, mode: "voice" }));
  assert.equal(clientAgentView(live, live.tools).status, "on");
  const liveHtml = render(live, live.tools);
  assert.ok(liveHtml.includes(esc(en.cap.clientAgent.on)));
  assert.ok(liveHtml.includes(`value="${URL_OK}"`));
  assert.ok(liveHtml.includes(esc(en.agent.modeHint.voice)));
  // The tile count includes it only where its row is shown.
  const plain = activeCount(served(true, stored()).capabilities);
  assert.equal(activeCount(live.capabilities), plain, "default: plan capabilities only");
  assert.equal(activeCount(live.capabilities, "inbound", true), plain + 1, "row shown and on: counted");
  assert.equal(activeCount(s.capabilities, "inbound", true), plain, "off: not counted");
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /activeCount\(toolsServed\.capabilities, "inbound", clientAgentRowVisible\("inbound", toolsServed\)\)/);
  // "https://" stays left-to-right inside Hebrew sentences.
  assert.match(render(s, s.tools, { locale: "he" }), /<bdi dir="ltr">https:\/\/<\/bdi>/);
}

// 3. Every test reason → our words; nothing the server sent is ever echoed
{
  const cases: Array<[number, unknown, string]> = [
    [200, { ok: true, ms: 412 }, "ok"],
    [200, { ok: false, reason: "blocked_address" }, "blocked_address"],
    [200, { ok: false, reason: "timeout" }, "timeout"],
    [200, { ok: false, reason: "http_status" }, "http_status"],
    [200, { ok: false, reason: "bad_shape" }, "bad_shape"],
    [200, { ok: false, reason: "too_large" }, "too_large"],
    [200, { ok: false, reason: "network" }, "network"],
    [200, { ok: false, reason: "no_agent_url" }, "no_agent_url"],
    [429, { error: "rate_limited" }, "rateLimited"],
    [403, { error: "client_agent_disabled" }, "disabled"],
    // Anything else → generic, never the server's words.
    [200, { ok: false, reason: "10.0.0.7 refused" }, "generic"],
    [200, { ok: false, reason: "<html>500 Internal</html>" }, "generic"],
    [200, { ok: true, ms: "fast" }, "generic"],
    [500, { error: "boom", reason: "timeout" }, "generic"],
    [400, { error: "invalid_body" }, "generic"],
    [200, null, "generic"],
  ];
  for (const [status, body, key] of cases) assert.equal(clientAgentTestWords(status, body).key, key, JSON.stringify(body));
  assert.deepEqual(clientAgentTestWords(200, { ok: true, ms: 411.6 }), { key: "ok", ms: 412 });
  for (const l of LOCALES) {
    const test = messages(l).ToolsBrick.agent.test as Record<string, string>;
    for (const k of ["ok", "blocked_address", "timeout", "http_status", "bad_shape", "too_large", "network", "no_agent_url", "rateLimited", "disabled", "generic"]) {
      assert.equal(typeof test[k], "string", `${l}: test.${k}`);
      // Calm words: no status number, no code, no address.
      assert.doesNotMatch(test[k], /\b[45]\d\d\b|_|\d+\.\d+\.\d+\.\d+/, `${l}: test.${k}`);
    }
    assert.match(test.ok, /\{ms\}/, `${l}: ok shows the time`);
    assert.match(test.timeout, /2[.,]5/, `${l}: timeout says 2.5 s`);
  }
}

// 4. The secret: generated in the browser, ≥ 32 bytes, base64url; never rendered after save
{
  assert.ok(SECRET_BYTES >= 32);
  let asked = 0;
  const fixed = generateClientAgentSecret((b) => {
    asked = b.length;
    return b.fill(0xfb);
  });
  assert.equal(asked, 32, "asks for 32 random bytes");
  assert.equal(Buffer.from(fixed, "base64url").length, 32, "decodes back to 32 bytes");
  assert.match(fixed, /^[A-Za-z0-9_-]{43}$/, "base64url, no padding");
  // Real randomness (Web Crypto): distinct each time.
  const a = generateClientAgentSecret();
  const b = generateClientAgentSecret();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, "base64url").length, 32);
  assert.ok(new Set(a).size > 10, "not a constant");

  // Stored secret: only "set", never the value (the server never sends it anyway).
  const s = served(true, stored({ url: URL_OK, secret: SECRET_MOCK }));
  assert.equal(JSON.stringify(s).includes(SECRET_MOCK), false, "publicTools strips it");
  assert.equal(secretState(s.tools), "set");
  for (const l of LOCALES) {
    const m = messages(l).ToolsBrick.agent;
    const html = render(s, s.tools, { locale: l });
    assert.ok(html.includes(esc(m.secretSet)), `${l}: "set"`);
    assert.ok(html.includes(esc(m.regenerate)) && html.includes(esc(m.remove)), `${l}: regenerate + remove`);
    assert.ok(!html.includes(esc(m.copyNow)), `${l}: no one-time box`);
  }
  // Generated, before the save: shown once, with the warning.
  const fresh = generateClientAgentSecret();
  const unsaved: ScreenTools = { ...s.tools, clientAgent: { ...s.tools.clientAgent, secret: fresh } };
  assert.equal(secretState(unsaved), "new");
  const once = render(s, unsaved);
  assert.ok(once.includes(fresh), "shown once");
  assert.ok(once.includes(esc(en.agent.copyNow)) && once.includes(esc(en.agent.copy)));
  // After the save (or a reload) the screen holds the server's answer: gone, "set".
  const after = served(true, stored({ url: URL_OK, secret: fresh }));
  const saved = render(after, after.tools);
  assert.ok(!saved.includes(fresh), "never rendered after save");
  assert.ok(saved.includes(esc(en.agent.secretSet)));
  // Removal pending.
  const removing: ScreenTools = { ...s.tools, clientAgent: { ...s.tools.clientAgent, secret: null } };
  assert.equal(secretState(removing), "removing");
  assert.ok(render(s, removing).includes(esc(en.agent.secretRemoving)));
  assert.equal(secretState(served(true, stored()).tools), "unset");
  // Regenerating asks first (the confirmation copy exists in every language).
  for (const l of LOCALES) assert.ok(messages(l).ToolsBrick.agent.confirmRegenerate.length > 20, l);
  const brick = read("components/bricks/tools/ToolsBrick.tsx");
  assert.match(brick, /secret === "set" \? setConfirming\(true\) : generate\(\)/, "regenerate → confirm");
  // Never logged.
  assert.doesNotMatch(brick, /console\./, "no logging in the brick");
}

// 5. The save body: `secret` only when generated or removed; `enabled` whenever clientAgent is touched
{
  const base = served(true, stored({ url: URL_OK, secret: SECRET_MOCK })).tools;
  assert.deepEqual(toolsSaveBody(base, structuredClone(base)), {}, "nothing changed → nothing sent");
  // Only the url changed: no secret, but the current switch rides along.
  const url = toolsSaveBody(base, { ...base, clientAgent: { ...base.clientAgent, url: "https://other.example.test/a" } });
  assert.deepEqual(url, { clientAgent: { url: "https://other.example.test/a", enabled: false } });
  assert.ok(!("secret" in (url.clientAgent as object)));
  // Only the mode changed.
  assert.deepEqual(toolsSaveBody(base, { ...base, clientAgent: { ...base.clientAgent, mode: "voice" } }), {
    clientAgent: { mode: "voice", enabled: false },
  });
  // Switch on.
  assert.deepEqual(toolsSaveBody(base, { ...base, clientAgent: { ...base.clientAgent, enabled: true } }), { clientAgent: { enabled: true } });
  // Generated → sent once, with enabled.
  const g = generateClientAgentSecret();
  const on = { ...base, clientAgent: { ...base.clientAgent, enabled: true } };
  assert.deepEqual(toolsSaveBody(on, { ...on, clientAgent: { ...on.clientAgent, secret: g } }), { clientAgent: { secret: g, enabled: true } });
  // Removed → null, with enabled.
  assert.deepEqual(toolsSaveBody(base, { ...base, clientAgent: { ...base.clientAgent, secret: null } }), {
    clientAgent: { secret: null, enabled: false },
  });
  // Other capabilities: unchanged behaviour, no clientAgent key.
  assert.deepEqual(toolsSaveBody(base, { ...base, orders: { ...base.orders, enabled: true } }), { orders: { enabled: true } });
  // The page's save uses it.
  assert.match(read("app/[locale]/dashboard/config-form.tsx"), /const tchanges = toolsSaveBody\(toolsBase, tools\)/);

  // The test request: the unsaved address; the secret only when generated / removed.
  assert.deepEqual(clientAgentTestBody({ ...base, clientAgent: { ...base.clientAgent, url: "  https://x.example.test/a " } }), { url: "https://x.example.test/a" });
  assert.deepEqual(clientAgentTestBody({ ...base, clientAgent: { ...base.clientAgent, secret: g } }), { url: URL_OK, secret: g });
  assert.deepEqual(clientAgentTestBody({ ...base, clientAgent: { ...base.clientAgent, secret: null } }), { url: URL_OK, secret: null });
}

// 6. Refused saves → our words next to the row, never the server's code or message
{
  assert.equal(clientAgentSaveRefusal(403, { error: "client_agent_disabled", fields: ["tools.clientAgent.enabled"] }), "disabled");
  assert.equal(clientAgentSaveRefusal(400, { error: "unsafe_url", message: "server words", fields: ["tools.clientAgent.url"] }), "unsafeUrl");
  assert.equal(clientAgentSaveRefusal(403, { error: "outbound_tools_disabled" }), null);
  assert.equal(clientAgentSaveRefusal(400, { error: "invalid_tools" }), null);
  assert.equal(clientAgentSaveRefusal(500, null), null);
  const s = served(true, stored({ url: "https://10.0.0.1/x" }));
  for (const l of LOCALES) {
    const m = messages(l).ToolsBrick.agent;
    const unsafe = render(s, s.tools, { locale: l, refused: "unsafeUrl" });
    assert.match(unsafe, /role="alert"/);
    assert.ok(unsafe.includes(esc(m.refused.unsafeUrl.split("<l>")[0])), `${l}: unsafe words`);
    assert.match(unsafe, /aria-invalid="true"/);
    const off = render(s, s.tools, { locale: l, refused: "disabled" });
    assert.ok(off.includes(esc(m.refused.disabled)), `${l}: disabled words`);
    for (const html of [unsafe, off]) assert.ok(!/unsafe_url|client_agent_disabled|server words/.test(html), `${l}: never the code`);
  }
}

// 7. Tenant safety: no supplier word in the new copy; brand rule (no pink→cyan gradient)
{
  for (const l of LOCALES) {
    const tb = messages(l).ToolsBrick;
    const copy = JSON.stringify([tb.cap.clientAgent, tb.agent, tb.missing.client_agent_disabled, tb.missing.no_agent_url]);
    assert.doesNotMatch(copy, /openai|grok|gemini|xai|realtime|webhook|hmac|ssrf/i, l);
  }
  const brick = read("components/bricks/tools/ToolsBrick.tsx");
  assert.doesNotMatch(brick, /from-\[#(?:be185d|db2777|ec4899)\][^"]*to-\[#(?:0e7490|06b6d4|67e8f9|22d3ee)\]/, "no pink→cyan gradient");
}

console.log("ALL TOOLS-BRICK CLIENT AGENT TESTS PASSED");
