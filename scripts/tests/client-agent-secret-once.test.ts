// "Ask your agent": the secret the SERVER generates (switched on with none
// stored and none sent) comes back once, as `generatedSecret` in that PUT's
// answer. The card shows it once in the existing one-time box (read-only value,
// "Copy", "copy it now"), keeps it in component state only (never storage,
// never the URL, never `served`), and after a reload reads "Set." with the
// regenerate control only. An answer without it changes nothing.
// Renders the REAL ClientAgentRow to static HTML. Mock data only — no network.
// Run with:  npx tsx scripts/tests/client-agent-secret-once.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_MATRIX } from "../../lib/plan-features";
import { toolsFromTileToggles } from "../../lib/tools/adapters";
import { effectiveCapabilities, publicTools, type Tools } from "../../lib/tools/contract";
import { ClientAgentRow } from "../../components/bricks/client-agent/ClientAgentBrick";
import { clientAgentSavedAnswer, type ToolsResponse } from "../../components/bricks/tools/tools-ui";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const URL_OK = "https://agent.example.test/ask";
// A mock, shaped like a real one (base64url, 43 characters).
const GENERATED = "mockGeneratedSecret_0123456789abcdefABCDEF-";

function stored(over: Partial<Tools["clientAgent"]> = {}): Tools {
  const base = toolsFromTileToggles({ calendar: true, customers: true, orders: false });
  return { ...base, clientAgent: { ...base.clientAgent, ...over } };
}

function served(tools: Tools): ToolsResponse {
  const capabilities = effectiveCapabilities(
    { recipe: "receptionist", tools, clientAgentUrlOk: tools.clientAgent.url.startsWith("https://") },
    { transferNumber: "+15555550100", googleConnected: true, clientAgentEnabled: true },
    DEFAULT_MATRIX.premium,
  );
  return {
    tools: publicTools(tools),
    capabilities,
    account: { googleConnected: true, transferNumberSet: true, transferNumber: "+15555550100" },
    upgrade: {},
    clientAgentTool: { visible: true },
  };
}

function render(s: ToolsResponse, locale: string, generated: string | null) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" } as ProviderProps,
      createElement(ClientAgentRow, { served: s, tools: s.tools, onChange: () => {}, refused: null, generated })),
  );
}

// After the PUT that switched it on: the server stored a secret (secretSet) and sent it once.
const afterSave = served(stored({ enabled: true, url: URL_OK, secret: "stored-on-the-server" }));
const putAnswer: ToolsResponse = { ...afterSave, generatedSecret: GENERATED };

// 1. The save's answer: the secret is read once, and `served` never keeps it
{
  const { served: kept, generated } = clientAgentSavedAnswer(putAnswer);
  assert.equal(generated, GENERATED, "a plausible secret is read");
  assert.ok(!("generatedSecret" in kept), "served never keeps generatedSecret");
  assert.equal(JSON.stringify(kept).includes(GENERATED), false, "nowhere in served");
  assert.deepEqual(kept, afterSave, "everything else unchanged");
  // Absent → nothing to show, served unchanged.
  const plain = clientAgentSavedAnswer(afterSave);
  assert.equal(plain.generated, null);
  assert.deepEqual(plain.served, afterSave);
  // Defensive: anything but a plausible string is ignored.
  for (const bad of [undefined, null, 42, true, {}, [GENERATED], "", "short", " ".repeat(40), `${GENERATED} x`, "a".repeat(257), `${GENERATED}\n`, "é".repeat(40)]) {
    const r = clientAgentSavedAnswer({ ...afterSave, generatedSecret: bad } as unknown as ToolsResponse);
    assert.equal(r.generated, null, `ignored: ${JSON.stringify(bad)?.slice(0, 20)}`);
    assert.ok(!("generatedSecret" in r.served), "stripped even when ignored");
  }
  assert.equal(clientAgentSavedAnswer({ ...afterSave, generatedSecret: "a".repeat(16) }).generated, "a".repeat(16), "16 is enough");
  assert.equal(clientAgentSavedAnswer({ ...afterSave, generatedSecret: "a".repeat(256) }).generated, "a".repeat(256), "256 is the cap");
}

