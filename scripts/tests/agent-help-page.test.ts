// The agent help page (/dashboard/agent/help, "Comment obtenir l'adresse de
// votre agent"): renders in fr/en/he whatever the switches; every contract
// fact on it comes from the request's own code (lib/tools/client-agent-test.ts),
// checked here against what runClientAgentTest REALLY sends (a fake fetch
// captures it); the example body has exactly the contract's fields; the
// "Votre agent IA" card links to it, the read-only preview included (what a
// customer sees with CLIENT_AGENT unset). Mock data only, no network.
// Run with:  npx tsx scripts/tests/agent-help-page.test.ts

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentHelpView } from "../../app/[locale]/dashboard/agent/help/help-view";
import { agentHelpLinks, agentHelpRequests, tenantHelpUrl } from "../../components/agent-help/links";
import { AGENT_CARD_HREF, AgentHelpTestView, loadHelpTestState, runHelpTest } from "../../components/agent-help/AgentHelpTest";
import { AGENT_HELP_HREF, ClientAgentRow } from "../../components/bricks/client-agent/ClientAgentBrick";
import { ConnectPreview } from "../../components/preview/ConnectPreview";
import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { toolsFromTileToggles } from "../../lib/tools/adapters";
import {
  CLIENT_AGENT_REQUEST_FIELDS,
  EXAMPLE_AGENT_URL,
  WORKER_HISTORY_TURNS,
  WORKER_STALL_MS,
  WORKER_VOICE_BUDGET_MS,
  exampleRequestBody,
  exampleRequestText,
  exampleResponseText,
  exampleServerText,
} from "../../lib/tools/client-agent-help";
import {
  CLIENT_AGENT_SIGNATURE_HEADER,
  CLIENT_AGENT_TEST_BUDGET_MS,
  CLIENT_AGENT_TEST_MAX_BYTES,
  CLIENT_AGENT_TEST_QUESTIONS,
  clientAgentTestQuestion,
  CLIENT_AGENT_USER_AGENT,
  runClientAgentTest,
  type TestFetch,
} from "../../lib/tools/client-agent-test";
import { effectiveCapabilities, publicTools, type Tools } from "../../lib/tools/contract";
import type { ToolsResponse } from "../../components/bricks/tools/tools-ui";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;
const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const wrap = (locale: string, el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps, el));
const page = (locale: string, testOpen: boolean, testLanguage: string | null = locale) =>
  wrap(locale, createElement(AgentHelpView, { locale, testOpen, testLanguage }));
const words = (m: { AgentHelp: { example: Record<string, string> } }) => ({
  question: m.AgentHelp.example.question,
  callerSaid: m.AgentHelp.example.callerSaid,
  prevUser: m.AgentHelp.example.prevUser,
  prevAgent: m.AgentHelp.example.prevAgent,
  answer: m.AgentHelp.example.answer,
});

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

// What the code REALLY sends, captured once (mock address, mock secret).
const SECRET = "mock-secret-for-tests";
let sent: { url: string; headers: Record<string, string>; body: string; timeoutMs: number; maxBytes: number } | null = null;
const fakeFetch: TestFetch = async (url, init, opts) => {
  sent = { url, headers: init.headers as Record<string, string>, body: String(init.body), timeoutMs: opts.timeoutMs!, maxBytes: opts.maxBytes! };
  return { status: 200, headers: new Headers(), body: Buffer.from(JSON.stringify({ answer: "ok" })) } as never;
};

