// Analyse post-appel d'une campagne sortante : un seul appel OpenAI (Chat
// Completions JSON mode) qui produit résumé + disposition auto + sentiment +
// extraction structurée selon le schéma défini par l'utilisateur.
// SERVER-ONLY. Même pattern fetch+Bearer+json_object que lib/website-scan/agents.

import {
  DISPOSITIONS,
  SENTIMENTS,
  type Disposition,
  type ExtractionField,
  type Sentiment,
} from "./constants";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.CAMPAIGN_ANALYZE_MODEL ?? process.env.SUMMARY_MODEL ?? "gpt-5.4-mini";

export type CampaignAnalysis = {
  summary: string;
  disposition: Disposition | "";
  sentiment: Sentiment | "";
  extracted: Record<string, unknown>;
};

const LANG_LABEL: Record<string, string> = {
  fr: "français",
  he: "hébreu",
  en: "anglais",
};

function buildSchemaSpec(schema: ExtractionField[]): string {
  if (!schema.length) return "(aucun champ à extraire)";
  return schema
    .map((f) => {
      let typ: string = f.type;
      if (f.type === "enum") typ = `enum parmi [${(f.options ?? []).join(", ")}]`;
      return `- "${f.key}" (${typ})${f.required ? " [requis]" : ""}: ${f.label}`;
    })
    .join("\n");
}

export async function analyzeCampaignCall(opts: {
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
  objective: string;
  successCriteria?: string;
  extractionSchema: ExtractionField[];
  language?: string | null;
}): Promise<CampaignAnalysis> {
  const empty: CampaignAnalysis = {
    summary: "",
    disposition: "",
    sentiment: "",
    extracted: {},
  };
  if (!opts.transcript.length) return empty;

  const apiKey = process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return empty;

  const lang = LANG_LABEL[opts.language ?? "fr"] ?? "français";
  const dialog = opts.transcript
    .map((t) => `${t.role === "user" ? "Prospect" : "Agent"}: ${t.text}`)
    .join("\n");

  const system = `Tu analyses la transcription d'un appel SORTANT passé par un agent IA à un prospect, dans le cadre d'une campagne (objectif ci-dessous). Tu produis un objet JSON strict.

Objectif de la campagne : ${opts.objective || "(non précisé)"}
${opts.successCriteria ? `Critère de succès : ${opts.successCriteria}` : ""}

Champs à extraire :
${buildSchemaSpec(opts.extractionSchema)}

Réponds UNIQUEMENT avec un JSON de la forme :
{
  "summary": "résumé factuel de l'appel en 2-4 lignes, en ${lang}",
  "disposition": "une valeur parmi: ${DISPOSITIONS.join(", ")}",
  "sentiment": "une valeur parmi: ${SENTIMENTS.join(", ")}",
  "extracted": { ...un champ par clé du schéma ci-dessus, avec le bon type; omets ou null si l'info n'a pas été donnée... }
}

Règles : n'invente rien (champ absent → null). disposition reflète le résultat réel (ex: interested, not_interested, callback, qualified, meeting_booked, do_not_call, wrong_number, no_decision). Réponds en ${lang} pour le summary.`;

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: dialog },
        ],
      }),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Partial<CampaignAnalysis>;

    const disposition = DISPOSITIONS.includes(parsed.disposition as Disposition)
      ? (parsed.disposition as Disposition)
      : "";
    const sentiment = SENTIMENTS.includes(parsed.sentiment as Sentiment)
      ? (parsed.sentiment as Sentiment)
      : "";
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "",
      disposition,
      sentiment,
      extracted:
        parsed.extracted && typeof parsed.extracted === "object"
          ? (parsed.extracted as Record<string, unknown>)
          : {},
    };
  } catch {
    return empty;
  }
}
