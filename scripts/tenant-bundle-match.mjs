// What a tenant's browser must never receive (scripts/check-tenant-bundle.mjs):
//   - supplier names (Voice brick rule);
//   - the technical names of the agent's tools (Tools brick rule: tenants
//     see capabilities in plain words; the names are admin-only, in the
//     admin response only);
//   - the agent's instructions (marker phrases), e.g. the landing demo's
//     prompt, which the server sets on the session (lib/demo-session.ts).
// Also run on the public pages by scripts/check-public-bundle.mjs.
// Pure, so scripts/tests/tenant-bundle-match.test.ts can probe it.

// Every company behind the product (package.json dependencies, env var
// prefixes in lib/): voice engines, telephony, media, hosting, scraping.
// Deliberately NOT here:
//   - "google": Google Calendar / Sheets / sign-in is a tenant-facing
//     integration by design. Google's MODEL names (gemini…) are listed.
//   - "whatsapp" / "meta": a channel the tenant chooses and sees.
//   - "claude": a common French first name (Jean-Claude in a tenant's own
//     contacts or call logs); the company name "anthropic" is listed.
//   - "resend": an English word in copy ("Resend code").
//   - "hyp": the payment page the tenant is sent to names it; as a bare
//     substring it would also hit "hyphen".
export const SUPPLIERS = [
  "openai",
  "grok",
  "gemini",
  "xai",
  "realtime",
  "twilio",
  "livekit",
  "elevenlabs",
  "anthropic",
  "deepgram",
  "cartesia",
  "railway",
  "ai-coustics",
  "aicoustics",
  "krisp",
  "jina",
];
export const TOOL_NAMES = [
  "list_available_dates",
  "check_availability",
  "book_appointment",
  "save_contact",
  "find_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "transfer_call",
  "record_order",
  "end_call",
  "list_services",
  "list_centres",
  "get_opening_hours",
  "get_centre_info",
];
// Marker phrases of the agent's instructions (lib/realtime.ts
// REALTIME_INSTRUCTIONS, lib/demo-instructions.ts, lib/demo-register.ts): a
// browser bundle carrying one carries the prompt. ASCII-only, no quotes, so a
// minifier's escaping can't hide them; matched case-insensitively, anywhere.
export const INSTRUCTION_MARKERS = [
  "intelligent et chaleureux",
  "Sois concis, professionnel",
  "accueille proactivement",
  "greet the caller first",
  "very first sentence must be in",
  "ne le tutoie jamais",
];
// Supplier names that are the start of an ordinary word get a guard:
// recharts ships "cartesian" in every chart chunk.
export const SUPPLIER_GUARDS = { cartesia: "(?!n)" };
const supplierAlternatives = SUPPLIERS.map((s) => s + (SUPPLIER_GUARDS[s] ?? ""));
// Model ids that name no supplier word on their own (gpt-4o, gpt-5…).
export const MODEL_IDS = ["gpt-[0-9a-z]"];
// Tool names and model ids are whole words; supplier names and instruction
// markers match anywhere.
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const PATTERN = new RegExp(
  `${INSTRUCTION_MARKERS.map(escapeRe).join("|")}|${supplierAlternatives.join("|")}|\\b(?:${MODEL_IDS.join("|")})|\\b(?:${TOOL_NAMES.join("|")})\\b`,
  "gi",
);

// A match inside a long base64 run (per-request encoded bytes, e.g. a
// serialized payload) is random letters, not a word: "…/UqxaiMcjn…" flaked
// once. Identifiers and copy never contain "+" or "/", so such a run is
// skipped only when it does.
export const inBase64Run = (text, index, length) => {
  let s = index, e = index + length;
  while (s > 0 && /[A-Za-z0-9+/]/.test(text[s - 1])) s--;
  while (e < text.length && /[A-Za-z0-9+/]/.test(text[e])) e++;
  const run = text.slice(s, e);
  // Also mixed case with digits, so a long lowercase URL path that names a
  // supplier (e.g. /api/realtime/…) is never skipped.
  return (
    run.length >= 40 &&
    /[+/]/.test(run) &&
    !/\/_next\//.test(run) &&
    (run.match(/[A-Z]/g) ?? []).length >= 3 &&
    (run.match(/[0-9]/g) ?? []).length >= 2
  );
};
export const hits = (text) => {
  const out = new Map();
  for (const m of text.matchAll(PATTERN)) {
    if (inBase64Run(text, m.index, m[0].length)) continue;
    const ctx = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ");
    const key = m[0].toLowerCase();
    if (!out.has(key)) out.set(key, []);
    if (out.get(key).length < 3) out.get(key).push(ctx);
  }
  return out;
};
