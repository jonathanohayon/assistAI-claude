// Dashboard hero: it says "online" / "Live" only when the agent answers.
// The server's stats.agentState decides (live / to activate / to check);
// without it, the older number-based rule (#319): no number means no call can
// reach the agent. Mock data only.
// Run with:  npx tsx scripts/tests/dashboard-hero-live.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HeroSection } from "../../app/[locale]/dashboard/config/hero-section";
import { heroLiveState } from "../../app/[locale]/dashboard/config/hero-live-state";
import type { DashboardStats } from "../../app/[locale]/dashboard/config/types";
import type { AgentState } from "../../lib/agent-state/types";

const ROOT = new URL("../../", import.meta.url).pathname;
const LOCALES = ["fr", "en", "he"] as const;
const messages = (locale: string) =>
  JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8")) as Record<
    string,
    Record<string, string>
  >;
const MOCK_PHONE = "+972500000000";

// Words that claim the line is up, per locale (case-insensitive).
const ONLINE_WORDS: RegExp[] = [
  /en ligne/i,
  /\bonline\b/i,
  /\blive\b/i,
  /\bactif\b|\bactive\b/i,
  /פעיל/, // active
  /חי/, // live
  /מחובר/, // connected
  /אונליין|און ליין/, // online
  /מקוון/, // online
];

// Words an owner should never see in the "to check" lines.
const TECHNICAL_WORDS =
  /\b(config|configuration|session|resolver|worker|tenant|api|http|40[34]|500|trial_|unavailable|inactive|error|erreur|livekit|twilio|openai)\b|_/i;

const Intl = NextIntlClientProvider as unknown as ComponentType<{
  locale: string;
  messages: unknown;
  timeZone?: string;
  children?: ReactNode;
}>;

const MOCK_STATS: DashboardStats = {
  callsToday: 0,
  conversion: 0,
  avgSeconds: 0,
  rdv: 0,
  minutesThisMonth: 0,
};

function render(locale: string, primaryPhone: string | null, agentState?: unknown) {
  const stats = agentState === undefined ? undefined : ({ ...MOCK_STATS, agentState } as DashboardStats);
  return renderToStaticMarkup(
    createElement(
      Intl,
      { locale, messages: messages(locale), timeZone: "UTC" },
      createElement(HeroSection, {
        primaryPhone,
        stats,
        lastUpdatedLabel: "",
        planLabel: "Mock plan",
        voice: "mock-voice",
        currentLangLabel: "Mock",
      }),
    ),
  );
}

// Visible text only (drops tags and attributes such as class names).
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;/g, "'");

const LIVE: AgentState = { state: "live", reason: null };
const TO_ACTIVATE: AgentState = { state: "to_activate", reason: null };
const SUB: AgentState = { state: "attention", reason: "subscription_inactive" };
const CONFIG: AgentState = { state: "attention", reason: "config_unavailable" };
// #339 adds this reason to AgentState; built as a plain object so the test
// compiles on main before it lands.
const ENGINE = { state: "attention", reason: "engine_unreachable" } as const;

const PLANS_HREF = /href="(\/[a-z]{2})?\/dashboard\/billing"/;
const SUPPORT_HREF = /href="https:\/\/wa\.me\/\d+\?text=/;
const ONBOARDING_HREF = /href="(\/[a-z]{2})?\/onboarding"/;

// 1. The state helper: the server's state wins; otherwise the number rule.
assert.deepEqual(heroLiveState({ primaryPhone: MOCK_PHONE }), {
  status: "live",
  live: true,
  tone: "live",
  eyebrowStatusKey: "heroLive",
  badgeKey: "wowLiveLabel",
  lineKey: null,
  action: null,
});
for (const none of [null, undefined, "", "   "]) {
  const s = heroLiveState({ primaryPhone: none });
  assert.equal(s.live, false, `no number: ${JSON.stringify(none)}`);
  assert.equal(s.status, "to_activate", `no number: ${JSON.stringify(none)}`);
}
assert.deepEqual(heroLiveState({ agentState: SUB, primaryPhone: MOCK_PHONE }), {
  status: "attention",
  live: false,
  tone: "warning",
  eyebrowStatusKey: "heroAttention",
  badgeKey: "wowAttentionLabel",
  lineKey: "heroSubscriptionInactive",
  action: "plans",
});
assert.deepEqual(heroLiveState({ agentState: CONFIG, primaryPhone: MOCK_PHONE }), {
  status: "attention",
  live: false,
  tone: "warning",
  eyebrowStatusKey: "heroAttention",
  badgeKey: "wowAttentionLabel",
  lineKey: "heroConfigUnavailable",
  action: "support",
});
assert.deepEqual(heroLiveState({ agentState: ENGINE, primaryPhone: MOCK_PHONE }), {
  status: "attention",
  live: false,
  tone: "neutral",
  eyebrowStatusKey: "heroOffline",
  badgeKey: "wowOfflineLabel",
  lineKey: "heroEngineUnreachable",
  action: null,
});
assert.equal(heroLiveState({ agentState: LIVE, primaryPhone: MOCK_PHONE }).status, "live");
assert.equal(heroLiveState({ agentState: TO_ACTIVATE, primaryPhone: null }).status, "to_activate");

