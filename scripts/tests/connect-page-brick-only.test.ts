// "Connecter vos agents" is ONE clear screen (founder + VP, 23/11): the
// title, the running trial's line, the "Votre agent IA" brick. Nothing else,
// for a tenant AND an admin.
//   1. The owned view, tenant and admin (CLIENT_AGENT=all, as the page decides
//      it): the brick is in the tree; the older "Qui répond au téléphone" card
//      and the public-URL card are not; the HTML holds none of their copy in
//      fr/en/he ("Qui répond", "Ce que Tamara envoie", "contactez l'équipe").
//   2. Source guard: the deleted card modules (agent-brain-section,
//      agent-brain-ui, admin-brain-lazy) are gone and nothing imports them;
//      no AgentBrain translator anywhere.
//   3. The public-URL card ("API : utiliser l'agent Tamara depuis votre propre
//      téléphonie") lives in Réglages; every link to it goes there
//      (/dashboard/settings#agent-url), none to the Connect page.
//   4. The connect door's first step opens the brick ("Coller l'adresse de
//      votre agent" → /dashboard/agent#client-agent); no firstSteps entry or
//      checklist step points at the public-URL card.
// Mock data only, no request.
// Run with:  npx tsx scripts/tests/connect-page-brick-only.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectOwnedView } from "../../app/[locale]/dashboard/agent/connect-owned";
import { AgentUrlCard, AgentUrlCardGate } from "../../app/[locale]/dashboard/settings/agent-url-section";
import { ClientAgentBrick } from "../../components/bricks/client-agent/ClientAgentBrick";
import { DOOR_UI, withFirstStep } from "../../lib/doors-ui";
import { clientAgentEnabled, clientAgentMode } from "../../lib/tools/client-agent-switch";

type ProviderProps = ComponentProps<typeof NextIntlClientProvider>;

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const html = (l: string, node: ReactNode) =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale: l, messages: messages(l), timeZone: "UTC" } as ProviderProps, node),
  );

/** Every component type in an element tree, without calling the components. */
function types(node: ReactNode, out = new Set<unknown>()): Set<unknown> {
  if (Array.isArray(node)) node.forEach((n) => types(n, out));
  else if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    out.add(el.type);
    types(el.props.children, out);
  }
  return out;
}

// The removed card's copy, as it read before the removal (fr/en/he), and the
// public-URL card's titles (old and new): none may appear on the Connect page.
const REMOVED_COPY: Record<(typeof LOCALES)[number], string[]> = {
  fr: ["Qui répond", "Ce que Tamara envoie", "contactez l'équipe", "Réglage admin (ancien branchement)", "Agent joignable"],
  en: ["Who answers the phone", "What Tamara sends to your agent", "contact the Tamara team", "Admin setting (legacy connection)", "Reachable agent"],
  he: ["מי עונה לטלפון", "מה תמרה שולחת לסוכן שלכם", "פנו לצוות תמרה", "הגדרת מנהל (חיבור ישן)", "הסוכן זמין לשיחות"],
};

