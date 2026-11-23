// The two trial e-mails, rendered by the REAL send functions of lib/email.ts
// (sendTrialWarningEmail, sendTrialDeletedEmail) for a mock account, with
// Resend faked in-process (nothing is sent). On the produced subject, text
// and HTML, in fr/en/he:
//   - every phone number sits inside an LTR isolate (U+2066 … U+2069), so the
//     "+" of "+972…" stays at the start in Hebrew;
//   - the paused e-mail's button is the warning e-mail's button: the brand
//     magenta→rose with the AA stops, white text >= 4.5:1 on both stops;
//   - the paused e-mail never says deleted, and Hebrew writes "Tamara".
// Mock data only (owner@example.test, +972500000000).
// Run with: npx tsx scripts/tests/trial-emails-render.test.ts
import { sentEmails } from "./lib/email-render-harness";

import assert from "node:assert/strict";

const LRI = "⁦";
const PDI = "⁩";
const TO = "owner@example.test";
const PHONE = "+972500000000";
const LOCALES = ["fr", "en", "he"] as const;
const BRAND_CTA = "background:linear-gradient(135deg,#be185d,#db2777);color:#fff;";

/** WCAG contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every occurrence of the phone (digits run, with or without "+") is isolated. */
function phonesIsolated(s: string): { count: number; bare: string[] } {
  const bare: string[] = [];
  let count = 0;
  for (const m of s.matchAll(/\+?972500000000/g)) {
    count++;
    const i = m.index ?? 0;
    const ok = m[0] === PHONE && s[i - 1] === LRI && s[i + m[0].length] === PDI;
    if (!ok) bare.push(s.slice(Math.max(0, i - 12), i + m[0].length + 12));
  }
  return { count, bare };
}

const ctaStyle = (html: string) =>
  html.match(/<a href="https:\/\/aitamara\.com\/dashboard\/billing" style="([^"]+)"/)?.[1];

async function main() {
  const { sendTrialWarningEmail, sendTrialDeletedEmail } = await import("../../lib/email");

  // 0. The CTA stops pass AA with white text.
  for (const stop of ["#be185d", "#db2777"])
    assert.ok(contrast("#ffffff", stop) >= 4.5, `white on ${stop}: ${contrast("#ffffff", stop).toFixed(2)}`);

  for (const locale of LOCALES) {
    for (const withPhone of [true, false]) {
      const phoneNumber = withPhone ? PHONE : null;
      const before = sentEmails.length;
      const w = await sendTrialWarningEmail(TO, { phoneNumber, minutesLeft: 2880, locale });
      const p = await sendTrialDeletedEmail(TO, { phoneNumber, locale });
      assert.ok(w.ok && p.ok, `${locale}: both sent to the fake client`);
      assert.equal(sentEmails.length, before + 2, `${locale}: two payloads recorded`);
      const [warning, paused] = sentEmails.slice(-2);

      for (const [name, mail] of [["warning", warning], ["paused", paused]] as const) {
        for (const part of ["subject", "text", "html"] as const) {
          const { count, bare } = phonesIsolated(mail[part]);
          assert.deepEqual(bare, [], `${locale} ${name} ${part}: phone outside the LTR isolate`);
          if (withPhone && part !== "subject") assert.ok(count >= 1, `${locale} ${name} ${part} shows the number`);
          if (!withPhone) assert.equal(count, 0, `${locale} ${name} ${part}: no number when none is given`);
        }
        // The same brand button in both e-mails.
        const style = ctaStyle(mail.html);
        assert.ok(style, `${locale} ${name}: billing button found`);
        assert.ok(style.includes(BRAND_CTA), `${locale} ${name}: brand button, got "${style}"`);
      }
      assert.equal(ctaStyle(paused.html), ctaStyle(warning.html), `${locale}: paused button = warning button`);

      for (const part of ["subject", "text", "html"] as const) {
        assert.doesNotMatch(paused[part], /delet|supprim|נמחק/i, `${locale} paused ${part} says deleted`);
        if (locale === "he") {
          assert.doesNotMatch(paused[part], /תמרה/, `he paused ${part} spells the name in Hebrew`);
          assert.doesNotMatch(warning[part], /תמרה/, `he warning ${part} spells the name in Hebrew`);
        }
      }
      assert.ok(paused.html.includes('dir="' + (locale === "he" ? "rtl" : "ltr") + '"'), `${locale} paused dir`);
    }
  }

  console.log(
    `trial-emails-render: ok (${sentEmails.length} e-mails rendered, 0 sent; white on #be185d ${contrast("#ffffff", "#be185d").toFixed(2)}:1, on #db2777 ${contrast("#ffffff", "#db2777").toFixed(2)}:1)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
