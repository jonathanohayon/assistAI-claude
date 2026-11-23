// "Connecter votre agent": a tenant sees ONE agent-address setting, the
// "Votre agent IA" brick (ClientAgentBrick). The older "Qui répond au
// téléphone" card (AgentBrainSection) is an admin setting, under the label
// "Réglage admin (ancien branchement)" (VP, 23/11). Display only.
//   1. Tenant: the view's tree holds the brick and no older card; the HTML has
//      neither its title nor its "contact the Tamara team" sentence.
//   2. Admin: the older card, under its label.
//   3. Source guard: the admin decision is made on the server (sessionIsAdmin,
//      the agent-brain route's own check), never by a client flag.
//   4. "Saved." sits next to the control that was saved (address Save, secret
//      Save, the switch), polite live region; nothing at the card's bottom.
//   5. The amber line names "Mon agent" (nothing is above it any more).
// Mock data only, no request. Run with:  npx tsx scripts/tests/agent-brain-admin-only.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminBrainCard, ConnectOwnedView, type ConnectOwnedViewProps } from "../../app/[locale]/dashboard/agent/connect-owned";
import { AdminBrainSectionLazy } from "../../app/[locale]/dashboard/agent/admin-brain-lazy";
import { AgentBrainSection, AgentBrainView, type AgentBrainViewProps } from "../../app/[locale]/dashboard/settings/agent-brain-section";
import { toBrainState, type BrainResponse } from "../../app/[locale]/dashboard/settings/agent-brain-ui";
import { ClientAgentBrick } from "../../components/bricks/client-agent/ClientAgentBrick";

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

const view = (l: string, admin: boolean, showClientAgent = true): ConnectOwnedViewProps => {
  const m = messages(l).AgentBrain;
  return {
    title: messages(l).DashboardNav.connect,
    isAdmin: admin,
    showClientAgent,
    adminBrain: admin ? { label: m.adminLabel, title: m.title, desc: "desc" } : null,
  };
};

// ── 1. Tenant: the brick, never the older card ──────────────────────────────
for (const l of LOCALES) {
  const m = messages(l).AgentBrain;
  const tree = ConnectOwnedView(view(l, false));
  const ts = types(tree);
  assert.ok(ts.has(ClientAgentBrick), `${l}: tenant has the "Votre agent IA" brick`);
  assert.ok(!ts.has(AdminBrainCard), `${l}: tenant has no older card`);
  assert.ok(!ts.has(AgentBrainSection) && !ts.has(AdminBrainSectionLazy), `${l}: tenant tree never references the section`);
  const out = html(l, tree);
  for (const s of [m.title, m.connectViaTeam, m.adminLabel, m.toggleLabel])
    assert.ok(!out.includes(esc(s)), `${l}: tenant HTML has no "${s}"`);
  assert.ok(!/data-admin-brain/.test(out), `${l}: no admin block, not even hidden`);
}
console.log("ok: tenant gets the brick only, no older card nor its sentence");

// ── 2. Admin: the older card, under its label ──────────────────────────────
for (const l of LOCALES) {
  const m = messages(l).AgentBrain;
  const ts = types(ConnectOwnedView(view(l, true)));
  assert.ok(ts.has(AdminBrainCard) && ts.has(ClientAgentBrick), `${l}: admin has both`);
  const out = html(l, createElement(AdminBrainCard, view(l, true).adminBrain!));
  const label = out.indexOf(esc(m.adminLabel));
  const title = out.indexOf(esc(m.title));
  assert.ok(label >= 0 && title > label, `${l}: the label sits above the card's title`);
  assert.ok(types(AdminBrainCard(view(l, true).adminBrain!)).has(AdminBrainSectionLazy), `${l}: the card is the real section (lazy)`);
}
assert.equal(messages("fr").AgentBrain.adminLabel, "Réglage admin (ancien branchement)");
assert.equal(messages("en").AgentBrain.adminLabel, "Admin setting (legacy connection)");
assert.equal(messages("he").AgentBrain.adminLabel, "הגדרת מנהל (חיבור ישן)");
console.log("ok: admin gets the card under its label");