async function main() {
  const r = await runClientAgentTest({ url: EXAMPLE_AGENT_URL, secret: SECRET, language: "fr" }, { fetch: fakeFetch });
  assert.equal(r.ok, true);
  const real = sent!;
  const realBody = JSON.parse(real.body) as Record<string, unknown>;

  await test("fields: the page's list is exactly the body the code sends, same order", () => {
    assert.deepEqual([...CLIENT_AGENT_REQUEST_FIELDS], Object.keys(realBody));
  });

  await test("header name, user agent, algorithm: what the code sends", () => {
    assert.equal(real.headers[CLIENT_AGENT_SIGNATURE_HEADER], createHmac("sha256", SECRET).update(real.body).digest("hex"));
    assert.equal(real.headers["User-Agent"], CLIENT_AGENT_USER_AGENT);
    assert.equal(real.headers["Content-Type"], "application/json");
  });

  await test("time limit and size limit: what the code passes to the fetch", () => {
    assert.equal(real.timeoutMs, CLIENT_AGENT_TEST_BUDGET_MS);
    assert.equal(real.maxBytes, CLIENT_AGENT_TEST_MAX_BYTES);
  });

  for (const l of LOCALES) {
    const m = messages(l);
    const w = words(m);
    await test(`${l}: the example request body has exactly the contract's fields`, () => {
      const body = exampleRequestBody(l, w);
      assert.deepEqual(Object.keys(body), Object.keys(realBody));
      // And the text block shows that same body after its headers.
      const text = exampleRequestText(l, w);
      const json = JSON.parse(text.slice(text.indexOf("\n\n") + 2));
      assert.deepEqual(Object.keys(json), Object.keys(realBody));
      assert.match(text, new RegExp(`^POST ${EXAMPLE_AGENT_URL.replace(/\./g, "\\.")}\\n`));
      assert.ok(text.includes(`${CLIENT_AGENT_SIGNATURE_HEADER}: `));
      assert.equal(json.language, l);
      assert.match(String(json.call_id), /^[0-9a-f]{16}$/, "mock call id in the real format");
      // The answer block parses and carries `answer`; the server reads the lowercased header.
      const resp = exampleResponseText(w);
      assert.equal(JSON.parse(resp.slice(resp.indexOf("\n\n") + 2)).answer, w.answer);
      const server = exampleServerText(w);
      assert.ok(server.includes(`req.headers["${CLIENT_AGENT_SIGNATURE_HEADER.toLowerCase()}"]`));
      assert.ok(server.includes('createHmac("sha256", SECRET).update(raw).digest("hex")'));
      assert.ok(server.includes("JSON.stringify({ answer })"));
      // Placeholders only: the one address is the .test one.
      for (const u of `${text}\n${server}`.match(/https?:\/\/[^\s"]+/g) ?? []) assert.equal(u, EXAMPLE_AGENT_URL);
    });

    for (const open of [false, true]) {
      await test(`${l}: renders every section (test ${open ? "open" : "closed"})`, () => {
        const html = page(l, open);
        assert.ok(html.includes(esc(m.AgentHelp.title)));
        for (const k of ["what", "contract", "example", "test", "none"]) assert.ok(html.includes(esc(m.AgentHelp[k].title)), `${k} section`);
        for (const f of CLIENT_AGENT_REQUEST_FIELDS) assert.ok(html.includes(`data-field="${f}"`), `field ${f}`);
        assert.equal((html.match(/data-field="/g) ?? []).length, CLIENT_AGENT_REQUEST_FIELDS.length, "no extra field");
        assert.equal((html.match(/data-copy-block/g) ?? []).length, 3, "three copy blocks");
        assert.equal((html.match(new RegExp(`>${esc(m.AgentHelp.copy)}<`, "g")) ?? []).length, 3, "a copy button per block");
        for (const pre of html.match(/<pre[^>]*>/g) ?? []) {
          assert.match(pre, /dir="ltr"/);
          assert.match(pre, /scroll-shadow-x/);
          assert.match(pre, /scroll-visible/);
          assert.match(pre, /overflow-x-auto/);
        }
        // Facts from the constants.
        const num = new Intl.NumberFormat(l === "he" ? "he-IL" : l === "en" ? "en-US" : "fr-FR");
        const time = m.AgentHelp.contract.time
          .replace("{seconds}", num.format(CLIENT_AGENT_TEST_BUDGET_MS / 1000))
          .replace("{voiceSeconds}", num.format(WORKER_VOICE_BUDGET_MS / 1000))
          .replace("{stall}", num.format(WORKER_STALL_MS / 1000));
        assert.ok(html.includes(esc(time)), "time limits from the constants");
        if (l === "fr") assert.ok(html.includes("en mode voix seule, 2 s"), "voice limit wording");
        // The speech note: one sentence, right after the fields.
        assert.equal(typeof m.AgentHelp.contract.speechNote, "string");
        assert.equal(m.AgentHelp.contract.speechNote.split(/[.?!](\s|$)/).filter((x: string) => x.trim()).length, 1, "one sentence");
        const note = html.indexOf(esc(m.AgentHelp.contract.speechNote));
        assert.ok(note > html.lastIndexOf('data-field="') && note < html.indexOf(esc(m.AgentHelp.contract.responseTitle)), "speech note under the fields");
        assert.ok(html.includes(esc(m.AgentHelp.contract.fields.history.split("{turns}")[0]) + WORKER_HISTORY_TURNS), "history cap from the constant");
        assert.ok(html.includes(`>${CLIENT_AGENT_SIGNATURE_HEADER}</code>`), "header name from the constant");
        assert.ok(html.includes(`User-Agent: ${CLIENT_AGENT_USER_AGENT}`));
        assert.ok(html.includes(`${CLIENT_AGENT_TEST_MAX_BYTES / 1024} `), "size limit from the constant");
        // The trial question in the account's language (here = the page's), with its own direction.
        assert.ok(html.includes(`<bdi dir="auto" data-test-question="true">${esc(clientAgentTestQuestion(l))}</bdi>`), "the trial question");
        // Every request is signed: no "if a secret is set" left in the contract (#439).
        assert.ok(html.includes(esc(m.AgentHelp.contract.signature.split("<c>")[0])), "signature paragraph");
        // Both modes, labelled as on the card.
        for (const mode of ["lead", "voice"]) assert.ok(html.includes(esc(m.ToolsBrick.agent.modes[mode])), mode);
        // Test area: closed = the line and the card link, no button.
        if (!open) {
          assert.ok(html.includes('data-help-test="closed"'));
          assert.ok(!html.includes(esc(m.AgentHelp.test.button) + "</button>"));
        }
        assert.ok(html.includes(`href="/${l}/dashboard/agent"`), "back link");
      });
    }

    await test(`${l}: test area states`, () => {
      const closed = wrap(l, createElement(AgentHelpTestView, { state: "closed", test: null }));
      const noUrl = wrap(l, createElement(AgentHelpTestView, { state: "noUrl", test: null }));
      const ready = wrap(l, createElement(AgentHelpTestView, { state: "ready", test: { key: "timeout" } }));
      for (const h of [closed, noUrl, ready]) assert.ok(h.includes(`href="/${l}${AGENT_CARD_HREF}"`), "card link");
      assert.ok(closed.includes(esc(m.AgentHelp.test.closed)));
      assert.ok(noUrl.includes(esc(m.AgentHelp.test.noUrl.replace("{card}", m.ClientAgentBrick.title))));
      assert.ok(ready.includes(`>${esc(m.AgentHelp.test.button)}</button>`));
      // The brick's own words for a result.
      assert.ok(ready.includes(esc(m.ToolsBrick.agent.test.timeout)));
    });

    await test(`${l}: inline code stays left-to-right (RTL prose in he)`, () => {
      const html = page(l, false);
      for (const c of html.match(/<code[^>]*>/g) ?? []) if (!/<pre/.test(c)) assert.ok(/dir="ltr"/.test(c) || c === "<code>", `inline code ltr: ${c}`);
    });
  }

  // The worker's CALL values (repo assistAI-claude-agent, main 6998aa0). Not
  // importable from web: pinned here by value, each with its worker file:line.
  await test("worker values the page shows (main 6998aa0)", () => {
    // src/brain-mode.ts:42 CLIENT_AGENT_VOICE_BUDGET_MS = TURN_BUDGET_MS; src/agent-webhook.ts:29 TURN_BUDGET_MS = 2000
    assert.equal(WORKER_VOICE_BUDGET_MS, 2000);
    // src/client-agent.ts:28 CLIENT_AGENT_HISTORY_TURNS = 6 (history.slice(-6) at :70)
    assert.equal(WORKER_HISTORY_TURNS, 6);
    // src/client-agent.ts:26 CLIENT_AGENT_STALL_MS = 700
    assert.equal(WORKER_STALL_MS, 700);
    // src/client-agent.ts:24 CLIENT_AGENT_BUDGET_MS = 2500: the lead budget is the web test's
    assert.equal(CLIENT_AGENT_TEST_BUDGET_MS, 2500);
    // src/net/agent-post.ts:25 MAX_RESPONSE_BYTES = 64 * 1024: the call's size limit is the web test's
    assert.equal(CLIENT_AGENT_TEST_MAX_BYTES, 64 * 1024);
  });

  // Admin tenant view (H1): the help page tests the tenant viewed, never the admin.
  const TENANT = "11111111-2222-4333-8444-555555555555";
  await test("help requests carry asUserId only when given", () => {
    assert.deepEqual(agentHelpRequests(null), { load: "/api/dashboard/tools", test: "/api/dashboard/tools/client-agent/test" });
    assert.deepEqual(agentHelpRequests(undefined), agentHelpRequests(null));
    assert.deepEqual(agentHelpRequests(TENANT), {
      load: `/api/dashboard/tools?asUserId=${TENANT}`,
      test: `/api/dashboard/tools/client-agent/test?asUserId=${TENANT}`,
    });
  });
  await test("the help test's real requests: asUserId on the admin route only", async () => {
    const seen: { url: string; method: string; body: unknown }[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method ?? "GET", body: init?.body });
      const payload = url.includes("/client-agent/test")
        ? { ok: true, ms: 120 }
        : { clientAgentTool: { visible: true }, tools: { clientAgent: { url: "https://agent.example.test/ask" } } };
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    // Tenant (own account): no asUserId anywhere.
    assert.equal(await loadHelpTestState(null, fake), "ready");
    assert.deepEqual(await runHelpTest(null, fake), { key: "ok", ms: 120 });
    // Admin route: both requests carry the tenant viewed.
    assert.equal(await loadHelpTestState(TENANT, fake), "ready");
    await runHelpTest(TENANT, fake);
    assert.deepEqual(
      seen.map((s) => `${s.method} ${s.url}`),
      [
        "GET /api/dashboard/tools",
        "POST /api/dashboard/tools/client-agent/test",
        `GET /api/dashboard/tools?asUserId=${TENANT}`,
        `POST /api/dashboard/tools/client-agent/test?asUserId=${TENANT}`,
      ],
    );
    // The test sends no url/secret: the SAVED address of the account shown.
    assert.ok(seen.filter((s) => s.method === "POST").every((s) => s.body === "{}"));
    // The component passes its asUserId to both (effects don't run in a static render).
    const src = read("components/agent-help/AgentHelpTest.tsx");
    assert.match(src, /loadHelpTestState\(asUserId, fetch, ctrl\.signal\)/);
    assert.match(src, /runHelpTest\(asUserId\)/);
    assert.doesNotMatch(src, /fetch\("\/api/, "no request built without the account");
  });
  await test("only the admin route passes asUserId; the tenant page can't", () => {
    // Tenant page: no query read, no asUserId: a ?asUserId in its URL is ignored.
    const tenantPage = read("app/[locale]/dashboard/agent/help/page.tsx");
    assert.doesNotMatch(tenantPage, /searchParams|asUserId/);
    // Admin route: requireAdminPage first, and it passes the tenant id.
    const adminPage = read("app/admin/users/[userId]/agent/help/page.tsx");
    const body = adminPage.slice(adminPage.indexOf("export default async function"));
    assert.match(body, /^[^\n]*\n\s*await requireAdminPage\(\);/, "requireAdminPage first");
    assert.match(adminPage, /asUserId=\{userId\}/);
    // The test route refuses asUserId from a non-admin (resolveTargetUserId → 403).
    const route = read("app/api/dashboard/tools/client-agent/test/route.ts");
    assert.match(route, /await resolveTargetUserId\(req\)/);
    assert.match(route, /"forbidden" in r\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\)/);
  });
  await test("admin view: page links stay in the admin, on the tenant", () => {
    const html = wrap("fr", createElement(AgentHelpView, { locale: "fr", testOpen: false, asUserId: TENANT, testLanguage: "he" }));
    const links = agentHelpLinks(TENANT);
    assert.ok(html.includes(`href="${links.back}"`), "back to the admin Connect page");
    assert.ok(html.includes(`href="${links.card}"`), "card link in the admin view");
    assert.ok(!html.includes('href="/fr/dashboard/agent'), "no link to the admin's own dashboard");
  });

  await test("the trial question follows the ACCOUNT's language, as the test route (#437)", () => {
    for (const lang of ["fr", "en", "he"] as const) {
      // A French page for an account whose agent speaks `lang`.
      const html = page("fr", false, lang);
      assert.ok(html.includes(esc(CLIENT_AGENT_TEST_QUESTIONS[lang])), lang);
      for (const other of ["fr", "en", "he"] as const) if (other !== lang) assert.ok(!html.includes(esc(CLIENT_AGENT_TEST_QUESTIONS[other])), `${lang}: not ${other}`);
    }
    // No config row / an unknown language: French, like the route.
    assert.ok(page("en", false, null).includes(esc(CLIENT_AGENT_TEST_QUESTIONS.fr)));
    assert.ok(page("en", false, "de").includes(esc(CLIENT_AGENT_TEST_QUESTIONS.fr)));
    // Both pages read the account's primaryLanguage: the session's, or the tenant viewed.
    assert.match(read("app/[locale]/dashboard/agent/help/page.tsx"), /agentConfigs\.userId, session\.user\.id\)[\s\S]*testLanguage=\{cfg\?\.primaryLanguage \?\? null\}/);
    assert.match(read("app/admin/users/[userId]/agent/help/page.tsx"), /agentConfigs\.userId, userId\)[\s\S]*testLanguage=\{cfg\?\.primaryLanguage \?\? null\}/);
    // And the route still picks the account's primaryLanguage when the body has none (the help test sends "{}").
    assert.match(read("app/api/dashboard/tools/client-agent/test/route.ts"), /LANGUAGES\.includes\(cfg\?\.primaryLanguage \?\? ""\)/);
  });

  await test("signature: every request, secret from the first activation (#439)", () => {
    for (const l of LOCALES) {
      const sig = messages(l).AgentHelp.contract.signature as string;
      assert.ok(sig.includes("{header}") && sig.includes("{card}"), l);
      const method = messages(l).AgentHelp.contract.method as string;
      assert.doesNotMatch(`${sig} ${method}`, /si un secret|when a .*secret is set|if you generated|אם יצרתם|אם הוגדר סוד/i, `${l}: no conditional signature`);
    }
    assert.match(messages("fr").AgentHelp.contract.signature, /^Chaque requête porte l'en-tête <c>\{header\}<\/c> :/);
    assert.match(messages("fr").AgentHelp.contract.signature, /créé à la première activation et affiché une seule fois dans la carte « \{card\} »/);
  });

  // (a) Who the page is for + "Copier le lien": the TENANT URL, in both views.
  await test("for-tech line and copy-link button, first under the title, in fr/en/he", () => {
    for (const l of LOCALES) {
      const m = messages(l);
      for (const asUserId of [null, TENANT]) {
        const html = wrap(l, createElement(AgentHelpView, { locale: l, testOpen: false, asUserId, testLanguage: l }));
        const line = html.indexOf(esc(m.AgentHelp.forTech));
        assert.ok(line > html.indexOf("</h1>") && line < html.indexOf(esc(m.AgentHelp.what.title)), `${l}: line between the title and the first section`);
        assert.ok(html.includes(`data-copy-page-link="true"`) && html.includes(`>${esc(m.AgentHelp.copyLink)}</button>`), `${l}: the button`);
      }
    }
    assert.doesNotMatch(`${messages("he").AgentHelp.forTech} ${messages("he").AgentHelp.copyLink}`, /תמרה/);
  });
  await test("the copied URL is the tenant page, never /admin or asUserId", () => {
    for (const l of LOCALES) assert.equal(tenantHelpUrl("https://app.example.test", l), `https://app.example.test/${l}/dashboard/agent/help`);
    assert.equal(tenantHelpUrl("https://app.example.test/", "fr"), "https://app.example.test/fr/dashboard/agent/help");
    // The button copies tenantHelpUrl(this origin, the page's locale); the view gives it the locale only (no asUserId, no admin href).
    const btn = read("components/agent-help/CopyPageLink.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(btn, /writeText\(tenantHelpUrl\(window\.location\.origin, locale\)\)/);
    assert.doesNotMatch(btn, /asUserId|\/admin|location\.href|pathname/);
    assert.match(read("app/[locale]/dashboard/agent/help/help-view.tsx"), /<CopyPageLink locale=\{locale\} label=/);
    // The admin route renders the view with the tenant-facing locale "fr": the copied URL is /fr/dashboard/agent/help.
    assert.match(read("app/admin/users/[userId]/agent/help/page.tsx"), /locale="fr"/);
  });

  // (b) The Node example always verifies the signature, and refuses to start without the secret.
  await test("example server: no optional signature check", () => {
    const src = exampleServerText(words(messages("fr")));
    assert.doesNotMatch(src, /if \(SECRET\)/);
    assert.match(src, /if \(!SECRET\) \{\n\s*console\.error\([^)]*AGENT_SECRET is required[^)]*\);\n\s*process\.exit\(1\);\n\}/);
  });
  await test("example server, run for real (offline, 127.0.0.1): exits without the secret; checks every request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-help-example-"));
    const file = join(dir, "server.mjs");
    writeFileSync(file, exampleServerText(words(messages("fr"))));
    const run = (env: Record<string, string>) => spawn(process.execPath, [file], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] as const });
    try {
      // No AGENT_SECRET: non-zero exit, the clear message, before listening.
      const noSecret = run({});
      let err = "";
      noSecret.stderr.on("data", (d: Buffer) => (err += d));
      const code = await new Promise<number | null>((r) => noSecret.on("exit", (c: number | null) => r(c)));
      assert.equal(code, 1);
      assert.match(err, /AGENT_SECRET is required/);

      // With it, on a free local port: signed → 200 + answer; unsigned or wrong → 401.
      const port = await new Promise<number>((r) => {
        const s = createNetServer().listen(0, "127.0.0.1", () => {
          const p = (s.address() as { port: number }).port;
          s.close(() => r(p));
        });
      });
      const secret = "mock-example-secret";
      const srv = run({ AGENT_SECRET: secret, PORT: String(port) });
      try {
        const url = `http://127.0.0.1:${port}/ask`;
        const body = JSON.stringify(exampleRequestBody("fr", words(messages("fr"))));
        let up = false;
        for (let i = 0; i < 50 && !up; i++) {
          try {
            await fetch(url, { method: "GET" });
            up = true;
          } catch {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        assert.ok(up, "example server listening");
        const post = (sig?: string) =>
          fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(sig === undefined ? {} : { [CLIENT_AGENT_SIGNATURE_HEADER]: sig }) }, body });
        const ok = await post(createHmac("sha256", secret).update(body).digest("hex"));
        assert.equal(ok.status, 200);
        assert.equal(((await ok.json()) as { answer: string }).answer, messages("fr").AgentHelp.example.answer);
        assert.equal((await post()).status, 401, "unsigned");
        assert.equal((await post(createHmac("sha256", "other").update(body).digest("hex"))).status, 401, "wrong secret");
      } finally {
        srv.kill();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await test("HE copy writes the brand in Latin letters", () => {
    const he = JSON.stringify(messages("he").AgentHelp);
    assert.ok(he.includes("Tamara"));
    assert.ok(!he.includes("תמרה"));
  });

  await test("same keys in fr/en/he", () => {
    const keys = (o: unknown, p = ""): string[] =>
      o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => keys(v, `${p}${k}.`)) : [p];
    const [fr, en, he] = LOCALES.map((l) => keys(messages(l).AgentHelp).sort());
    assert.deepEqual(en, fr);
    assert.deepEqual(he, fr);
    for (const l of LOCALES) assert.equal(typeof messages(l).ToolsBrick.agent.howToGet, "string");
  });

  await test("no template promised yet", () => {
    for (const l of LOCALES) assert.doesNotMatch(JSON.stringify(messages(l).AgentHelp), /n8n|make\.com|\bMake\b|template|modèle|תבנית/i);
  });

  // The card's link: in the real row and in the read-only preview (CLIENT_AGENT unset).
  const base = toolsFromTileToggles({ calendar: true, customers: true, orders: false });
  const tools: Tools = { ...base, clientAgent: { ...base.clientAgent, enabled: true, url: "https://agent.example.test/ask" } };
  const served: ToolsResponse = {
    tools: publicTools(tools),
    capabilities: effectiveCapabilities(
      { recipe: "receptionist", tools, clientAgentUrlOk: true },
      { transferNumber: "", googleConnected: true, clientAgentEnabled: true },
      DEFAULT_MATRIX.premium,
    ),
    account: { googleConnected: true, transferNumberSet: false, transferNumber: null },
    upgrade: {},
    clientAgentTool: { visible: true },
  };
  for (const l of LOCALES) {
    const m = messages(l);
    await test(`${l}: the card links to the help page, next to the address`, () => {
      const row = wrap(l, createElement(ClientAgentRow, { served, tools: publicTools(tools), onChange: () => {}, refused: null }));
      assert.ok(row.includes(`href="/${l}${AGENT_HELP_HREF}"`));
      assert.ok(row.includes(`>${esc(m.ToolsBrick.agent.howToGet)}</a>`));
      // Right after the address hint, before the mode.
      const at = row.indexOf("data-agent-help-link");
      assert.ok(at > row.indexOf('type="url"') && at < row.indexOf(esc(m.ToolsBrick.agent.mode)), "near the address field");
      const preview = wrap(l, createElement(ConnectPreview));
      assert.ok(preview.includes(`href="/${l}${AGENT_HELP_HREF}"`), "the preview (CLIENT_AGENT unset) links too");
      const admin = wrap(l, createElement(ClientAgentRow, { served, tools: publicTools(tools), onChange: () => {}, refused: null, asUserId: TENANT }));
      assert.ok(admin.includes(`href="/admin/users/${TENANT}/agent/help"`), "admin view: the link carries the tenant id");
      assert.ok(!admin.includes(`href="/${l}${AGENT_HELP_HREF}"`), "admin view: never the admin's own help page");
      // Admin view of a tenant whose Connect page is the preview: same rule.
      const adminPreview = wrap(l, createElement(ConnectPreview, { asUserId: TENANT }));
      assert.ok(adminPreview.includes(`href="/admin/users/${TENANT}/agent/help"`), "admin preview: the link carries the tenant id");
      assert.ok(read("app/[locale]/dashboard/agent/connect-view.tsx").includes("<ConnectPreview asUserId={asUserId} />"), "the page passes it");
    });
  }

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nagent help page: all passed");
}

void main();
