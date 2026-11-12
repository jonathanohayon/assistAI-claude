// The tenant-bundle matcher: real supplier and tool names are caught,
// per-request base64 noise is not. Mock strings only.
// Run with:  npx tsx scripts/tests/tenant-bundle-match.test.ts

import assert from "node:assert/strict";

import { anonymousDemoInstructions } from "../../lib/demo-instructions";
import { REALTIME_INSTRUCTIONS } from "../../lib/realtime";
import { hits, INSTRUCTION_MARKERS, inBase64Run, inBase64UrlRun } from "../tenant-bundle-match.mjs";

const found = (text: string) => [...(hits(text) as Map<string, string[]>).keys()];

// Supplier names, anywhere.
assert.deepEqual(found("const c=useOpenaiRealtimeCatalog();"), ["openai", "realtime"]);
assert.deepEqual(found('fetch("/api/realtime/catalog/models/openai/list/all")'), ["realtime", "openai"]);
// The suppliers added with the telephony/media/hosting sweep.
assert.deepEqual(found("vos numéros Twilio libérés"), ["twilio"]);
assert.deepEqual(found('makeMessageType("livekit.MetricsBatch")'), ["livekit"]);
assert.deepEqual(found("Configurez TWILIO_WHATSAPP_FROM côté Railway"), ["twilio", "railway"]);
assert.deepEqual(found("via ai-coustics Quail"), ["ai-coustics"]);
assert.deepEqual(found("ElevenLabs, Anthropic, Deepgram, Cartesia"), ["elevenlabs", "anthropic", "deepgram", "cartesia"]);
// Google the integration is tenant-facing; Google's model names are not.
assert.deepEqual(found("Connecter Google Calendar · Google Sheets"), []);
assert.deepEqual(found('{"model":"gemini-2.5-flash"}'), ["gemini"]);
// Model ids without a supplier word in them.
assert.deepEqual(found('model:"gpt-4o-mini"'), ["gpt-4"]);
assert.deepEqual(found("chatgpt-like wording, gpt alone"), [], "gpt- only as the start of a word");
// Ordinary words that start with a supplier name.
assert.deepEqual(found('className:"recharts-cartesian-grid-bg"'), [], "cartesian is not Cartesia");
assert.deepEqual(found("Jean-Claude a rappelé · Resend code"), [], "first names and copy");
// Technical tool names, as whole words.
assert.deepEqual(found('{"name":"book_appointment"}'), ["book_appointment"]);
assert.deepEqual(found("call transfer_call then end_call"), ["transfer_call", "end_call"]);
assert.deepEqual(found("rebook_appointments_count"), [], "not a whole word");
// Instruction text: marker phrases of the demo prompt, any case, anywhere.
assert.deepEqual(found('let i=`Tu es un assistant vocal intelligent et chaleureux pour`'), ["intelligent et chaleureux"]);
assert.deepEqual(found("ACCUEILLE PROACTIVEMENT l'appelant"), ["accueille proactivement"]);
// Every marker really is in the prompt it stands for (else it guards nothing),
// and every demo prompt the server builds carries at least two of them.
const prompts = [REALTIME_INSTRUCTIONS, ...["fr", "en", "he"].map((l) => anonymousDemoInstructions(null, l))];
for (const m of INSTRUCTION_MARKERS as string[]) {
  assert.ok(prompts.some((p) => p.toLowerCase().includes(m.toLowerCase())), `marker not in any prompt: ${m}`);
}
for (const p of prompts) assert.ok(found(p).filter((k) => k.includes(" ")).length >= 2, "demo prompt caught by markers");
for (const l of ["fr", "en", "he"]) {
  assert.ok(found(anonymousDemoInstructions("Mock demo persona.", l)).length >= 1, `demo account prompt (${l}) caught`);
}
// Marketing copy about the product is not instruction text.
assert.deepEqual(found("Tamara accueille vos clients, chaleureuse et concise, 24h/24"), []);
// Plain words in copy are fine.
assert.deepEqual(found("Prendre des rendez-vous · Transférer à une personne"), []);
// Per-request base64 noise is skipped; a chunk path never is.
const blob = "e9aGnhKzjzrdUzbLsv0Ea9ZFsLx/UqxaiMcjn1TE+tICuJzrx9n5U7Tq6+JpgOG";
assert.equal(inBase64Run(blob, blob.indexOf("xai"), 3), true);
assert.deepEqual(found(blob), []);
// A new supplier name inside base64 noise is skipped too.
const blob2 = "Qm9vdHN0cmFwKzEyMw/x9TwilioKp3RzZ+aGVsbG8gd29ybGQ1NjczNDU2Nzg";
assert.equal(inBase64Run(blob2, blob2.indexOf("Twilio"), 6), true);
assert.deepEqual(found(blob2), []);
assert.deepEqual(found("/_next/static/chunks/app/openai-abc123DEF456ghi789.js"), ["openai"]);

// base64url tokens (no "+" or "/"): the settings-page flake, and what must still be caught.
{
  const tok = "q7ffBMHnmJYGmdVZM4IBdcs3xTeA6OxAiOLnwd7L79P0nhgl1K5PBK26GSotf5Z";
  assert.equal(inBase64UrlRun(tok, tok.toLowerCase().indexOf("xai"), 3), true, "random base64url token skipped");
  assert.equal(hits(`<div data-t="${tok}">`).size, 0, "no hit inside the token");
  // Still caught: names in words, env-like identifiers, URLs, short runs.
  for (const real of ["provider: xai", "XAI_API_KEY", "process.env.XAI_API_KEY", "/api/xai/v1", "grok via xAI", "x_xai_realtime_provider_config_value_for_the_agent_2024"]) {
    assert.ok(hits(real).size > 0, `still caught: ${real}`);
  }
}

console.log("ALL TENANT-BUNDLE-MATCH TESTS PASSED");
