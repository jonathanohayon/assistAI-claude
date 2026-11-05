// AI disclosure in the greeting (EU AI Act art. 50; good practice under the
// Israeli privacy rules). Pure: no I/O.
//
// One function, `effectiveGreeting`, gives the greeting the caller hears.
// It feeds BOTH the pre-rendered opener (greeting-audio, warm-up) and the
// model greeting (/api/agent/config → worker speaks it verbatim), so the two
// paths can never disagree.
//
// Wording is gender-neutral for the agent AND the caller ("une intelligence
// artificielle", "בינה מלאכותית", "an AI assistant").

export type DisclosureLang = "fr" | "he" | "en";

export const AI_DISCLOSURE_MAX_LENGTH = 200;

function lang(l: string | null | undefined): DisclosureLang {
  return l === "he" ? "he" : l === "en" ? "en" : "fr";
}

/** Already says it's an AI? Then we never add a second disclosure. */
// "IA"/"AI" are case-sensitive on purpose: French "j'ai" must not count.
const DISCLOSES_AI_ACRONYM = /\b(IA|AI)\b/u;
const DISCLOSES_AI_WORDS =
  /(intelligence artificielle|artificial intelligence|בינה מלאכותית|assistant[e·.]*\s+virtuel|virtual assistant|\brobot\b)/iu;

export function mentionsAi(text: string): boolean {
  return DISCLOSES_AI_ACRONYM.test(text) || DISCLOSES_AI_WORDS.test(text);
}

/** Sentence inserted INTO an existing greeting (business already named there). */
export function disclosureSentence(language: string, agentName: string): string {
  const a = agentName.trim();
  switch (lang(language)) {
    case "he":
      return a ? `אני ${a}, בינה מלאכותית.` : "אתם מדברים עם בינה מלאכותית.";
    case "en":
      return a ? `I'm ${a}, an AI assistant.` : "You're speaking with an AI assistant.";
    default:
      return a ? `Je suis ${a}, une intelligence artificielle.` : "Vous parlez à une intelligence artificielle.";
  }
}

/** Whole one-sentence greeting when the tenant has none. */
export function defaultDisclosureGreeting(
  language: string,
  agentName: string,
  businessName: string,
): string {
  const a = agentName.trim();
  const b = businessName.trim();
  switch (lang(language)) {
    case "he": {
      const where = b ? `שלום, הגעתם ל${b}` : "שלום";
      return a ? `${where}, כאן ${a}, בינה מלאכותית.` : `${where}, אתם מדברים עם בינה מלאכותית.`;
    }
    case "en": {
      const where = b ? `Hello, you've reached ${b}` : "Hello";
      return a ? `${where}, I'm ${a}, an AI assistant.` : `${where}, you're speaking with an AI assistant.`;
    }
    default: {
      const where = b ? `Bonjour, vous êtes chez ${b}` : "Bonjour";
      return a
        ? `${where}, je suis ${a}, une intelligence artificielle.`
        : `${where}, vous parlez à une intelligence artificielle.`;
    }
  }
}

/** Split after sentence terminators (. ! ? and the Hebrew/Latin variants). */
function sentences(text: string): string[] {
  return text.match(/[^.!?…]+[.!?…]+["'»)\s]*|[^.!?…]+$/gu)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

/**
 * Put the disclosure sentence into the tenant's greeting:
 *   - 2+ sentences → right after the first one ("Bonjour, salon X ! <disclosure> …")
 *   - 1 sentence that is a question → before it (the question must stay last:
 *     it hands the turn to the caller)
 *   - 1 sentence otherwise → after it
 */
export function insertDisclosure(greeting: string, disclosure: string): string {
  const parts = sentences(greeting.trim());
  if (parts.length >= 2) return [parts[0], disclosure, ...parts.slice(1)].join(" ");
  const only = parts[0] ?? "";
  if (only.replace(/["'»)\s]+$/u, "").endsWith("?")) return `${disclosure} ${only}`;
  return `${only} ${disclosure}`;
}

export interface DisclosureConfig {
  greetingInstructions: string | null;
  agentName: string | null;
  primaryLanguage: string | null;
  aiDisclosureEnabled: boolean | null;
  aiDisclosureText: string | null;
}

/**
 * The greeting the caller hears. Disclosure OFF → tenant greeting unchanged
 * (may be ''). ON → tenant greeting + disclosure (unless it already says
 * it's an AI), or a one-sentence default greeting when the tenant has none.
 */
export function effectiveGreeting(cfg: DisclosureConfig, businessName: string): string {
  const greeting = (cfg.greetingInstructions ?? "").trim();
  if (cfg.aiDisclosureEnabled === false) return greeting;

  const custom = (cfg.aiDisclosureText ?? "").trim().slice(0, AI_DISCLOSURE_MAX_LENGTH);
  const agentName = cfg.agentName ?? "";
  const language = cfg.primaryLanguage ?? "fr";

  if (!greeting) return custom || defaultDisclosureGreeting(language, agentName, businessName);
  if (mentionsAi(greeting)) return greeting;
  return insertDisclosure(greeting, custom || disclosureSentence(language, agentName));
}

/** Validate the tenant's custom line from the dashboard. */
export function parseDisclosureText(
  raw: unknown,
):
  | { ok: true; value: string }
  | { ok: false; error: "invalid_ai_disclosure_text" | "ai_disclosure_must_mention_ai" } {
  if (raw === null || raw === undefined) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, error: "invalid_ai_disclosure_text" };
  const v = raw.replace(/\s+/g, " ").trim();
  if (v.length > AI_DISCLOSURE_MAX_LENGTH) return { ok: false, error: "invalid_ai_disclosure_text" };
  // A custom line replaces the default one: it must still say it's an AI.
  if (v && !mentionsAi(v)) return { ok: false, error: "ai_disclosure_must_mention_ai" };
  return { ok: true, value: v };
}
