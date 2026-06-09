// Analyse post-appel d'une discussion de campagne sortante : évalue si les
// critères de succès sont remplis, le sentiment, et un résumé d'une ligne.
// Le résultat est mis en cache dans campaign_calls (disposition/sentiment/
// summary) pour que l'écran analytics se charge instantanément ensuite.
// SERVER-ONLY.

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL =
  process.env.CAMPAIGN_ANALYZE_MODEL ??
  process.env.SUMMARY_MODEL ??
  "gpt-5.4-mini";

const LANG_LABEL: Record<string, string> = {
  fr: "français",
  he: "hébreu",
  en: "anglais",
};

export type CallAnalysis = {
  /** Verdict critères de succès : atteint / partiel / non atteint. */
  success: "success" | "partial" | "fail";
  sentiment: "positive" | "neutral" | "negative";
  /** Résumé d'une ligne (langue de la campagne). */
  summary: string;
};

export async function analyzeCampaignCall(opts: {
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
  objective: string;
  successCriteria: string;
  language?: string | null;
}): Promise<CallAnalysis | null> {
  const dialog = opts.transcript
    .map((t) => `${t.role === "user" ? "Prospect" : "Agent"}: ${t.text}`)
    .join("\n")
    .slice(0, 12000);
  if (!dialog.trim()) return null;

  const apiKey =
    process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return null;

  const lang = LANG_LABEL[opts.language ?? "fr"] ?? "français";
  const system = `Tu es analyste qualité d'appels sortants. À partir de la transcription d'un appel, évalue STRICTEMENT en JSON :
{
  "success": "success" | "partial" | "fail",
  "sentiment": "positive" | "neutral" | "negative",
  "summary": "résumé d'une ligne en ${lang}"
}

Objectif de la campagne : ${opts.objective || "(non précisé)"}
Critères de succès : ${opts.successCriteria || "(non précisés — juge l'atteinte de l'objectif)"}

Règles :
- "success" = critères pleinement remplis ; "partial" = progrès/intérêt mais pas conclu ; "fail" = critères non remplis.
- "sentiment" = ressenti global du prospect.
- "summary" : factuel, 1 ligne, en ${lang}.
- Réponds UNIQUEMENT avec le JSON.`;

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
        temperature: 0.1,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Transcription :\n\n${dialog}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = JSON.parse(
      data.choices?.[0]?.message?.content ?? "{}",
    ) as Partial<CallAnalysis>;
    const success =
      parsed.success === "success" || parsed.success === "partial"
        ? parsed.success
        : "fail";
    const sentiment =
      parsed.sentiment === "positive" || parsed.sentiment === "negative"
        ? parsed.sentiment
        : "neutral";
    return {
      success,
      sentiment,
      summary: String(parsed.summary ?? "").trim().slice(0, 300),
    };
  } catch {
    return null;
  }
}