// 2. Missing or unknown agentState: today's number-based rule, NEVER attention.
const UNKNOWN: unknown[] = [
  undefined,
  null,
  "attention",
  42,
  {},
  { state: "offline", reason: null },
  { state: "attention" },
  { state: "attention", reason: null },
  { state: "attention", reason: "engine_stale" },
  { state: "attention", reason: "toString" },
  { state: "toString" },
  { state: "__proto__" },
];
for (const agentState of UNKNOWN) {
  for (const phone of [MOCK_PHONE, null]) {
    const s = heroLiveState({ agentState, primaryPhone: phone });
    assert.notEqual(s.status, "attention", `unknown ${JSON.stringify(agentState)} → never attention`);
    assert.deepEqual(s, heroLiveState({ primaryPhone: phone }), `unknown ${JSON.stringify(agentState)} → number rule`);
  }
}

// 3. Same keys in all three locales: the hero's DashboardConfig keys exist
// everywhere, and DashboardConfig has the same key set in fr/en/he.
const HERO_KEYS = [
  "heroEyebrow",
  "heroLive",
  "heroToActivate",
  "heroAttention",
  "wowLiveLabel",
  "wowToActivateLabel",
  "wowAttentionLabel",
  "heroNoNumber",
  "heroSubscriptionInactive",
  "heroSeePlans",
  "heroConfigUnavailable",
  "heroContactTeam",
  "heroOffline",
  "wowOfflineLabel",
  "heroEngineUnreachable",
];
const frKeys = Object.keys(messages("fr").DashboardConfig).sort();
for (const locale of LOCALES) {
  const dc = messages(locale).DashboardConfig;
  for (const k of HERO_KEYS) assert.ok(typeof dc[k] === "string" && dc[k].trim(), `${locale}: ${k}`);
  assert.deepEqual(Object.keys(dc).sort(), frKeys, `${locale}: DashboardConfig keys match fr`);
  assert.ok(messages(locale).DashboardSetup.numberCta, `${locale}: DashboardSetup.numberCta`);
  assert.ok(messages(locale).Support.waGreeting, `${locale}: Support.waGreeting`);
}

