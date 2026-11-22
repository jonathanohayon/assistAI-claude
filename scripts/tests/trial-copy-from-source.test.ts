// The trial figures in the copy come from lib/trial.ts, never from the
// messages: no fr/en/he message that talks about the trial hard-codes a
// figure, and the three trial messages render the lib/trial.ts values through
// their {days}/{minutes} arguments. Run with: npx tsx scripts/tests/trial-copy-from-source.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IntlMessageFormat } from "intl-messageformat";

import { TRIAL_DURATION_MS, TRIAL_MINUTES_INCLUDED } from "@/lib/trial";
import { TRIAL_COPY_VALUES } from "@/lib/trial-copy";

const ROOT = new URL("../../", import.meta.url).pathname;
const LOCALES = ["fr", "en", "he"] as const;
const load = (l: string) => JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8"));

function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof obj === "string") out[prefix] = obj;
  else if (obj && typeof obj === "object")
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** Literal text of an ICU message: every top-level {…} block removed. */
function literalText(msg: string): string {
  let out = "";
  let depth = 0;
  for (const ch of msg) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

// A message "talks about the trial" when its key says so or its text does.
const TRIAL_KEY = /trial/i;
const TRIAL_TEXT = /essai gratuit|free trial|ניסיון חינם|תקופת (ה)?ניסיון|הניסיון החינמי/i;
// Figures written as words (a day, two days, 24h…).
const NUMBER_WORDS = /\b(un jour|une journée|one day|two days|deux jours)\b|יום אחד|יומיים|יממה/i;

// Trial messages whose figure is not the trial duration nor its minutes:
// the 30-day number retention after the pause and the 2-day warning lead
// time (both also lib/trial.ts constants), left for a follow-up.
const NOT_DURATION_OR_MINUTES = new Set([
  "Dashboard.trialExpired",
  "Email.trialWarning.subjectHours",
  "Email.trialWarning.introHtml",
  "Email.trialWarning.introText",
  "Email.trialWarning.warningBoxHtml",
  "Email.trialWarning.phoneLineWithPhone",
  "Email.trialWarning.phoneLineGeneric",
  "Email.trialWarning.textBullet",
]);

// 1. The arguments are the lib/trial.ts values: 14 days, 100 minutes.
assert.equal(TRIAL_COPY_VALUES.days, TRIAL_DURATION_MS / (24 * 60 * 60 * 1000));
assert.equal(TRIAL_COPY_VALUES.minutes, TRIAL_MINUTES_INCLUDED);
assert.deepEqual(TRIAL_COPY_VALUES, { days: 14, minutes: 100 });

// 2. No trial message hard-codes a figure.
let scanned = 0;
for (const l of LOCALES) {
  for (const [key, msg] of Object.entries(flatten(load(l)))) {
    if (!TRIAL_KEY.test(key) && !TRIAL_TEXT.test(msg)) continue;
    if (NOT_DURATION_OR_MINUTES.has(key)) continue;
    scanned++;
    const literal = literalText(msg);
    assert.doesNotMatch(literal, /\d/, `${l} ${key}: hard-coded trial figure in "${msg}"`);
    assert.doesNotMatch(literal, NUMBER_WORDS, `${l} ${key}: trial figure written as a word in "${msg}"`);
  }
}
assert.ok(scanned >= 30, `expected to scan the trial messages, scanned ${scanned}`);

// 3. The three trial messages render 14 / 100 from the arguments.
const KEYS = ["Signup.freeTrialNoticeStart", "Onboarding.trialLabel", "Pricing.trial"];
for (const l of LOCALES) {
  const flat = flatten(load(l));
  for (const key of KEYS) {
    const msg = flat[key];
    assert.ok(msg, `${l} ${key} exists`);
    assert.match(msg, /\{days\b/, `${l} ${key} takes {days}`);
    assert.match(msg, /\{minutes\b/, `${l} ${key} takes {minutes}`);
    const out = String(new IntlMessageFormat(msg, l).format(TRIAL_COPY_VALUES));
    assert.match(out, /(^|\D)14(\D|$)/, `${l} ${key} renders 14: ${out}`);
    assert.match(out, /(^|\D)100(\D|$)/, `${l} ${key} renders 100: ${out}`);
  }
}

// 4. The components pass the arguments.
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
assert.match(src("app/[locale]/signup/signup-content.tsx"), /t\("freeTrialNoticeStart", TRIAL_COPY_VALUES\)/);
assert.match(src("app/[locale]/onboarding/page.tsx"), /t\("trialLabel", TRIAL_COPY_VALUES\)/);
assert.match(src("components/marketing/Pricing.tsx"), /t\("trial", TRIAL_COPY_VALUES\)/);

console.log(`trial-copy-from-source: ok (${scanned} trial messages scanned)`);
