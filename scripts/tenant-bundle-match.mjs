// What a tenant's browser must never receive (scripts/check-tenant-bundle.mjs):
//   - supplier names (Voice brick rule);
//   - the technical names of the agent's tools (Tools brick rule: tenants
//     see capabilities in plain words; the names are admin-only, in the
//     admin response only).
// Pure, so scripts/tests/tenant-bundle-match.test.ts can probe it.

export const SUPPLIERS = ["openai", "grok", "gemini", "xai", "realtime"];
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
// Tool names are whole snake_case words; supplier names match anywhere.
export const PATTERN = new RegExp(`${SUPPLIERS.join("|")}|\\b(?:${TOOL_NAMES.join("|")})\\b`, "gi");

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
