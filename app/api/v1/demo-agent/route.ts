import { NextRequest, NextResponse } from "next/server";

/**
 * Agent de démo au format webhook Tamara — cible de test publique.
 *
 * Sert à valider la couche voix de tamaravox de bout en bout : on colle cette
 * URL dans /connect, tamaravox POSTe un tour d'appel signé, cet endpoint
 * répond du texte. C'est un vrai agent joignable, pas une simulation.
 *
 * Contrat (identique à celui que tamaravox documente) :
 *   POST { call_id, turn_id, language: "en"|"fr"|"he", transcript, history[] }
 *   → 200 { reply: string }   dans un budget de 2 s
 *
 * La signature `X-Tamara-Signature` n'est PAS vérifiée ici : le secret est
 * éphémère côté tamaravox tant qu'aucun compte n'est créé. Un vrai agent
 * client doit la vérifier (cf. docs/webhook-contract.md du repo tamaravox).
 *
 * Public et sans auth, par nature — c'est une cible de test. Le budget interne
 * est volontairement plus court que les 2 s autorisées pour garder une marge
 * réseau.
 */

// On répond bien avant la limite : le temps réseau compte dans le budget du
// caller, pas seulement notre temps de calcul.
const INTERNAL_BUDGET_MS = 1750;
const MAX_TRANSCRIPT = 500;

type Lang = "en" | "fr" | "he";

type Body = {
  call_id?: unknown;
  turn_id?: unknown;
  language?: unknown;
  transcript?: unknown;
  history?: unknown;
};

function pickLanguage(value: unknown): Lang {
  return value === "fr" || value === "he" ? value : "en";
}

/**
 * Réponses déterministes — le filet de sécurité. Elles partent en quelques
 * millisecondes, ce qui donne aussi une mesure propre de la latence réseau
 * seule quand on veut isoler le transport.
 */
function scriptedReply(transcript: string, language: Lang): string {
  const text = transcript.toLowerCase();

  const table: Record<Lang, Record<string, string>> = {
    en: {
      greeting: "Good morning — Tamara demo agent. How can I help?",
      booking: "I can move that appointment. Thursday at 9:30 or 11:00?",
      price: "The plan starts at 99 dollars a month, billed monthly.",
      hours: "We answer around the clock, every day of the week.",
      fallback: "Understood. Could you tell me a little more?",
    },
    fr: {
      greeting: "Bonjour — agent de démonstration Tamara. Comment puis-je aider ?",
      booking: "Je peux déplacer ce rendez-vous. Jeudi à 9h30 ou à 11h ?",
      price: "L'offre démarre à 99 dollars par mois, sans engagement.",
      hours: "Nous répondons 24 heures sur 24, tous les jours.",
      fallback: "Entendu. Pouvez-vous m'en dire un peu plus ?",
    },
    he: {
      greeting: "שלום — סוכן הדגמה של תמרה. איך אפשר לעזור?",
      booking: "אני יכולה להזיז את הפגישה. יום חמישי ב-9:30 או ב-11:00?",
      price: "המסלול מתחיל ב-99 דולר לחודש, ללא התחייבות.",
      hours: "אנחנו עונים מסביב לשעון, כל ימות השבוע.",
      fallback: "הבנתי. אפשר לפרט קצת יותר?",
    },
  };

  const set = table[language];
  if (/bonjour|hello|hi |shalom|שלום|salut/.test(text)) return set.greeting;
  if (/rendez|appointment|book|reschedule|déplacer|פגישה/.test(text))
    return set.booking;
  if (/prix|price|cost|combien|מחיר/.test(text)) return set.price;
  if (/heure|hours|open|horaire|שעות/.test(text)) return set.hours;
  return set.fallback;
}

/** Agent réel quand une clé est disponible. Coupé net au budget interne. */
async function llmReply(
  transcript: string,
  language: Lang,
  history: Array<{ role: string; text: string }>,
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const langLabel = { en: "English", fr: "French", he: "Hebrew" }[language];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERNAL_BUDGET_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 70,
        messages: [
          {
            role: "system",
            content:
              `You are a demo phone agent for a salon. Reply in ${langLabel}. ` +
              "One or two short sentences, spoken aloud on a phone call. " +
              "No markdown, no emoji, no lists.",
          },
          ...history.slice(-6).map((turn) => ({
            role: turn.role === "agent" ? "assistant" : "user",
            content: String(turn.text ?? "").slice(0, 300),
          })),
          { role: "user", content: transcript },
        ],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    return typeof reply === "string" && reply.trim() ? reply.trim() : null;
  } catch {
    // Timeout ou panne côté fournisseur : on retombe sur le script plutôt que
    // de laisser le tour expirer. Sur un appel, une réponse courte à l'heure
    // vaut mieux qu'une réponse parfaite en retard.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body." },
      { status: 400 },
    );
  }

  const transcript =
    typeof body.transcript === "string"
      ? body.transcript.slice(0, MAX_TRANSCRIPT).trim()
      : "";
  const language = pickLanguage(body.language);
  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role: string; text: string }>)
    : [];

  // Transcript vide = tour d'ouverture : le worker demande la première
  // phrase avant que l'appelant ait parlé. Renvoyer le repli générique
  // ("pouvez-vous m'en dire plus ?") ferait démarrer l'appel sur une
  // question absurde.
  if (!transcript) {
    return NextResponse.json({
      reply: scriptedReply("bonjour", language),
      source: "scripted",
      language,
    });
  }

  const generated = await llmReply(transcript, language, history);

  return NextResponse.json({
    reply: generated ?? scriptedReply(transcript, language),
    source: generated ? "model" : "scripted",
    language,
  });
}

/** Permet de vérifier d'un coup d'œil que l'URL est vivante. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "tamara-demo-agent",
    contract: "POST { call_id, turn_id, language, transcript, history[] } -> { reply }",
    languages: ["en", "fr", "he"],
  });
}
