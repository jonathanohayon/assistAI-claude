// Owner WhatsApp recap (lib/owner-recap-whatsapp.ts): the wrapper is in the
// tenant's language with the owner recap email's strings, French is
// byte-identical to the old hard-coded text, the template SID per language
// is unchanged and only the {{1}} value is built locally. The sender is
// INJECTED: the WhatsApp provider is never reached.
// Mock data only (+1555, "Demo Salon").
// Run with:  npx tsx scripts/tests/owner-recap-whatsapp.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { RecapLocale, RecapStrings } from "../../lib/owner-recap-email";
import {
  ownerRecapTemplateSid,
  ownerRecapWhatsAppDeps,
  ownerRecapWhatsAppMessage,
  ownerRecapWhatsAppText,
  sendOwnerRecapWhatsApp,
  toRecapLocale,
} from "../../lib/owner-recap-whatsapp";
import { ltrIsolate } from "../../lib/phone-utils";
import type { WhatsAppOptions } from "../../lib/whatsapp";
import { SUPPLIERS } from "../tenant-bundle-match.mjs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const SUPPLIER_RE = new RegExp((SUPPLIERS as string[]).map((s) => s.replace(/[-]/g, "\\-")).join("|"), "i");

/** next-intl-like `t` over messages/<locale>.json → Email.ownerRecap. */
const stringsFor = (locale: RecapLocale): RecapStrings => {
  const ns = (JSON.parse(read(`messages/${locale}.json`)) as { Email: { ownerRecap: Record<string, string> } }).Email.ownerRecap;
  return (key, vars) => {
    const s = ns[key];
    assert.ok(typeof s === "string", `${locale}: Email.ownerRecap.${key} exists`);
    return s.replace(/\{(\w+)\}/g, (_, k: string) => vars?.[k] ?? `{${k}}`);
  };
};

/** The text main built inline in app/api/calls/end/route.ts, verbatim. */
const mainOwnerBody = (forOwner: string, fromNumber: string) =>
  `📞 Nouvel appel reçu\n\n${forOwner}\n\n— ${fromNumber ? ltrIsolate(fromNumber) : "numéro inconnu"}`;

const RECAP = "Demo Salon: a client asked for a haircut on Tuesday at 10:00.\nCallback requested.";
const CALLER = "+15550001111";
const OWNER = "+15550002222";

const ENV = {
  WHATSAPP_OWNER_TEMPLATE_SID_FR: "HX_MOCK_OWNER_FR",
  WHATSAPP_OWNER_TEMPLATE_SID_HE: "HX_MOCK_OWNER_HE",
  WHATSAPP_OWNER_TEMPLATE_SID_EN: "HX_MOCK_OWNER_EN",
  WHATSAPP_OWNER_TEMPLATE_SID: "HX_MOCK_OWNER_LEGACY",
};