// ── 1. Tenant and admin: the brick, nothing else ────────────────────────────
const mode = clientAgentMode({ CLIENT_AGENT: "all" });
for (const l of LOCALES) {
  for (const isAdmin of [false, true]) {
    const who = `${l} ${isAdmin ? "admin" : "tenant"}`;
    const tree = ConnectOwnedView({
      title: messages(l).DashboardNav.connect,
      trialNote: null,
      showClientAgent: clientAgentEnabled(mode, isAdmin),
    });
    const ts = types(tree);
    assert.ok(ts.has(ClientAgentBrick), `${who}: the "Votre agent IA" brick`);
    assert.ok(!ts.has(AgentUrlCard) && !ts.has(AgentUrlCardGate), `${who}: no public-URL card`);
    const out = html(l, tree);
    assert.ok(out.includes(`>${esc(messages(l).DashboardNav.connect)}</h1>`), `${who}: the title`);
    for (const s of [...REMOVED_COPY[l], messages(l).AgentUrl.title])
      assert.ok(!out.includes(esc(s)) && !out.includes(s), `${who}: no "${s}"`);
    assert.doesNotMatch(out, /data-admin-brain|agent-url-title|id="agent-url"/, `${who}: no removed block, not even hidden`);
  }
}
// The view takes no admin flag nor card copy any more: tenant and admin get the same tree.
{
  const view = code("app/[locale]/dashboard/agent/connect-owned.tsx");
  assert.doesNotMatch(view, /isAdmin|adminBrain|AdminBrain|AgentUrl|agent-url/);
  // C1b: the connectors list (its Modifier / Commencer open the brick), or the brick alone when the list was not read.
  assert.match(
    view,
    /\{trialNote\}\s*\{showClientAgent &&\s*\(connectors \? \(\s*<ConnectorsPanel\s[^>]*\/>\s*\) : \(\s*<ClientAgentBrick asUserId=\{asUserId\} \/>\s*\)\)\}\s*<\/section>/,
    "title, trial note, then the list (or the brick): in this order, last",
  );
  // The door's deep link (#client-agent) opens the editor that the list mounts.
  assert.match(read("components/connectors/ConnectorsPanel.tsx"), /EDITOR_HASH = "#client-agent"/);
  assert.match(read("components/connectors/ConnectorsPanel.tsx"), /if \(window\.location\.hash !== EDITOR_HASH\) return;\s*const id = window\.setTimeout\(\(\) => \{\s*setEditorOpen\(true\);/);
  const page = code("app/[locale]/dashboard/agent/page.tsx");
  assert.doesNotMatch(page, /AgentBrain|tBrain|adminBrain|AgentUrl|myAgentLink/);
  assert.match(page, /trialNote=\{<ProductTrialNote trial=\{trials\.connect\} inline \/>\}/, "the trial note (F4) is kept");
  // isAdmin feeds only the ONE decision (lib/connect-page-view.ts, pinned by connect-page-view.test.ts).
  assert.equal((page.match(/\bisAdmin\b/g) ?? []).length, 3, "isAdmin: declared once, read by the switch and the decision");
  assert.match(page, /showClientAgent: clientAgentEnabled\(clientAgentMode\(\), isAdmin\)/);
}
console.log("ok: tenant and admin get the title, the trial note and the brick only");

// ── 2. Source guard: the card's modules are gone, nothing imports them ──────
const DELETED = [
  "app/[locale]/dashboard/settings/agent-brain-section.tsx",
  "app/[locale]/dashboard/settings/agent-brain-ui.ts",
  "app/[locale]/dashboard/agent/admin-brain-lazy.tsx",
];
for (const f of DELETED) assert.ok(!existsSync(join(ROOT, f)), `${f}: deleted`);
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(tsx?|mjs|js)$/.test(name)) yield p;
  }
}
const SELF = "scripts/tests/connect-page-brick-only.test.ts";
const offenders: string[] = [];
let scanned = 0;
for (const dir of ["app", "components", "lib", "hooks", "i18n", "scripts"]) {
  if (!existsSync(join(ROOT, dir))) continue;
  for (const p of sources(join(ROOT, dir))) {
    const rel = relative(ROOT, p);
    if (rel === SELF) continue;
    scanned++;
    const src = readFileSync(p, "utf8");
    if (/(?:from\s*|import\s*\(\s*)["'][^"']*(?:agent-brain-section|agent-brain-ui|admin-brain-lazy)["']/.test(src)) offenders.push(`${rel}: imports a deleted module`);
    if (/\b(?:AgentBrainSection|AgentBrainView|AdminBrainCard|AdminBrainSectionLazy)\b/.test(src)) offenders.push(`${rel}: names a deleted component`);
    if (/(?:useTranslations|getTranslations)\(\s*(?:["'`]AgentBrain["'`]|\{[^}]*namespace:\s*["'`]AgentBrain["'`])/.test(src)) offenders.push(`${rel}: an AgentBrain translator`);
  }
}
assert.ok(scanned > 100, `source files scanned (${scanned})`);
assert.deepEqual(offenders, [], offenders.join("\n"));
for (const l of LOCALES) assert.equal(messages(l).AgentBrain, undefined, `${l}: no AgentBrain namespace`);
console.log("ok: no import of the deleted modules anywhere");

// ── 3. The public-URL card lives in Réglages; links go there ────────────────
{
  const settings = code("app/[locale]/dashboard/settings/page.tsx");
  assert.match(settings, /<AgentUrlCard isAdmin=\{isAdmin\} \/>/, "mounted in Réglages (gated: developer mode, admins always)");
  assert.doesNotMatch(code("app/admin/users/[userId]/agent/page.tsx"), /AgentUrl/, "not on the admin Connect view either");
  assert.equal(messages("fr").AgentUrl.title, "API : utiliser l'agent Tamara depuis votre propre téléphonie");
  // Every href / router target naming the card's anchor points at Réglages;
  // nothing deep-links the Connect page to it (or to the old card).
  const links: string[] = [];
  const bad: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const p of sources(join(ROOT, dir))) {
      const src = readFileSync(p, "utf8");
      for (const [m] of src.matchAll(/["'`][^"'`\s]*#agent-url\b[^"'`\s]*["'`]/g)) {
        links.push(m);
        if (!/\/dashboard\/settings#agent-url["'`]$/.test(m)) bad.push(`${relative(ROOT, p)}: ${m}`);
      }
      for (const [m] of src.matchAll(/["'`][^"'`\s]*\/(?:dashboard|admin\/users\/[^/"'`\s]+)\/agent[?#][^"'`\s]*["'`]/g))
        if (!/\/agent#client-agent["'`]$/.test(m)) bad.push(`${relative(ROOT, p)}: ${m} (Connect deep link to something other than the brick)`);
    }
  }
  for (const l of LOCALES) {
    const raw = read(`messages/${l}.json`);
    for (const [m] of raw.matchAll(/[^"\s]*#agent-url\b[^"\s]*/g)) if (!m.endsWith("/dashboard/settings#agent-url")) bad.push(`messages/${l}.json: ${m}`);
  }
  assert.deepEqual(bad, [], bad.join("\n"));
  void links;
}
console.log("ok: the public-URL card is in Réglages, no link points at it on the Connect page");

// ── 4. The connect door's first step opens the brick ────────────────────────
{
  assert.deepEqual(DOOR_UI.connect.firstSteps, ["clientAgent"]);
  for (const [door, ui] of Object.entries(DOOR_UI))
    for (const id of ui.firstSteps) assert.doesNotMatch(id, /agentUrl|agent-url|AgentUrl/i, `${door}: no first step at the public-URL card`);
  const steps = [{ id: "number", done: false }, { id: "clientAgent", done: false }];
  assert.equal(withFirstStep(steps, "connect")[0].id, "clientAgent", "connect: the brick's step first");

  const checklist = code("components/dashboard/SetupChecklist.tsx");
  assert.doesNotMatch(checklist, /agentUrl|agent-url|AgentUrl|\/dashboard\/settings/i, "no checklist step at the public-URL card");
  const step = checklist.slice(checklist.indexOf('id: "clientAgent"'), checklist.indexOf('id: "number"'));
  assert.match(step, /title: t\("clientAgentTitle"\)/);
  assert.match(step, /href: "\/dashboard\/agent#client-agent",/, "opens the brick's anchor");
  assert.match(read("components/bricks/client-agent/ClientAgentBrick.tsx"), /<section\s+id="client-agent"/, "the anchor is on the brick");
  assert.equal(messages("fr").DashboardSetup.clientAgentTitle, "Coller l'adresse de votre agent");
  // The step follows the Connect page's own decision (connectStepView over
  // connectPageView): scripts/tests/checklist-follows-menu.test.ts.
  assert.match(code("app/[locale]/dashboard/config/config-page.tsx"), /view: connectStepView\(\{ menu: products\.menu\.connect, showClientAgent: clientAgentVisible, isAdmin, trial: products\.trials\.connect \}\)/);
}
console.log("ok: connect's first step opens the brick");

console.log("connect-page-brick-only: OK");
