// Generate a French summary of a call transcript using OpenAI Chat Completions.
// Returns two variants: one for the client (warm, branded) and one for the
// owner (factual, action-oriented).

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.SUMMARY_MODEL ?? "gpt-5.4-mini";

export interface CallSummary {
  raw: string;
  forClient: string;
  forOwner: string;
}

// Default — exporté pour que /admin puisse l'afficher en placeholder et que
// le helper /api/calls/end l'utilise en fallback si pas d'override per-plan.
// {target_language} est substitué par lib helper avant envoi à OpenAI selon
// la primaryLanguage du tenant — par défaut français.
export const DEFAULT_SUMMARY_PROMPT = `Tu reçois la transcription d'un appel téléphonique entre une cliente et la secrétaire vocale d'un salon (médical, beauté ou coiffure).

Génère un objet JSON strictement de la forme :
{
  "summary": "résumé factuel en 3-6 lignes (qui a appelé, motif, ce qui a été fait, prochaines étapes)",
  "for_client": "message WhatsApp à envoyer à la cliente. Chaleureux, en {target_language}, signé 'Le salon Prestige'. Inclure le récap du RDV pris ou des actions effectuées. 4-7 lignes max. Pas de markdown.",
  "for_owner": "message WhatsApp à envoyer au propriétaire. Factuel, en {target_language}. Liste : prénom cliente / motif / action / RDV (date+heure+prestation) / téléphone si donné. 4-8 lignes. Pas de markdown."
}

Règles :
- Si l'appel n'a abouti à rien (raccroché, mauvais numéro, etc.), le summary doit le mentionner et for_client peut être un simple remerciement.
- for_client ET for_owner doivent être ENTIÈREMENT en {target_language}, c'est la langue choisie par le tenant — n'écris pas dans une autre langue même si l'appel a eu lieu dans une autre.
- Sois sobre. Pas d'emojis sauf un seul à la fin de for_client.
- Réponds UNIQUEMENT avec le JSON, rien d'autre.`;

const LANG_LABEL: Record<string, string> = {
  fr: "français",
  he: "hébreu",
  en: "anglais (US)",
};

export async function summarizeCall(
  transcript: Array<{ role: "user" | "assistant"; text: string }>,
  /** Optional override of the system prompt (per-plan customization).
   *  Falsy / empty → fallback sur DEFAULT_SUMMARY_PROMPT. */
  customSystemPrompt?: string | null,
  /** Langue cible pour for_client / for_owner. 'fr' | 'he' | 'en'.
   *  Substitué via {target_language} placeholder dans le prompt. */
  targetLanguage?: string | null,
): Promise<CallSummary> {
  const apiKey =
    process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY manquante pour le résumé");
  }

  const dialog = transcript
    .map((t) =>
      `${t.role === "user" ? "Cliente" : "Secrétaire"}: ${t.text}`,
    )
    .join("\n");

  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: (
            (customSystemPrompt && customSystemPrompt.trim()) ||
            DEFAULT_SUMMARY_PROMPT
          ).replaceAll(
            "{target_language}",
            LANG_LABEL[targetLanguage ?? "fr"] ?? "français",
          ),
        },
        {
          role: "user",
          content: `Transcription de l'appel :\n\n${dialog || "(transcription vide — appel court ou raté)"}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI summary: ${res.status} ${err.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message?.content ?? "{}";

  const parsed = JSON.parse(content) as {
    summary?: string;
    for_client?: string;
    for_owner?: string;
  };

  return {
    raw: parsed.summary ?? "",
    forClient: parsed.for_client ?? "",
    forOwner: parsed.for_owner ?? "",
  };
}
