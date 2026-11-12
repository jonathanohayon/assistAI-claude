// The agent URL card shows the URL ONCE: the token is stored hashed, the GET
// returns { exists, createdAt, hint } only, the POST is the only response that
// carries the token (app/api/dashboard/agent-url/route.ts).
// Drives the real reducer and fetch helpers with a mocked fetch, then renders
// the real view to static HTML in fr/en/he. Mock tokens only.
// Run with:  npx tsx scripts/tests/agent-url-once.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentUrlCardGate,
  AgentUrlView,
  agentUrlReducer,
  fetchAgentUrlStatus,
  initialAgentUrlState,
  postAgentUrl,
  type AgentUrlState,
} from "../../app/[locale]/dashboard/settings/agent-url-section";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ORIGIN = "https://app.tamara.example";
const TOKEN_A = "agt_mock0000aaaaaaaaaaaaaaaaaaaaaaaa1a2b";
const TOKEN_B = "agt_mock0000bbbbbbbbbbbbbbbbbbbbbbbb3c4d";
const CREATED = "2026-11-12T09:00:00.000Z";
const HINT_A = "agt_…1a2b";
const HINT_B = "agt_…3c4d";

// --- mocked fetch ----------------------------------------------------------

type Call = { url: string; method: string };
function mockFetch(routes: Record<string, { ok?: boolean; body: unknown } | "throw">) {
  const calls: Call[] = [];
  const f = async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const r = routes[method];
    if (!r || r === "throw") throw new Error("network down");
    return { ok: r.ok ?? true, json: async () => r.body };
  };
  return { f, calls };
}

const NOOP = () => {};
const render = (locale: string, state: AgentUrlState) =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: messages(locale),
        timeZone: "UTC",
        onError: (e: Error) => {
          throw e;
        },
      } as unknown as ProviderProps,
      createElement(AgentUrlView, {
        state,
        origin: ORIGIN,
        copied: false,
        onCreate: NOOP,
        onAskRegenerate: NOOP,
        onCancelRegenerate: NOOP,
        onConfirmRegenerate: NOOP,
        onCopy: NOOP,
        onRetry: NOOP,
      }),
    ),
  );
const renderGate = (locale: string, isAdmin: boolean, developerMode: boolean) =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(AgentUrlCardGate, { isAdmin, developerMode }),
    ),
  );

const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const noToken = (html: string, label: string) => {
  assert.ok(!html.includes("agt_mock"), `${label}: no token in the markup`);
  assert.ok(!html.includes("/api/v1/agent/"), `${label}: no agent URL in the markup`);
};

