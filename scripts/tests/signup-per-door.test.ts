// The sign-up page's badge, title, subtitle and trial line per door
// (lib/signup-door-copy.ts, app/[locale]/signup/{page,signup-content}.tsx):
//   1. door × usable × locale renders the exact badge, title, subtitle, trial
//      line; no door says "all features" (a trial grants reception only);
//   2. reception (and no door) renders today's title, subtitle and trial line
//      byte for byte (only its badge changed), and the usable flags never
//      change it;
//   3. "usable" comes only from publicOffer().available (lib/public-offer.ts,
//      the pricing cards' rule): flipping its switches moves the copy, and the
//      page reads nothing else;
//   4. an invalid door falls back to reception;
//   5. no trial figure is written in the new messages (TRIAL_COPY_VALUES).
// Mock env only: no network, no database.
// Run with:  npx tsx scripts/tests/signup-per-door.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SignupContent } from "../../app/[locale]/signup/signup-content";
import { parseDoor } from "../../lib/door";
import { DOORS, type Door } from "../../lib/door-values";
import { publicOffer } from "../../lib/public-offer";
import type { PublicAvailability } from "../../lib/public-plan-pricing";
import { RECEPTION_SIGNUP_COPY, signupDoorCopy, type SignupDoorCopy } from "../../lib/signup-door-copy";
import { TRIAL_COPY_VALUES } from "../../lib/trial-copy";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const messages = (l: string) => JSON.parse(read(`messages/${l}.json`));
const LOCALES = ["fr", "en", "he"] as const;
type Locale = (typeof LOCALES)[number];
const Intl = NextIntlClientProvider as unknown as ComponentType<{
  locale: string;
  messages: unknown;
  timeZone?: string;
  children?: ReactNode;
}>;
const noop = async () => {};

function render(locale: Locale, door: Door, copy?: SignupDoorCopy): string {
  return renderToStaticMarkup(
    createElement(
      Intl,
      { locale, messages: messages(locale), timeZone: "UTC" },
      createElement(SignupContent, { error: undefined, door, copy, handleSignup: noop, startGoogleSignup: noop }),
    ),
  );
}

const unescape = (s: string) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

type Header = { badge: string; title: string; subtitle: string; trial: string };

/** The header block: the badge, then h1, subtitle, trial line. */
function header(html: string): Header {
  const h1 = html.match(
    /<\/svg>([^<]*)<\/span>\s*<h1[^>]*>([^<]*)<\/h1>\s*<p[^>]*>([^<]*)<\/p>\s*<p[^>]*>([^<]*)<\/p>/,
  );
  assert.ok(h1, "header block found");
  return { badge: unescape(h1[1]), title: unescape(h1[2]), subtitle: unescape(h1[3]), trial: unescape(h1[4]) };
}

const { days, minutes } = TRIAL_COPY_VALUES;

// Reception: today's title, subtitle and trial line (main before this
// change), byte for byte. Only the badge changes (VP 23/11): "all features"
// was untrue, it now says "free trial, no credit card".
const RECEPTION: Record<Locale, Header> = {
  fr: {
    badge: "Essai gratuit, sans carte bancaire",
    title: "Créez votre agent vocal",
    subtitle: "Opérationnel en 2 minutes. Sans engagement, sans carte bancaire.",
    trial: `${days} jours d'essai gratuit ou ${minutes} minutes d'appels, au premier des deux atteint.`,
  },
  en: {
    badge: "Free trial, no credit card",
    title: "Create your voice agent",
    subtitle: "Up and running in 2 minutes. No commitment, no credit card.",
    trial: `Free trial: ${days} days or ${minutes} call minutes, whichever comes first.`,
  },
  he: {
    badge: "ניסיון חינם, ללא כרטיס אשראי",
    title: "צרו את הסוכן הקולי שלכם",
    subtitle: "מוכן תוך 2 דקות. ללא התחייבות, ללא כרטיס אשראי.",
    trial: `ניסיון חינם: ${days} ימים או ${minutes} דקות שיחה, המוקדם מביניהם.`,
  },
};

// The connect / sales badge: a trial grants reception only, so these doors
// promise a free account, not a trial (and don't repeat the trial line).
const ACCOUNT_BADGE: Record<Locale, string> = {
  fr: "Compte gratuit, sans carte bancaire",
  en: "Free account, no credit card",
  he: "חשבון חינם, ללא כרטיס אשראי",
};

// The old badge's promise, which no door may render any more.
const ALL_FEATURES = /toutes les fonctionnalités|all features|כל הפיצ'רים/;

