// The post-call WhatsApp recap is signed with the tenant's OWN business name
// (agent_configs.business.identity.name), or not signed at all — never with
// another customer's name. Mock tenants, mocked fetch: no OpenAI or Twilio
// call leaves the process, and the credentials below are fake.
// Run with:  npx tsx scripts/tests/summary-signature.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_SUMMARY_PROMPT,
  buildSummarySystemPrompt,
  signClientMessage,
  summarizeCall,
  summarySignature,
} from "../../lib/summarize";
import { withCallUsLine } from "../../lib/whatsapp-call-line";
import { sendWhatsApp } from "../../lib/whatsapp";

import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Fake credentials, mocked network.
for (const k of Object.keys(process.env)) if (/^(OPENAI|REALTIME|TWILIO|WHATSAPP)/.test(k)) delete process.env[k];
process.env.OPENAI_API_KEY = "sk-mock";
process.env.WHATSAPP_PROVIDER = "twilio";
process.env.TWILIO_ACCOUNT_SID = "ACmock";
process.env.TWILIO_AUTH_TOKEN = "mock";
process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+15550000000";

const MOCK_LLM = {
  summary: "Mock caller booked a mock appointment.",
  for_client: "Bonjour Mock, votre rendez-vous du 01/01 à 10:00 est confirmé. Merci de votre appel 🙂",
  for_owner: "Cliente : Mock · Motif : RDV · 01/01 10:00",
};
let lastOpenAiBody: { messages: Array<{ role: string; content: string }> } | null = null;
let lastTwilioForm: URLSearchParams | null = null;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = String(input);
  if (u.startsWith("https://api.openai.com/")) {
    lastOpenAiBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(MOCK_LLM) } }] }), { status: 200 });
  }
  if (u.startsWith("https://api.twilio.com/")) {
    lastTwilioForm = new URLSearchParams(String(init?.body));
    return new Response(JSON.stringify({ sid: "SMmock" }), { status: 201 });
  }
  throw new Error(`unexpected fetch ${u}`);
}) as typeof fetch;

const TENANT_A = { identity: { name: "Demo Salon A", tagline: "", email: "" }, centres: [], services: [] };
const TENANT_EMPTY = { identity: { name: "", tagline: "", email: "" }, centres: [], services: [] };
const TRANSCRIPT = [
  { role: "user" as const, text: "Bonjour, je voudrais un rendez-vous." },
  { role: "assistant" as const, text: "Avec plaisir, c'est noté." },
];

async function main() {
  // 1. The signature is the tenant's own name, or ''.
  assert.equal(summarySignature(TENANT_A), "Demo Salon A");
  assert.equal(summarySignature(TENANT_EMPTY), "");
  assert.equal(summarySignature(null), "", "no business JSON → no signature");
  assert.equal(summarySignature({ identity: { name: "  Demo\nSalon   A " } }), "Demo Salon A", "one line");
  assert.equal(signClientMessage("Merci 🙂  ", "Demo Salon A"), "Merci 🙂\n\n— Demo Salon A");
  assert.equal(signClientMessage("Merci 🙂", ""), "Merci 🙂", "empty name → unsigned");

  // 2. The default prompt names no business and asks the model not to sign.
  assert.doesNotMatch(DEFAULT_SUMMARY_PROMPT, FIRST_CUSTOMER_FACTS);
  assert.doesNotMatch(DEFAULT_SUMMARY_PROMPT, /sign[ée] '/, "no fixed signature in the prompt");
  assert.match(DEFAULT_SUMMARY_PROMPT, /Ne signe pas le message/);
  assert.doesNotMatch(read("lib/summarize.ts"), FIRST_CUSTOMER_FACTS, "no first-customer fact in lib/summarize.ts");
  // An admin per-plan prompt can use {business_name}.
  assert.equal(buildSummarySystemPrompt("Signe '{business_name}' en {target_language}", "en", "Demo Salon A"), "Signe 'Demo Salon A' en anglais (US)");
  assert.equal(buildSummarySystemPrompt("Signe '{business_name}'", "fr", ""), "Signe ''");

  // 3. Two mock tenants through summarizeCall (default prompt).
  const a = await summarizeCall(TRANSCRIPT, null, "fr", summarySignature(TENANT_A));
  const sysA = lastOpenAiBody!.messages[0].content;
  assert.equal(a.forClient, `${MOCK_LLM.for_client}\n\n— Demo Salon A`);
  const e = await summarizeCall(TRANSCRIPT, null, "fr", summarySignature(TENANT_EMPTY));
  const sysE = lastOpenAiBody!.messages[0].content;
  assert.equal(e.forClient, MOCK_LLM.for_client, "empty name → no signature at all");
  assert.doesNotMatch(e.forClient, /—\s*$/);
  for (const t of [sysA, sysE, a.forClient, e.forClient]) assert.doesNotMatch(t, FIRST_CUSTOMER_FACTS);
  assert.equal(sysA, sysE, "the default prompt is the same for every tenant");
  // Owner recap, Sheets row and stored summary: untouched (the model's text).
  for (const s of [a, e]) {
    assert.equal(s.forOwner, MOCK_LLM.for_owner);
    assert.equal(s.raw, MOCK_LLM.summary);
  }
  // An admin prompt: its text decides, the code adds nothing.
  const c = await summarizeCall(TRANSCRIPT, "Custom {business_name}", "fr", "Demo Salon A");
  assert.equal(lastOpenAiBody!.messages[0].content, "Custom Demo Salon A");
  assert.equal(c.forClient, MOCK_LLM.for_client);

  // 4. Approved template: only the VALUE of {{1}} changes, never the SID.
  const SID = "HXmockclienttemplate";
  const clientText = withCallUsLine(a.forClient, "fr", "+15550000001");
  const r = await sendWhatsApp({ to: "+15550000002", body: clientText, templateSid: SID, templateVariables: { "1": clientText } });
  assert.ok(r.ok);
  assert.equal(lastTwilioForm!.get("ContentSid"), SID);
  assert.equal(lastTwilioForm!.get("Body"), null, "a template send carries no free text");
  const vars = JSON.parse(lastTwilioForm!.get("ContentVariables")!);
  assert.deepEqual(Object.keys(vars), ["1"]);
  assert.match(vars["1"], /— Demo Salon A · 📞/);
  assert.doesNotMatch(vars["1"], FIRST_CUSTOMER_FACTS);
  const templateValueA = vars["1"];
  // Free-form (WhatsApp-channel call): the body itself.
  await sendWhatsApp({ to: "+15550000002", body: withCallUsLine(e.forClient, "fr", "+15550000001") });
  const freeFormEmpty = lastTwilioForm!.get("Body")!;
  assert.equal(lastTwilioForm!.get("ContentSid"), null);
  assert.doesNotMatch(freeFormEmpty, /—/, "unsigned");
  assert.doesNotMatch(freeFormEmpty, FIRST_CUSTOMER_FACTS);

  // 5. The route passes the tenant's own business name.
  const route = read("app/api/calls/end/route.ts");
  assert.match(route, /summarizeCall\(transcript, customPrompt, targetLang, summarySignature\(cfg\.business\)\)/);
  assert.doesNotMatch(route, /prestige|johana/i, "no first-customer name in the route");

  if (process.env.PRINT_RENDERED) {
    console.log(JSON.stringify({ templateValueA, freeFormEmpty, signedClient: a.forClient }, null, 2));
  }
  console.log("ALL SUMMARY-SIGNATURE TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