for (const locale of LOCALES) {
  const dc = messages(locale).DashboardConfig;

  // 4. No number (no agentState, and the server's to_activate): no word
  // claiming the line is up, the offline wording instead, nothing pinging or
  // waving, the "get a number" link and no attention action.
  const offStrings = [dc.heroToActivate, dc.wowToActivateLabel, dc.heroNoNumber];
  for (const s of offStrings) {
    for (const re of ONLINE_WORDS) assert.ok(!re.test(s), `${locale}: "${s}" matches ${re}`);
  }
  for (const [label, off] of [
    ["no agentState", render(locale, null)],
    ["to_activate", render(locale, null, TO_ACTIVATE)],
  ] as const) {
    const offText = text(off);
    for (const re of ONLINE_WORDS) assert.ok(!re.test(offText), `${locale} ${label}: hero text matches ${re}`);
    assert.ok(offText.includes(dc.heroToActivate), `${locale} ${label}: eyebrow says "to activate"`);
    assert.ok(offText.includes(dc.wowToActivateLabel), `${locale} ${label}: badge says "to activate"`);
    assert.ok(offText.includes(dc.heroNoNumber), `${locale} ${label}: no-number line`);
    assert.match(off, ONBOARDING_HREF, `${locale} ${label}: link to get a number`);
    assert.doesNotMatch(off, PLANS_HREF, `${locale} ${label}: no plans link`);
    assert.doesNotMatch(off, SUPPORT_HREF, `${locale} ${label}: no support link`);
    assert.ok(!offText.includes(dc.heroAttention), `${locale} ${label}: no "to check"`);
    assert.ok(!off.includes("animate-ping"), `${locale} ${label}: no live ping`);
    assert.ok(!off.includes("animate-[wave"), `${locale} ${label}: waveform still`);
  }

  // 5. Live (number only, and the server's live): today's rendering (number,
  // "online 24/7", "Live", both pings and the moving waveform), no line.
  for (const [label, on] of [
    ["number only", render(locale, MOCK_PHONE)],
    ["live", render(locale, MOCK_PHONE, LIVE)],
  ] as const) {
    const onText = text(on);
    assert.ok(onText.includes(dc.heroLive), `${locale} ${label}: eyebrow says online`);
    assert.ok(onText.includes(dc.wowLiveLabel), `${locale} ${label}: badge says Live`);
    assert.ok(!onText.includes(dc.heroToActivate), `${locale} ${label}: no "to activate" wording`);
    assert.ok(!onText.includes(dc.heroNoNumber), `${locale} ${label}: no "no number" line`);
    assert.ok(!onText.includes(dc.heroAttention), `${locale} ${label}: no "to check"`);
    assert.ok(/972/.test(onText), `${locale} ${label}: number shown`);
    assert.equal(on.match(/animate-ping/g)?.length, 2, `${locale} ${label}: eyebrow and badge ping`);
    assert.ok(on.includes("animate-[wave"), `${locale} ${label}: waveform moves`);
    for (const re of [PLANS_HREF, SUPPORT_HREF, ONBOARDING_HREF]) {
      assert.doesNotMatch(on, re, `${locale} ${label}: no action link`);
    }
  }

  // 6. Attention: "to check" eyebrow and amber badge, the number, the line of
  // its reason with its own action only, nothing pinging or waving.
  for (const [label, state, lineKey, linkKey, own, other] of [
    ["subscription_inactive", SUB, "heroSubscriptionInactive", "heroSeePlans", PLANS_HREF, SUPPORT_HREF],
    ["config_unavailable", CONFIG, "heroConfigUnavailable", "heroContactTeam", SUPPORT_HREF, PLANS_HREF],
  ] as const) {
    const html = render(locale, MOCK_PHONE, state);
    const t = text(html);
    assert.ok(t.includes(dc.heroAttention), `${locale} ${label}: eyebrow says "to check"`);
    assert.ok(t.includes(dc.wowAttentionLabel), `${locale} ${label}: badge says "to check"`);
    assert.ok(html.includes("bg-[#fde68a]"), `${locale} ${label}: amber badge`);
    assert.ok(t.includes(dc[lineKey]), `${locale} ${label}: its line`);
    assert.ok(t.includes(dc[linkKey]), `${locale} ${label}: its action`);
    assert.match(html, own, `${locale} ${label}: its link`);
    assert.doesNotMatch(html, other, `${locale} ${label}: not the other reason's link`);
    assert.doesNotMatch(html, ONBOARDING_HREF, `${locale} ${label}: no "get a number" link`);
    for (const k of ["heroLive", "wowLiveLabel", "heroToActivate", "heroNoNumber"]) {
      assert.ok(!t.includes(dc[k]), `${locale} ${label}: no ${k}`);
    }
    assert.ok(/972/.test(t), `${locale} ${label}: number shown`);
    assert.ok(!html.includes("animate-ping"), `${locale} ${label}: no live ping`);
    assert.ok(!html.includes("animate-[wave"), `${locale} ${label}: waveform still`);
    for (const k of [lineKey, linkKey, "heroAttention", "wowAttentionLabel"]) {
      assert.doesNotMatch(dc[k], TECHNICAL_WORDS, `${locale} ${k}: no technical word`);
    }
  }
  // 7. engine_unreachable (our side is down): grey "offline" eyebrow and
  // badge, its line, no action at all, nothing pinging or waving.
  {
    const html = render(locale, MOCK_PHONE, ENGINE);
    const t = text(html);
    assert.ok(t.includes(dc.heroOffline), `${locale} engine_unreachable: eyebrow says offline`);
    assert.ok(t.includes(dc.wowOfflineLabel), `${locale} engine_unreachable: badge says offline`);
    assert.ok(t.includes(dc.heroEngineUnreachable), `${locale} engine_unreachable: its line`);
    assert.ok(!html.includes("bg-[#fde68a]"), `${locale} engine_unreachable: grey badge, not amber`);
    assert.ok(html.includes("bg-white/10 text-white"), `${locale} engine_unreachable: grey badge`);
    for (const re of [PLANS_HREF, SUPPORT_HREF, ONBOARDING_HREF]) {
      assert.doesNotMatch(html, re, `${locale} engine_unreachable: no action link`);
    }
    for (const k of ["heroLive", "wowLiveLabel", "heroAttention", "heroToActivate", "heroNoNumber"]) {
      assert.ok(!t.includes(dc[k]), `${locale} engine_unreachable: no ${k}`);
    }
    assert.ok(!html.includes("animate-ping"), `${locale} engine_unreachable: no live ping`);
    assert.ok(!html.includes("animate-[wave"), `${locale} engine_unreachable: waveform still`);
    for (const k of ["heroOffline", "wowOfflineLabel", "heroEngineUnreachable"]) {
      assert.doesNotMatch(dc[k], TECHNICAL_WORDS, `${locale} ${k}: no technical word`);
    }
  }

  // 8. An attention state with a reason this build doesn't know renders as
  // the number rule (live with a number), never a guessed attention state.
  {
    const html = render(locale, MOCK_PHONE, { state: "attention", reason: "mock_future_reason" });
    const t = text(html);
    assert.ok(t.includes(dc.heroLive) && t.includes(dc.wowLiveLabel), `${locale} unknown reason: number rule`);
    for (const k of ["heroAttention", "heroOffline"]) assert.ok(!t.includes(dc[k]), `${locale} unknown reason: no ${k}`);
  }

  // The support link is the shared WhatsApp support link, opened in a new tab.
  const cfg = render(locale, MOCK_PHONE, CONFIG);
  assert.match(cfg, /href="https:\/\/wa\.me\/\d+\?text=[^"]+"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
}