// The new FR lines put a non-breaking space (U+00A0) before ":" so a narrow
// screen never starts a line with the colon. Reception's lines are untouched.
const RECEPTION_TRIAL: Record<Locale, string> = {
  fr: `Essai gratuit de la Réception\u00a0: ${days} jours ou ${minutes} minutes d'appels, au premier des deux atteint.`,
  en: `Free Reception trial: ${days} days or ${minutes} call minutes, whichever comes first.`,
  he: `ניסיון חינם בקבלה: ${days} ימים או ${minutes} דקות שיחה, המוקדם מביניהם.`,
};

type DoorCopy = { title: string; usable: string; soon: string };
const EXPECTED: Record<"connect" | "sales", Record<Locale, DoorCopy>> = {
  connect: {
    fr: {
      title: "Donnez une voix et un numéro à votre agent",
      usable:
        "Branchez l'agent IA que vous avez déjà\u00a0: il répond au téléphone avec une voix et un numéro Tamara. Sans carte bancaire.",
      soon: "Le branchement de votre agent ouvre bientôt. Créez votre compte\u00a0: vous serez prévenu en premier, et vous pouvez déjà essayer la Réception.",
    },
    en: {
      title: "Give your agent a voice and a number",
      usable: "Plug in the AI agent you already have: it answers the phone with a Tamara voice and number. No credit card.",
      soon: "Connecting your agent opens soon. Create your account: you'll be the first to know, and you can already try Reception.",
    },
    he: {
      title: "תנו לסוכן שלכם קול ומספר",
      usable: "חברו את סוכן ה-AI שכבר יש לכם: הוא עונה לטלפון עם קול ומספר של Tamara. ללא כרטיס אשראי.",
      soon: "חיבור הסוכן שלכם ייפתח בקרוב. צרו חשבון: אתם תהיו הראשונים לדעת, וכבר עכשיו אפשר לנסות את הקבלה.",
    },
  },
  sales: {
    fr: {
      title: "Créez votre centre d'appels",
      usable: "Votre agent appelle vos contacts et note le résultat de chaque appel. Sans carte bancaire.",
      soon: "Le centre d'appels ouvre bientôt. Créez votre compte\u00a0: vous serez prévenu en premier, et vous pouvez déjà essayer la Réception.",
    },
    en: {
      title: "Create your call center",
      usable: "Your agent calls your contacts and records the outcome of every call. No credit card.",
      soon: "The call center opens soon. Create your account: you'll be the first to know, and you can already try Reception.",
    },
    he: {
      title: "צרו את מוקד השיחות שלכם",
      usable: "הסוכן שלכם מתקשר לאנשי הקשר שלכם ורושם את התוצאה של כל שיחה. ללא כרטיס אשראי.",
      soon: "מוקד השיחות ייפתח בקרוב. צרו חשבון: אתם תהיו הראשונים לדעת, וכבר עכשיו אפשר לנסות את הקבלה.",
    },
  },
};

const AVAIL: PublicAvailability[] = [
  { sales: false, connect: false },
  { sales: true, connect: false },
  { sales: false, connect: true },
  { sales: true, connect: true },
];

// ── 1. door × usable × locale ────────────────────────────────────────────
let rendered = 0;
for (const locale of LOCALES) {
  for (const available of AVAIL) {
    for (const door of ["connect", "sales"] as const) {
      const usable = available[door];
      const html = render(locale, door, signupDoorCopy(door, available));
      const got = header(html);
      const want = EXPECTED[door][locale];
      assert.equal(got.badge, ACCOUNT_BADGE[locale], `${locale} ${door} badge: free account`);
      assert.doesNotMatch(unescape(html), ALL_FEATURES, `${locale} ${door} never says "all features"`);
      assert.equal(got.title, want.title, `${locale} ${door} title`);
      assert.equal(got.subtitle, usable ? want.usable : want.soon, `${locale} ${door} usable=${usable} subtitle`);
      assert.equal(got.trial, RECEPTION_TRIAL[locale], `${locale} ${door} trial line names Reception`);
      rendered++;
    }
    // ── 2. reception: today's copy whatever the flags ──────────────────────
    const rHtml = render(locale, "reception", signupDoorCopy("reception", available));
    assert.deepEqual(header(rHtml), RECEPTION[locale], `${locale} reception unchanged (${JSON.stringify(available)})`);
    assert.doesNotMatch(unescape(rHtml), ALL_FEATURES, `${locale} reception never says "all features"`);
    rendered++;
  }
  // Without the prop (any older caller) = reception, the same HTML.
  assert.equal(
    render(locale, "reception"),
    render(locale, "reception", signupDoorCopy("reception", { sales: true, connect: true })),
    `${locale} reception HTML identical with and without copy`,
  );
}
assert.deepEqual(signupDoorCopy("reception", { sales: true, connect: true }), RECEPTION_SIGNUP_COPY);
assert.deepEqual(RECEPTION_SIGNUP_COPY, { title: "title", subtitle: "subtitle", receptionTrial: false });