// 2. Shown once, under the signing secret: the value, "Copy", the line — fr/en/he
{
  for (const l of LOCALES) {
    const m = messages(l).ToolsBrick.agent;
    const html = render(afterSave, l, GENERATED);
    assert.ok(html.includes(GENERATED), `${l}: the value is shown`);
    assert.ok(html.includes(`dir="ltr" class="mt-1 block select-all`), `${l}: read-only, LTR, selectable`);
    assert.ok(html.includes(esc(m.copy)), `${l}: Copy`);
    assert.ok(html.includes(esc(m.copyNow)), `${l}: the once-only line`);
    assert.ok(html.includes(esc(m.copiedDone)), `${l}: closes on "copied"`);
    assert.ok(!html.includes(esc(m.saveToKeep)), `${l}: already saved, no "takes effect when you save"`);
    assert.ok(!html.includes(esc(m.undo)), `${l}: no cancel: it is stored`);
    assert.ok(!html.includes(esc(m.regenerate)), `${l}: no regenerate while the box is open`);
    assert.ok(html.indexOf(esc(m.secret)) < html.indexOf(GENERATED), `${l}: under the signing secret`);
    assert.equal(html.split(GENERATED).length - 1, 1, `${l}: once on the page`);
  }
  assert.equal(messages("fr").ToolsBrick.agent.copy, "Copier");
  assert.equal(messages("fr").ToolsBrick.agent.copyNow, "Copiez-le maintenant : vous ne le reverrez plus.");
  assert.match(render(afterSave, "he", GENERATED), /<code dir="ltr"/, "he: the value stays left-to-right");
}

// 3. No generatedSecret → today's UI exactly
{
  for (const l of LOCALES) {
    const today = render(afterSave, l, null);
    const m = messages(l).ToolsBrick.agent;
    assert.ok(!today.includes(esc(m.copyNow)) && !today.includes(esc(m.copy)), `${l}: no one-time box`);
    assert.ok(today.includes(esc(m.secretSet)) && today.includes(esc(m.regenerate)), `${l}: "set" + regenerate`);
    // The prop omitted entirely renders the same as null.
    const omitted = renderToStaticMarkup(
      createElement(NextIntlClientProvider, { locale: l, messages: messages(l), timeZone: "UTC" } as ProviderProps,
        createElement(ClientAgentRow, { served: afterSave, tools: afterSave.tools, onChange: () => {}, refused: null })),
    );
    assert.equal(omitted, today, `${l}: no prop = null`);
  }
}

// 4. After a reload: the GET has no generatedSecret, the state is new → "Set.", no value, regenerate only
{
  const get = served(stored({ enabled: true, url: URL_OK, secret: "stored-on-the-server" }));
  assert.ok(!("generatedSecret" in get));
  for (const l of LOCALES) {
    const m = messages(l).ToolsBrick.agent;
    const html = render(get, l, null);
    assert.ok(!html.includes(GENERATED), `${l}: never shown again`);
    assert.ok(html.includes(esc(m.secretSet)), `${l}: "Set."`);
    assert.ok(html.includes(esc(m.regenerate)), `${l}: rotation`);
    assert.ok(!html.includes(esc(m.generate) + "<"), `${l}: not "Generate" (it is set)`);
  }
  assert.equal(messages("fr").ToolsBrick.agent.secretSet, "Défini.");
}

// 5. Source guards: memory only, never storage / URL / log; wired through the save
{
  for (const f of ["components/bricks/client-agent/ClientAgentBrick.tsx", "components/bricks/tools/tools-ui.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./, `${f}: no storage`);
    assert.doesNotMatch(src, /history\.(push|replace)State|location\.(hash|search|href)\s*=|router\.(push|replace)|useRouter|useSearchParams|URLSearchParams/, `${f}: no URL write`);
    assert.doesNotMatch(src, /console\./, `${f}: never logged`);
  }
  const brick = read("components/bricks/client-agent/ClientAgentBrick.tsx");
  // The raw field is read in ONE place (the helper); the brick only uses its answer.
  assert.doesNotMatch(brick, /\.generatedSecret|generatedSecret\s*[:,}]|\[\s*["'`]generatedSecret/, "the brick never reads the raw field");
  assert.match(brick, /const answer = clientAgentSavedAnswer\(data\);\s*if \(answer\.generated\) setGenerated\(answer\.generated\);\s*setServed\(answer\.served\);/, "stripped before it is kept; absent = unchanged");
  assert.doesNotMatch(brick, /setServed\(data\)/, "the raw answer is never kept");
  assert.match(brick, /const \[generated, setGenerated\] = useState<string \| null>\(null\);/, "component state, starts empty (a reload drops it)");
  assert.match(brick, /generated=\{generated\}\s*onGeneratedDone=\{\(\) => setGenerated\(null\)\}/);
  assert.match(brick, /const shown = revealed \?\? generated \?\? /);
  assert.match(brick, /setRevealed\(null\);\s*onGeneratedDone\?\.\(\);[\s\S]*?t\("copiedDone"\)/, '"copied" closes it');
  assert.match(read("components/bricks/tools/tools-ui.ts"), /const PLAUSIBLE_SECRET = \/\^\[\\x21-\\x7e\]\{16,256\}\$\/;/);
}

console.log("ALL CLIENT-AGENT SECRET-ONCE TESTS PASSED");
