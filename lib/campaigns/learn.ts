// "Apprendre le business" depuis un ou plusieurs sites web pour une campagne
// sortante : crawl (réutilise lib/website-scan) → distillation LLM en une fiche
// de connaissance compacte injectable dans le system prompt de l'agent.
// SERVER-ONLY.

import { crawlSite, pagesToContext } from "@/lib/website-scan/crawl";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL =
  process.env.CAMPAIGN_LEARN_MODEL ??
  process.env.WEBSITE_SCAN_MODEL ??
  "gpt-5.4-mini";

// Borne le contexte total envoyé au distillateur (coût/latence).
const MAX_CONTEXT_CHARS = 140_000;
// Borne la fiche produite. Volontairement généreux : on veut conserver TOUS
// les prix et les détails de l'offre, pas un résumé vague.
const MAX_KNOWLEDGE_CHARS = 8000;
export const MAX_LEARN_URLS = 5;

const LANG_LABEL: Record<string, string> = {
  fr: "français",
  he: "hébreu",
  en: "anglais",
};

export type LearnResult = {
  knowledge: string;
  sources: string[]; // URLs effectivement scannées (au moins 1 page)
  failed: string[]; // URLs injoignables
};

// Crawle chaque site puis distille une fiche unique. Best-effort : un site
// injoignable est listé dans `failed`, on continue avec les autres.
export async function learnFromSites(
  rawUrls: string[],
  language?: string | null,
): Promise<LearnResult> {
  const urls = Array.from(
    new Set(rawUrls.map((u) => u.trim()).filter(Boolean)),
  ).slice(0, MAX_LEARN_URLS);

  const blocks: string[] = [];
  const sources: string[] = [];
  const failed: string[] = [];

  await Promise.all(
    urls.map(async (url) => {
      try {
        const pages = await crawlSite(url);
        if (!pages.length) {
          failed.push(url);
          return;
        }
        sources.push(url);
        blocks.push(`===== SITE : ${url} =====\n${pagesToContext(pages)}`);
      } catch {
        failed.push(url);
      }
    }),
  );

  if (!blocks.length) {
    return { knowledge: "", sources: [], failed: urls };
  }

  const context = blocks.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
  const lang = LANG_LABEL[language ?? "fr"] ?? "français";

  const apiKey =
    process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  // Sans clé : fallback brut (tronqué) plutôt que rien.
  if (!apiKey) {
    return {
      knowledge: context.slice(0, MAX_KNOWLEDGE_CHARS),
      sources,
      failed,
    };
  }

  const system = `Tu es analyste commercial. À partir du contenu de site(s) web ci-dessous, rédige une FICHE DE CONNAISSANCE EXHAUSTIVE destinée à un agent vocal qui va VENDRE ce business au téléphone.

Sois COMPLET, pas synthétique — l'agent doit pouvoir répondre précisément sur n'importe quel produit/prix. En ${lang}, en puces :
- Activité : ce que fait/vend l'entreprise.
- OFFRE DÉTAILLÉE : liste EXHAUSTIVE de TOUS les produits/services/formules trouvés, AVEC LEUR PRIX EXACT, durée, options et caractéristiques. Recopie chaque tarif tel quel (ex. "Coupe femme — 45€", "Forfait Pro — 99€/mois"). N'OMETS AUCUN PRIX présent dans le contenu.
- Arguments de vente : différenciateurs, bénéfices clients, preuves (avis, garanties, certifications, références).
- Objections fréquentes + réponses si le site en suggère.
- Cible / clientèle.
- Infos pratiques : zones desservies, horaires, contact, modalités (paiement, livraison, RDV).
- Ton de marque (citations marketing clés du site).

Règles STRICTES : N'INVENTE RIEN — recopie uniquement ce qui est dans le contenu, surtout les prix. Préfère trop d'infos à pas assez (jusqu'à ${MAX_KNOWLEDGE_CHARS} caractères).`;

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: context },
        ],
      }),
    });
    if (!res.ok) {
      return { knowledge: context.slice(0, MAX_KNOWLEDGE_CHARS), sources, failed };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const knowledge = (data.choices?.[0]?.message?.content ?? "")
      .trim()
      .slice(0, MAX_KNOWLEDGE_CHARS);
    return { knowledge, sources, failed };
  } catch {
    return { knowledge: context.slice(0, MAX_KNOWLEDGE_CHARS), sources, failed };
  }
}