// The design lead's FR and EN copy.
const fr = messages("fr").DashboardConfig;
const en = messages("en").DashboardConfig;
assert.equal(fr.heroAttention, "À vérifier");
assert.equal(fr.wowAttentionLabel, "À vérifier");
assert.equal(fr.heroSubscriptionInactive, "Votre abonnement n'est plus actif : votre agent ne répond pas aux appels.");
assert.equal(fr.heroSeePlans, "Voir les forfaits");
assert.equal(`${fr.heroConfigUnavailable} ${fr.heroContactTeam}`, "Un réglage empêche votre agent de répondre. Contactez l'équipe Tamara.");
assert.equal(en.heroAttention, "To check");
assert.equal(en.wowAttentionLabel, "To check");
assert.equal(en.heroSubscriptionInactive, "Your subscription is no longer active: your agent is not answering calls.");
assert.equal(en.heroSeePlans, "See plans");
assert.equal(fr.heroOffline, "Hors ligne");
assert.equal(fr.wowOfflineLabel, "Hors ligne");
assert.equal(fr.heroEngineUnreachable, "Un incident est en cours de notre côté. Notre équipe est prévenue.");
assert.equal(en.heroOffline, "Offline");
assert.equal(en.wowOfflineLabel, "Offline");
assert.equal(en.heroEngineUnreachable, "An incident is in progress on our side. Our team has been alerted.");
assert.equal(`${en.heroConfigUnavailable} ${en.heroContactTeam}`, "A setting is stopping your agent from answering. Contact the Tamara team.");

// The support number is never hard-coded in the hero.
const heroSrc = readFileSync(join(ROOT, "app/[locale]/dashboard/config/hero-section.tsx"), "utf8");
assert.doesNotMatch(heroSrc, /wa\.me|972\d{6,}/, "hero uses supportHref(), no hard-coded number");

// VP review: a never-activated account is a first step, not a breakdown. "Hors ligne / Offline" is
// only for an agent that our side can't reach (engine_unreachable).
for (const locale of ["fr", "en", "he"]) {
  const dc = JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8")).DashboardConfig;
  for (const k of ["heroToActivate", "wowToActivateLabel", "heroAttention", "wowAttentionLabel"]) {
    assert.doesNotMatch(dc[k], /hors ligne|offline|לא זמינה/i, `${locale} ${k}`);
  }
}
assert.equal(JSON.parse(readFileSync(join(ROOT, "messages/fr.json"), "utf8")).DashboardConfig.wowToActivateLabel, "À activer");

console.log("dashboard-hero-live: ok");