async function main() {
  // 1. exists:false -> Create (one sentence + button), then POST reveals once.
  {
    const get = mockFetch({ GET: { body: { exists: false, createdAt: null, hint: null } } });
    const status = await fetchAgentUrlStatus(get.f);
    assert.deepEqual(status, { exists: false, createdAt: null, hint: null });
    assert.deepEqual(get.calls, [{ url: "/api/dashboard/agent-url", method: "GET" }], "GET only, never a POST on load");
    const empty = agentUrlReducer(initialAgentUrlState, { type: "loaded", status: status! });

    for (const l of LOCALES) {
      const m = messages(l).AgentUrl;
      const html = render(l, empty);
      assert.ok(html.includes(esc(m.emptyText)), `${l}: empty sentence`);
      assert.ok(html.includes(`>${esc(m.create)}</button>`), `${l}: Create button`);
      assert.ok(!html.includes(`>${esc(m.rotate)}</button>`), `${l}: no Regenerate when nothing exists`);
      noToken(html, `${l} empty`);
    }

    // Create needs no confirm: askRegenerate is a no-op without a URL.
    assert.equal(agentUrlReducer(empty, { type: "askRegenerate" }), empty, "no confirm on create");

    const post = mockFetch({ POST: { body: { token: TOKEN_A, exists: true, createdAt: CREATED, hint: HINT_A } } });
    const r = await postAgentUrl(post.f);
    assert.deepEqual(post.calls, [{ url: "/api/dashboard/agent-url", method: "POST" }]);
    assert.ok(r && r.token === TOKEN_A);
    const created = agentUrlReducer(agentUrlReducer(empty, { type: "submit" }), { type: "created", ...r! });

    // 2. After POST the URL is shown exactly once, LTR mono, with Copy + warning.
    for (const l of LOCALES) {
      const m = messages(l).AgentUrl;
      const html = render(l, created);
      const url = `${ORIGIN}/api/v1/agent/${TOKEN_A}`;
      assert.equal(count(html, url), 1, `${l}: the URL once`);
      assert.equal(count(html, TOKEN_A), 1, `${l}: the token once (not in the contract sample)`);
      assert.match(html, new RegExp(`<code dir="ltr" data-agent-url-once="" class="[^"]*font-mono[^"]*">${url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}</code>`), `${l}: ltr mono field`);
      assert.ok(html.includes(esc(m.onceWarning)), `${l}: won't be shown again`);
      assert.ok(html.includes(`>${esc(m.copy)}</button>`), `${l}: Copy button`);
      const pre = html.slice(html.indexOf("<pre"), html.indexOf("</pre>"));
      assert.ok(pre.includes(esc(m.urlPlaceholder)) && !pre.includes("agt_"), `${l}: sample keeps the placeholder`);
    }
  }

  // 3. exists:true after a reload: hint + date, no token anywhere.
  const active = agentUrlReducer(initialAgentUrlState, {
    type: "loaded",
    status: (await fetchAgentUrlStatus(mockFetch({ GET: { body: { exists: true, createdAt: CREATED, hint: HINT_A } } }).f))!,
  });
  assert.equal(active.revealed, null, "a reload has nothing to reveal");
  const DATE = { fr: "12 nov. 2026", en: "Nov 12, 2026", he: "12 בנוב׳ 2026" } as const;
  for (const l of LOCALES) {
    const m = messages(l).AgentUrl;
    const html = render(l, active);
    assert.match(html, new RegExp(`<span dir="ltr" class="[^"]*font-mono[^"]*">${HINT_A}</span>`), `${l}: hint ltr mono`);
    assert.ok(html.includes(esc(m.activeSince.replace("{date}", DATE[l]))), `${l}: active since ${DATE[l]}`);
    assert.ok(html.includes(`>${esc(m.rotate)}</button>`), `${l}: Regenerate button`);
    assert.ok(!html.includes(esc(m.create)) && !html.includes(esc(m.onceWarning)), `${l}: no create, no once-view`);
    noToken(html, `${l} active`);
  }

  // 4. Regenerate requires the confirm; confirming POSTs and shows the new URL once.
  {
    const confirming = agentUrlReducer(active, { type: "askRegenerate" });
    assert.equal(confirming.confirming, true);
    assert.equal(confirming.busy, false, "asking does not POST");
    for (const l of LOCALES) {
      const m = messages(l).AgentUrl;
      const html = render(l, confirming);
      assert.ok(html.includes(esc(m.confirmBody)), `${l}: confirm says the old URL stops working`);
      assert.ok(html.includes(`>${esc(m.confirmYes)}</button>`) && html.includes(`>${esc(m.cancel)}</button>`), `${l}: confirm buttons`);
      assert.match(html, /role="group" aria-labelledby="agent-url-confirm-title" aria-describedby="agent-url-confirm-body"/, `${l}: labelled confirm`);
      assert.ok(!html.includes(`>${esc(m.rotate)}</button>`), `${l}: Regenerate hidden while confirming`);
      noToken(html, `${l} confirm`);
    }
    // Cancel (button or Escape) goes back without a POST.
    assert.deepEqual(agentUrlReducer(confirming, { type: "cancelRegenerate" }), active);

    const post = mockFetch({ POST: { body: { token: TOKEN_B, exists: true, createdAt: CREATED, hint: HINT_B } } });
    const r = (await postAgentUrl(post.f))!;
    const regenerated = agentUrlReducer(agentUrlReducer(confirming, { type: "submit" }), { type: "created", ...r });
    assert.equal(regenerated.confirming, false);
    const html = render("fr", regenerated);
    assert.equal(count(html, TOKEN_B), 1, "new URL once");
    assert.ok(html.includes(HINT_B) && !html.includes(HINT_A), "hint follows the new token");
  }

  // 5. Errors: our words only, never server text; GET/POST failures.
  {
    const SERVER = "relation agent_tokens does not exist";
    assert.equal(await fetchAgentUrlStatus(mockFetch({ GET: { ok: false, body: { error: SERVER } } }).f), null);
    assert.equal(await fetchAgentUrlStatus(mockFetch({ GET: { ok: false, body: { error: "Unauthorized" } } }).f), null, "401");
    assert.equal(await fetchAgentUrlStatus(mockFetch({ GET: "throw" }).f), null);
    assert.equal(await fetchAgentUrlStatus(mockFetch({ GET: { body: { token: TOKEN_A } } }).f), null, "unexpected shape");
    assert.equal(await postAgentUrl(mockFetch({ POST: { ok: false, body: { error: SERVER } } }).f), null);
    assert.equal(await postAgentUrl(mockFetch({ POST: { body: { exists: true, createdAt: CREATED, hint: HINT_A } } }).f), null, "no token");
    assert.equal(await postAgentUrl(mockFetch({ POST: "throw" }).f), null);

    const loadErr = agentUrlReducer(initialAgentUrlState, { type: "loadFailed" });
    const createErr = agentUrlReducer(agentUrlReducer(agentUrlReducer(initialAgentUrlState, { type: "loaded", status: { exists: false, createdAt: null, hint: null } }), { type: "submit" }), { type: "createFailed" });
    const regenErr = agentUrlReducer(agentUrlReducer(agentUrlReducer(active, { type: "askRegenerate" }), { type: "submit" }), { type: "createFailed" });
    for (const l of LOCALES) {
      const m = messages(l).AgentUrl;
      const a = render(l, loadErr);
      assert.ok(a.includes(`role="alert"`) && a.includes(esc(m.errorLoad)) && a.includes(`>${esc(m.retry)}</button>`), `${l}: load error`);
      assert.ok(render(l, createErr).includes(esc(m.errorCreate)), `${l}: create error`);
      const b = render(l, regenErr);
      assert.ok(b.includes(esc(m.errorRegenerate)) && !b.includes(esc(m.confirmBody)), `${l}: regenerate error closes the confirm`);
      for (const h of [a, b]) assert.ok(!h.includes(SERVER) && !h.includes("Unauthorized"), `${l}: no server text`);
    }
  }

  // 6. Same AgentUrl keys in fr, en and he; Hebrew is Hebrew.
  {
    const keys = Object.keys(messages("fr").AgentUrl).sort();
    for (const k of ["loading", "emptyText", "create", "activeSince", "onceWarning", "confirmTitle", "confirmBody", "confirmYes", "cancel", "errorLoad", "errorCreate", "errorRegenerate", "retry"])
      assert.ok(keys.includes(k), `fr.${k}`);
    for (const l of ["en", "he"]) {
      const m = messages(l).AgentUrl;
      assert.deepEqual(Object.keys(m).sort(), keys, `${l}: same AgentUrl keys as fr`);
      for (const k of keys) assert.ok(typeof m[k] === "string" && m[k].trim() !== "", `${l}.${k}: non-empty`);
    }
    for (const l of LOCALES) assert.ok(messages(l).AgentUrl.activeSince.includes("{date}"), `${l}: activeSince takes {date}`);
    for (const k of keys.filter((k) => k !== "urlPlaceholder"))
      assert.match(messages("he").AgentUrl[k], /[֐-׿]/, `he.${k}: Hebrew`);
    const he = render("he", active);
    for (const fr of ["Active depuis", "Régénérer", "Contrat attendu"]) assert.ok(!he.includes(esc(fr)), `he: no French "${fr}"`);
  }

  // 7. The gate is unchanged: same rule, same fetch-behind-the-gate layout.
  {
    for (const l of LOCALES) {
      const m = messages(l).AgentUrl;
      assert.equal(renderGate(l, false, false), "", `${l}: tenant, developer mode off -> nothing`);
      for (const [isAdmin, dev] of [[false, true], [true, false], [true, true]] as const) {
        const html = renderGate(l, isAdmin, dev);
        assert.ok(html.includes(esc(m.title)) && html.includes(esc(m.loading)), `${l} admin=${isAdmin} dev=${dev}: card, loading`);
        noToken(html, `${l} gate`);
      }
    }
    const src = read("app/[locale]/dashboard/settings/agent-url-section.tsx");
    const gateStart = src.indexOf("export function AgentUrlCardGate");
    const sectionStart = src.indexOf("export function AgentUrlSection");
    const outer = src.slice(0, src.indexOf("// State (pure"));
    assert.ok(gateStart > 0 && sectionStart > gateStart, "gate before the section");
    assert.doesNotMatch(outer, /fetch\(/, "no fetch in the card or its gate");
    assert.match(outer, /showLevel3\(\{ isAdmin, developerMode \}\)/, "gate uses the shared level-3 rule");
    assert.match(outer, /useDeveloperMode\(\)/, "card reads developer mode");
    assert.match(outer.slice(gateStart), /return null;[\s\S]*<AgentUrlSection \/>/, "section only past the gate");
    // The token never goes to browser storage.
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/, "no browser storage");
    // No browser dialogs for the confirm.
    assert.doesNotMatch(src, /\b(window\.)?(confirm|alert|prompt)\(/, "no browser dialogs");
    // Escape cancels the confirm.
    assert.match(src, /e\.key === "Escape"[\s\S]{0,80}onCancelRegenerate\(\)/, "Escape cancels");
  }

  console.log("agent-url-once: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