async function main() {
  // ── 0. Locale: fr / he / en, anything else → fr ──────────────────────
  assert.equal(toRecapLocale("fr"), "fr");
  assert.equal(toRecapLocale("he"), "he");
  assert.equal(toRecapLocale("EN"), "en");
  assert.equal(toRecapLocale("en-US"), "en");
  for (const unknown of ["de", "ar", "", null, undefined]) {
    assert.equal(toRecapLocale(unknown), "fr", `unknown language ${JSON.stringify(unknown)} falls back to fr`);
  }

  // ── 1. French is byte-identical to main's output ─────────────────────
  for (const from of [CALLER, ""]) {
    for (const recap of [RECAP, "  padded recap  ", ""]) {
      assert.equal(
        ownerRecapWhatsAppText({ forOwner: recap, fromNumber: from }, stringsFor("fr")),
        mainOwnerBody(recap, from),
        `fr byte-identical (from=${JSON.stringify(from)}, recap=${JSON.stringify(recap)})`,
      );
    }
  }
  // Unknown language → the French text, byte for byte.
  assert.equal(
    ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: CALLER }, stringsFor(toRecapLocale("de"))),
    mainOwnerBody(RECAP, CALLER),
  );

  // ── 2. English and Hebrew use the localised wrapper ──────────────────
  assert.equal(
    ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: CALLER }, stringsFor("en")),
    `📞 New call received\n\n${RECAP}\n\n— ${ltrIsolate(CALLER)}`,
  );
  assert.equal(
    ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: "" }, stringsFor("en")),
    `📞 New call received\n\n${RECAP}\n\n— unknown number`,
  );
  assert.equal(
    ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: CALLER }, stringsFor("he")),
    `📞 התקבלה שיחה חדשה\n\n${RECAP}\n\n— ${ltrIsolate(CALLER)}`,
  );
  assert.equal(
    ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: null }, stringsFor("he")),
    `📞 התקבלה שיחה חדשה\n\n${RECAP}\n\n— מספר לא ידוע`,
  );
  for (const l of ["en", "he"] as const) {
    const text = ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: "" }, stringsFor(l));
    assert.doesNotMatch(text, /Nouvel appel|numéro inconnu/, `${l}: no French wrapper left`);
  }

  // ── 3. Template path: SID per language, unchanged; only {{1}} built ──
  assert.equal(ownerRecapTemplateSid("fr", ENV), "HX_MOCK_OWNER_FR");
  assert.equal(ownerRecapTemplateSid("he", ENV), "HX_MOCK_OWNER_HE");
  assert.equal(ownerRecapTemplateSid("en", ENV), "HX_MOCK_OWNER_EN");
  assert.equal(ownerRecapTemplateSid(null, ENV), "HX_MOCK_OWNER_FR", "no language → the FR SID");
  assert.equal(ownerRecapTemplateSid("de", ENV), "HX_MOCK_OWNER_LEGACY", "no SID for the language → legacy SID");
  assert.equal(
    ownerRecapTemplateSid("he", { WHATSAPP_OWNER_TEMPLATE_SID: "HX_MOCK_OWNER_LEGACY" }),
    "HX_MOCK_OWNER_LEGACY",
    "per-language SID unset → legacy SID",
  );
  assert.equal(ownerRecapTemplateSid("he", {}), undefined, "no SID at all → free-form");

  const longRecap = "x".repeat(1500);
  for (const [lang, locale, sid] of [
    ["fr", "fr", "HX_MOCK_OWNER_FR"],
    ["he", "he", "HX_MOCK_OWNER_HE"],
    ["en", "en", "HX_MOCK_OWNER_EN"],
  ] as const) {
    const t = stringsFor(locale);
    const msg = ownerRecapWhatsAppMessage({ to: OWNER, forOwner: RECAP, fromNumber: CALLER, primaryLanguage: lang }, t, ENV);
    const text = ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: CALLER }, t);
    assert.equal(msg.templateSid, sid, `${lang}: SID`);
    assert.deepEqual(msg.templateVariables, { "1": text }, `${lang}: only {{1}}, the recap text`);
    assert.equal(msg.body, text, `${lang}: same text as the free-form body`);
    assert.equal(msg.to, OWNER);
    assert.equal(msg.ownerTemplateFallback, true);
    // {{1}} is clipped at 1000 like on main.
    const long = ownerRecapWhatsAppMessage({ to: OWNER, forOwner: longRecap, fromNumber: CALLER, primaryLanguage: lang }, t, ENV);
    assert.equal(long.templateVariables?.["1"].length, 1000, `${lang}: {{1}} ≤ 1000`);
  }
  // fr template payload: byte-identical to main's.
  {
    const msg = ownerRecapWhatsAppMessage({ to: OWNER, forOwner: RECAP, fromNumber: CALLER, primaryLanguage: "fr" }, stringsFor("fr"), ENV);
    assert.deepEqual(msg, {
      to: OWNER,
      body: mainOwnerBody(RECAP, CALLER),
      templateSid: "HX_MOCK_OWNER_FR",
      templateVariables: { "1": mainOwnerBody(RECAP, CALLER).slice(0, 1000) },
      ownerTemplateFallback: true,
    });
  }
  // The template's own text is never built here: no ContentSid payload, no
  // template body, only the SID read from env and the {{1}} value.
  {
    const src = read("lib/owner-recap-whatsapp.ts").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /ContentSid|ContentVariables|"2"|\{\{/, "no template text built locally");
    assert.doesNotMatch(src, /HX[A-Za-z0-9]{8,}/, "no hard-coded SID");
  }

  // ── 4. Free-form path: no SID → Body only ────────────────────────────
  for (const locale of ["fr", "he", "en"] as const) {
    const t = stringsFor(locale);
    const msg = ownerRecapWhatsAppMessage({ to: OWNER, forOwner: RECAP, fromNumber: "", primaryLanguage: locale }, t, {});
    assert.equal(msg.templateSid, undefined);
    assert.equal(msg.templateVariables, undefined);
    assert.equal(msg.body, ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: "" }, t));
  }
  assert.equal(
    ownerRecapWhatsAppMessage({ to: OWNER, forOwner: RECAP, fromNumber: "", primaryLanguage: "fr" }, stringsFor("fr"), {}).body,
    mainOwnerBody(RECAP, ""),
    "fr free-form byte-identical",
  );

  // ── 5. No supplier name in the rendered text ─────────────────────────
  for (const locale of ["fr", "he", "en"] as const) {
    for (const from of [CALLER, ""]) {
      const text = ownerRecapWhatsAppText({ forOwner: RECAP, fromNumber: from }, stringsFor(locale));
      assert.doesNotMatch(text, SUPPLIER_RE, `${locale}: names no supplier`);
    }
  }

  // ── 6. Injected sender: one send, never the provider ─────────────────
  {
    const sent: WhatsAppOptions[] = [];
    const real = ownerRecapWhatsAppDeps.send;
    ownerRecapWhatsAppDeps.send = async (opts) => {
      sent.push(opts);
      return { ok: true, sid: "SM_MOCK" };
    };
    try {
      const r = await sendOwnerRecapWhatsApp(
        { to: OWNER, forOwner: RECAP, fromNumber: CALLER, primaryLanguage: "he" },
        stringsFor("he"),
        ENV,
      );
      assert.deepEqual(r, { ok: true, sid: "SM_MOCK" });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].templateSid, "HX_MOCK_OWNER_HE");
      assert.match(sent[0].body, /^📞 התקבלה שיחה חדשה/);
    } finally {
      ownerRecapWhatsAppDeps.send = real;
    }
  }

  // ── 7. The route goes through the module (no inline French left) ─────
  {
    const route = read("app/api/calls/end/route.ts");
    assert.doesNotMatch(route, /Nouvel appel reçu|numéro inconnu/, "route: no hard-coded French wrapper");
    assert.match(route, /sendOwnerRecapWhatsApp\(/, "route: owner recap via the module");
    assert.match(route, /namespace: "Email\.ownerRecap"/, "route: same strings as the email");
  }

  console.log("ALL OWNER RECAP WHATSAPP TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