// ── 3. Source guard: decided on the server ─────────────────────────────────
{
  const PAGE = "app/[locale]/dashboard/agent/page.tsx";
  const VIEW = "app/[locale]/dashboard/agent/connect-owned.tsx";
  for (const f of [PAGE, VIEW]) assert.doesNotMatch(read(f), /^\s*["']use client["']/m, `${f}: a server component`);
  const page = code(PAGE);
  assert.match(page, /import \{ sessionIsAdmin \} from "@\/lib\/api\/auth-guards";/);
  assert.match(page, /const isAdmin = await sessionIsAdmin\(\);/, "the agent-brain route's own check");
  assert.match(page, /adminBrain=\{\s*isAdmin\s*\?[\s\S]*?:\s*null\s*\}/, "the copy (and so the card) for an admin only");
  assert.doesNotMatch(page, /AgentBrainSection|searchParams|useSession|cookies\(\)/, "no direct mount, no client flag");
  assert.match(code(VIEW), /\{adminBrain && <AdminBrainCard \{\.\.\.adminBrain\} \/>\}/);
  // The route reads/writes the SESSION's own row: the admin tenant view must
  // not mount it (it would show and edit the admin's own setting).
  assert.match(code("app/api/dashboard/agent-brain/route.ts"), /getAgentBrain\(session\.user\.id\)/);
  assert.doesNotMatch(read("app/admin/users/[userId]/agent/page.tsx"), /AgentBrain|connect-owned/);
  // The section's code reaches the browser through ONE dynamic import (the
  // admin stub), mounted by the admin card only: no static import anywhere.
  const LAZY = "app/[locale]/dashboard/agent/admin-brain-lazy.tsx";
  assert.match(code(LAZY), /dynamic\(\(\) =>\s*import\("\.\.\/settings\/agent-brain-section"\)\.then\(\(m\) => m\.AgentBrainSection\)/);
  const importers: string[] = [];
  const mounts: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n)) {
        const src = code(relative(ROOT, p));
        if (/from "[^"]*agent-brain-section"/.test(src)) importers.push(relative(ROOT, p));
        if (/<(AgentBrainSection|AdminBrainSectionLazy)\b/.test(src)) mounts.push(relative(ROOT, p));
      }
    }
  };
  for (const d of ["app", "components"]) walk(join(ROOT, d));
  assert.deepEqual(importers, [], "no static import of the section in the app");
  assert.deepEqual(mounts, [VIEW], "the section is mounted by the admin card only");
}
console.log("ok: the admin decision is server-side");

// ── 4. "Saved." next to the saved control ──────────────────────────────────
const MOCK_URL = "https://agent.example.test/hook";
const adminOn: BrainResponse = {
  brain: { enabled: true, url: MOCK_URL, urlSet: true, secretSet: false },
  urlEditable: true,
} as BrainResponse;
const brain = (l: string, extra: Partial<AgentBrainViewProps>) => {
  const { view: v } = toBrainState(adminOn);
  const props: AgentBrainViewProps = {
    view: v,
    urlDraft: v.url,
    secretDraft: "x",
    busy: false,
    saved: null,
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
  return html(l, createElement(AgentBrainView, props));
};
for (const l of LOCALES) {
  const m = messages(l).AgentBrain;
  const saved = esc(m.saved);
  const count = (s: string) => s.split(saved).length - 1;
  {
    const idle = brain(l, {});
    assert.equal(count(idle), 0, `${l}: nothing saved, no line`);
    const regions = idle.match(/<p role="status" aria-live="polite" data-saved-at="(toggle|url|secret)"/g) ?? [];
    assert.equal(regions.length, 3, `${l}: one polite region per control, in the DOM before a save`);
  }
  {
    const out = brain(l, { saved: "url" });
    assert.equal(count(out), 1);
    const at = out.indexOf(saved);
    assert.ok(at > out.lastIndexOf(">" + esc(m.test) + "<", at) && out.lastIndexOf(">" + esc(m.test) + "<", at) > 0, `${l}: after the address buttons`);
    assert.ok(at < out.indexOf(esc(m.secretLabel)), `${l}: before the secret block`);
    assert.match(out, new RegExp(`data-saved-at="url"[^>]*>${saved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`), `${l}: in the address region`);
  }
  {
    const out = brain(l, { saved: "secret" });
    assert.equal(count(out), 1);
    const at = out.indexOf(saved);
    assert.ok(at > out.indexOf(esc(m.secretSave)), `${l}: after the secret's save button`);
    assert.ok(at < out.indexOf(esc(m.contractTitle)), `${l}: inside the secret block, not at the bottom`);
    const help = out.indexOf("X-Tamara-Signature");
    assert.ok(at < help, `${l}: right under the secret's button, above its help line`);
  }
  {
    const out = brain(l, { saved: "toggle" });
    const at = out.indexOf(saved);
    assert.ok(at > out.indexOf('type="checkbox"') && at < out.indexOf('type="url"'), `${l}: under the switch`);
  }
}
console.log("ok: Saved. next to its control");

// ── 5. The amber line names Mon agent ──────────────────────────────────────
assert.equal(messages("fr").AgentBrain.personaUnused, "Tant que ce mode est actif, la personnalité réglée dans Mon agent n'est pas utilisée.");
assert.equal(messages("en").AgentBrain.personaUnused, "While this is on, the personality set in My agent is not used.");
assert.equal(messages("he").AgentBrain.personaUnused, "כל עוד האפשרות הזו פעילה, האישיות שהוגדרה ב״הסוכן שלי״ לא בשימוש.");
for (const l of LOCALES) {
  const m = messages(l);
  assert.ok(m.AgentBrain.personaUnused.includes(m.DashboardNav.myAgent), `${l}: names the menu entry as the menu does`);
  for (const [k, v] of Object.entries(m.AgentBrain))
    if (typeof v === "string") assert.doesNotMatch(v, /plus haut|ci-dessus|above|למעלה/, `${l}: AgentBrain.${k} says "above"`);
  assert.ok(brain(l, {}).includes(esc(m.AgentBrain.personaUnused)), `${l}: the amber line renders`);
}
console.log("ok: the amber line names Mon agent");

console.log("ALL AGENT-BRAIN ADMIN-ONLY TESTS PASSED");
