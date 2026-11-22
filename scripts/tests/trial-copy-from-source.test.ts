// The trial figures in the copy come from lib/trial.ts, never from the
// messages: no fr/en/he message that talks about the trial hard-codes a
// figure, and the three trial messages render the lib/trial.ts values through
// their {days}/{minutes} arguments, and the end-of-trial messages render the
// warning lead time and the number retention through {warningDays}/{retentionDays}. Run with: npx tsx scripts/tests/trial-copy-from-source.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IntlMessageFormat } from "intl-messageformat";

import {
  TRIAL_DURATION_MS,
  TRIAL_MINUTES_INCLUDED,
  TRIAL_NUMBER_RELEASE_AFTER_MS,
  TRIAL_WARNING_BEFORE_END_MS,
} from "@/lib/trial";
import { TRIAL_COPY_VALUES, TRIAL_END_COPY_VALUES } from "@/lib/trial-copy";

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


// 1. The arguments are the lib/trial.ts values: 14 days, 100 minutes.
assert.equal(TRIAL_COPY_VALUES.days, TRIAL_DURATION_MS / (24 * 60 * 60 * 1000));
assert.equal(TRIAL_COPY_VALUES.minutes, TRIAL_MINUTES_INCLUDED);
assert.deepEqual(TRIAL_COPY_VALUES, { days: 14, minutes: 100 });

// 2. No trial message hard-codes a figure.
let scanned = 0;
for (const l of LOCALES) {
  for (const [key, msg] of Object.entries(flatten(load(l)))) {
    if (!TRIAL_KEY.test(key) && !TRIAL_TEXT.test(msg)) continue;
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

// 5. The end-of-trial figures: the 2-day warning lead time and the 30-day
// number retention come from lib/trial.ts through {warningDays}/{retentionDays}.
const DAY = 24 * 60 * 60 * 1000;
assert.equal(TRIAL_END_COPY_VALUES.warningDays, TRIAL_WARNING_BEFORE_END_MS / DAY);
assert.equal(TRIAL_END_COPY_VALUES.retentionDays, TRIAL_NUMBER_RELEASE_AFTER_MS / DAY);
assert.deepEqual(TRIAL_END_COPY_VALUES, { warningDays: 2, retentionDays: 30 });

const END_KEYS: Record<string, "warningDays" | "retentionDays"> = {
  "Email.trialWarning.subjectHours": "warningDays",
  "Email.trialWarning.introHtml": "warningDays",
  "Email.trialWarning.introText": "warningDays",
  "Email.trialWarning.textBullet": "warningDays",
  "Email.trialWarning.warningBoxHtml": "retentionDays",
  "Email.trialWarning.phoneLineWithPhone": "retentionDays",
  "Email.trialWarning.phoneLineGeneric": "retentionDays",
  "Email.trialDeleted.phoneLineWithPhone": "retentionDays",
  "Email.trialDeleted.phoneLineGeneric": "retentionDays",
  "Dashboard.trialExpired": "retentionDays",
};
// Hebrew says two days with the dual form, not the digit.
const rendered = (l: string, arg: string, n: number) =>
  l === "he" && arg === "warningDays" && n === 2 ? /יומיים/ : new RegExp(`(^|\\D)${n}(\\D|$)`);
const fmtArgs = (extra: Record<string, number>) => ({
  ...TRIAL_END_COPY_VALUES,
  ...extra,
  phone: "+972500000000",
  phoneLine: "PHONE",
  strong: (c: unknown) => c,
  em: (c: unknown) => c,
});
const fmt = (msg: string, l: string, values: Record<string, unknown>) => {
  const out = new IntlMessageFormat(msg, l).format(values as never);
  return Array.isArray(out) ? out.join("") : String(out);
};
for (const l of LOCALES) {
  const flat = flatten(load(l));
  for (const [key, arg] of Object.entries(END_KEYS)) {
    const msg = flat[key];
    assert.ok(msg, `${l} ${key} exists`);
    assert.match(msg, new RegExp(`\\{${arg}\\b`), `${l} ${key} takes {${arg}}`);
    const n = TRIAL_END_COPY_VALUES[arg];
    const out = fmt(msg, l, fmtArgs({}));
    assert.match(out, rendered(l, arg, n), `${l} ${key} renders the source value ${n}: ${out}`);
    // Another value renders another figure: the figure is the argument.
    const out7 = fmt(msg, l, fmtArgs({ [arg]: 7 }));
    assert.match(out7, rendered(l, arg, 7), `${l} ${key} follows {${arg}}: ${out7}`);
    assert.doesNotMatch(out7, rendered(l, arg, n), `${l} ${key} keeps no literal ${n}: ${out7}`);
  }
}

// 6. The callers pass the arguments.
const email = src("lib/email.ts");
for (const k of ["subjectHours", "introText", "textBullet", "phoneLineGeneric"])
  assert.match(email, new RegExp(`t\\("${k}", TRIAL_END_COPY_VALUES\\)`), `lib/email.ts passes the values to ${k}`);
assert.match(email, /t\.markup\("introHtml", \{ \.\.\.tags, \.\.\.TRIAL_END_COPY_VALUES \}\)/);
assert.match(email, /t\.markup\("warningBoxHtml", \{ \.\.\.tags, \.\.\.TRIAL_END_COPY_VALUES, phoneLine: phoneSpecificHtml \}\)/);
assert.equal((email.match(/t\("phoneLineWithPhone", \{ \.\.\.TRIAL_END_COPY_VALUES, phone: ltrIsolate\(opts\.phoneNumber\) \}\)/g) ?? []).length, 2, "both e-mails pass the values to phoneLineWithPhone");
assert.equal((email.match(/t\("phoneLineGeneric", TRIAL_END_COPY_VALUES\)/g) ?? []).length, 2, "both e-mails pass the values to phoneLineGeneric");
assert.match(src("app/[locale]/dashboard/layout.tsx"), /t\("trialExpired", TRIAL_END_COPY_VALUES\)/);

console.log(`trial-copy-from-source: ok (${scanned} trial messages scanned)`);