// ── 3. usable = publicOffer().available, and only that ───────────────────
{
  const copyFor = (door: Door, env: Record<string, string | undefined>) => signupDoorCopy(door, publicOffer(env).available);
  // Today's deployment shape (switches unset) = not usable.
  assert.equal(copyFor("connect", {}).subtitle, "connectSubtitleSoon");
  assert.equal(copyFor("sales", {}).subtitle, "salesSubtitleSoon");
  // Flipping the public offer's switches moves the copy (mock env only).
  assert.equal(copyFor("connect", { CLIENT_AGENT: "all" }).subtitle, "connectSubtitleUsable");
  assert.equal(copyFor("connect", { CLIENT_AGENT: "admin" }).subtitle, "connectSubtitleSoon", "admin-only is not public");
  assert.equal(copyFor("sales", { CAMPAIGN_DISPATCH: "on" }).subtitle, "salesSubtitleUsable");
  assert.equal(copyFor("sales", { CAMPAIGN_DISPATCH: "dry" }).subtitle, "salesSubtitleSoon");
  // One product's switch never moves the other door.
  assert.equal(copyFor("sales", { CLIENT_AGENT: "all" }).subtitle, "salesSubtitleSoon");
  assert.equal(copyFor("connect", { CAMPAIGN_DISPATCH: "on" }).subtitle, "connectSubtitleSoon");
  // Each door's usable flag is publicOffer's own field, for every env tried.
  for (const env of [{}, { CLIENT_AGENT: "all" }, { CAMPAIGN_DISPATCH: "on" }, { CLIENT_AGENT: "all", CAMPAIGN_DISPATCH: "on" }]) {
    const a = publicOffer(env).available;
    assert.equal(copyFor("connect", env).subtitle === "connectSubtitleUsable", a.connect);
    assert.equal(copyFor("sales", env).subtitle === "salesSubtitleUsable", a.sales);
  }

  // The page feeds the helper publicOffer().available, and nothing else.
  const page = read("app/[locale]/signup/page.tsx");
  assert.match(page, /signupDoorCopy\(door, publicOffer\(\)\.available\)/);
  assert.match(page, /import \{ publicOffer \} from "@\/lib\/public-offer";/);
  assert.match(page, /copy=\{copy\}/);
  // The helper and the client component decide nothing themselves.
  const helper = read("lib/signup-door-copy.ts");
  const content = read("app/[locale]/signup/signup-content.tsx");
  for (const [name, src] of [["lib/signup-door-copy.ts", helper], ["signup-content.tsx", content]] as const) {
    assert.doesNotMatch(src, /process\.env|CLIENT_AGENT|CAMPAIGN_DISPATCH|productPurchasable|clientAgentMode|dispatchMode/, name);
    assert.doesNotMatch(src, /from "(\.\/|@\/lib\/)public-offer"/, `${name} never imports the server offer`);
  }
  assert.match(helper, /^import type \{ PublicAvailability \}/m, "availability is a type-only import");
}

// ── 4. an invalid door falls back to reception ───────────────────────────
for (const raw of [undefined, "", "bogus", "connects", "sales-team", "réception", ["connect"], 42]) {
  const door = parseDoor(raw);
  assert.equal(door, "reception", `parseDoor(${JSON.stringify(raw)})`);
  assert.deepEqual(signupDoorCopy(door, { sales: true, connect: true }), RECEPTION_SIGNUP_COPY);
  assert.deepEqual(header(render("fr", door, signupDoorCopy(door, { sales: true, connect: true }))), RECEPTION.fr);
}
assert.deepEqual([...DOORS], ["reception", "sales", "connect"], "the doors this test covers");

// ── 5. no trial figure in the new messages ───────────────────────────────
const NEW_KEYS = [
  "trialBadge",
  "accountBadge",
  "connectTitle",
  "connectSubtitleUsable",
  "connectSubtitleSoon",
  "salesTitle",
  "salesSubtitleUsable",
  "salesSubtitleSoon",
  "freeTrialNoticeReceptionStart",
];
for (const l of LOCALES) {
  const s = messages(l).Signup;
  for (const k of NEW_KEYS) assert.equal(typeof s[k], "string", `${l} Signup.${k}`);
  assert.match(s.freeTrialNoticeReceptionStart, /\{days, plural/);
  assert.match(s.freeTrialNoticeReceptionStart, /\{minutes, plural/);
  for (const k of NEW_KEYS) assert.doesNotMatch(s[k].replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ""), /\d/, `${l} ${k}`);
}
assert.match(read("app/[locale]/signup/signup-content.tsx"), /t\("freeTrialNoticeReceptionStart", TRIAL_COPY_VALUES\)/);

console.log(`signup-per-door: ok (${rendered} renders)`);
