/**
 * Sous-agents LLM spécialisés pour l'extraction des infos business depuis le
 * texte d'un site web scanné. Chaque agent est un appel OpenAI Chat Completions
 * focalisé (JSON mode), réutilisant EXACTEMENT le pattern de `lib/summarize.ts`
 * (fetch + Bearer + response_format json_object).
 *
 * Règle commune à tous les prompts : NE JAMAIS INVENTER. Champ absent → vide /
 * confidence basse. La structure produite est ensuite assemblée + sanitizée
 * dans `merge.ts` (cf. `sanitizeBusinessConfig`).
 */

import type { WeekDay } from "@/lib/business";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.WEBSITE_SCAN_MODEL ?? "gpt-5.4-mini";

export type AgentKey =
  | "identity"
  | "hours"
  | "location"
  | "services"
  | "languages"
  | "knowledge";

export interface IdentityResult {
  name: string;
  tagline: string;
  email: string;
  confidence: number;
}

export interface DayHoursResult {
  open: boolean;
  openTime: string; // "HH:MM"
  closeTime: string; // "HH:MM"
}

export interface HoursResult {
  hours: Partial<Record<WeekDay, DayHoursResult>>;
  confidence: number;
}

export interface LocationCentre {
  name: string;
  address: string;
}

export interface LocationResult {
  centres: LocationCentre[];
  confidence: number;
}

export interface ServiceResult {
  name: string;
  durationMinutes: number;
  priceILS: number;
  description: string;
}

export interface ServicesResult {
  services: ServiceResult[];
  confidence: number;
}

export interface LanguagesResult {
  detectedLanguages: string[];
  suggestedPrimary: string;
  confidence: number;
}

export interface KnowledgeResult {
  /** Document markdown : corps de métier, expertise, descriptions détaillées,
   *  détails techniques, arguments de vente. Vide si rien d'exploitable. */
  knowledgeBase: string;
  confidence: number;
}

const clampConfidence = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

/**
 * Cœur partagé : envoie le contexte du site avec un prompt système focalisé,
 * force la sortie JSON, parse et renvoie l'objet brut. Lève en cas d'erreur
 * réseau / clé manquante (l'orchestrateur transforme ça en status "error" par
 * agent, sans bloquer les autres).
 */
async function runExtractor<T>(
  systemPrompt: string,
  siteContext: string,
): Promise<T> {
  const apiKey =
    process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new Error("OPENAI_API_KEY manquante pour le scan.");

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
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Contenu textuel du site web (plusieurs pages) :\n\n${siteContext}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI scan: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content) as T;
}

// ─── identityAgent ──────────────────────────────────────────────────────────

const IDENTITY_PROMPT = `Tu es un extracteur d'identité d'entreprise. À partir du texte d'un site web, identifie le NOM commercial de l'établissement, son SLOGAN/accroche éventuel, et l'EMAIL de contact principal.

Réponds STRICTEMENT en JSON :
{
  "name": "nom commercial exact, ou \\"\\" si introuvable",
  "tagline": "slogan/accroche courte, ou \\"\\"",
  "email": "email de contact (un seul, le principal), ou \\"\\"",
  "confidence": 0.0
}

Règles :
- N'INVENTE RIEN. Si une info est absente, mets une chaîne vide.
- "confidence" entre 0 et 1 : ta certitude globale sur le nom de l'établissement.
- L'email doit être un vrai email présent dans le texte (format valide), sinon "".
- Réponds UNIQUEMENT avec le JSON.`;

export async function identityAgent(ctx: string): Promise<IdentityResult> {
  const r = await runExtractor<Partial<IdentityResult>>(IDENTITY_PROMPT, ctx);
  return {
    name: String(r.name ?? "").trim(),
    tagline: String(r.tagline ?? "").trim(),
    email: String(r.email ?? "").trim(),
    confidence: clampConfidence(r.confidence),
  };
}

// ─── hoursAgent ─────────────────────────────────────────────────────────────

const HOURS_PROMPT = `Tu es un extracteur d'horaires d'ouverture. À partir du texte d'un site web, déduis les horaires d'ouverture hebdomadaires de l'établissement.

Réponds STRICTEMENT en JSON, une clé par jour (mon,tue,wed,thu,fri,sat,sun) :
{
  "hours": {
    "mon": { "open": true, "openTime": "09:00", "closeTime": "18:00" },
    "tue": { "open": false, "openTime": "", "closeTime": "" }
    // ... etc pour chaque jour mentionné
  },
  "confidence": 0.0
}

Règles STRICTES :
- Format horaire OBLIGATOIRE "HH:MM" sur 24h (ex "09:00", "18:30"). Jamais "9h" ou "6pm".
- "open": false si le jour est fermé OU si l'horaire est ambigu/inconnu (n'invente pas).
- closeTime doit être STRICTEMENT après openTime quand open=true.
- Si un établissement ferme le midi (ex 9-12 puis 14-19), prends l'amplitude large (09:00–19:00) — le grid ne gère qu'un créneau par jour.
- N'inclus QUE les jours pour lesquels tu as une info. N'invente aucun horaire.
- "confidence" entre 0 et 1.
- Réponds UNIQUEMENT avec le JSON.`;

export async function hoursAgent(ctx: string): Promise<HoursResult> {
  const r = await runExtractor<{
    hours?: Record<string, unknown>;
    confidence?: unknown;
  }>(HOURS_PROMPT, ctx);
  const validDays: WeekDay[] = [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ];
  const hours: Partial<Record<WeekDay, DayHoursResult>> = {};
  const src = r.hours ?? {};
  for (const d of validDays) {
    const v = src[d] as Partial<DayHoursResult> | undefined;
    if (!v || typeof v !== "object") continue;
    hours[d] = {
      open: Boolean(v.open),
      openTime: String(v.openTime ?? "").trim(),
      closeTime: String(v.closeTime ?? "").trim(),
    };
  }
  return { hours, confidence: clampConfidence(r.confidence) };
}

// ─── locationAgent ──────────────────────────────────────────────────────────

const LOCATION_PROMPT = `Tu es un extracteur d'adresses. À partir du texte d'un site web, identifie le ou les ÉTABLISSEMENTS physiques (centres / salons / cliniques) avec leur nom et adresse postale.

Réponds STRICTEMENT en JSON :
{
  "centres": [
    { "name": "nom du centre (ou nom de la ville si centre unique sans nom propre)", "address": "adresse postale complète" }
  ],
  "confidence": 0.0
}

Règles :
- La plupart des établissements n'ont qu'UN seul centre → tableau à 1 élément.
- N'INVENTE pas d'adresse. Si aucune adresse n'est trouvée, renvoie "centres": [].
- "name" non vide obligatoire pour chaque centre (sinon ne l'inclus pas).
- "confidence" entre 0 et 1.
- Réponds UNIQUEMENT avec le JSON.`;

export async function locationAgent(ctx: string): Promise<LocationResult> {
  const r = await runExtractor<{
    centres?: Array<Partial<LocationCentre>>;
    confidence?: unknown;
  }>(LOCATION_PROMPT, ctx);
  const centres: LocationCentre[] = (Array.isArray(r.centres) ? r.centres : [])
    .map((c) => ({
      name: String(c?.name ?? "").trim(),
      address: String(c?.address ?? "").trim(),
    }))
    .filter((c) => c.name.length > 0);
  return { centres, confidence: clampConfidence(r.confidence) };
}

// ─── servicesAgent ──────────────────────────────────────────────────────────

const SERVICES_PROMPT = `Tu es un extracteur de l'OFFRE commerciale d'une entreprise. À partir du texte d'un site web, liste ce que l'entreprise propose à ses clients — selon le type d'activité :
- prestations / soins / services (salon, clinique, spa, coiffure…) ;
- OU produits / articles à vendre (boutique, e-commerce : ex. machines, appareils, accessoires…) ;
- OU forfaits / abonnements.
Capture le PRIX et une courte description dès qu'ils sont disponibles.

Réponds STRICTEMENT en JSON :
{
  "services": [
    { "name": "nom du soin/produit/forfait", "durationMinutes": 30, "priceILS": 0, "description": "courte description (caractéristiques clés, ou \\"\\")" }
  ],
  "confidence": 0.0
}

Règles :
- "durationMinutes" : entier en minutes pour une prestation (ex 60). Pour un PRODUIT à vendre (non basé sur le temps), mets 0.
- "priceILS" : prix en SHEKELS (₪), entier. Autre devise → convertis approximativement ; inconnu → 0.
- Inclus les PRODUITS À VENDRE (ex. "3 machines à café" avec leurs prix et caractéristiques) au même titre que les prestations.
- "description" : pour un produit, résume les caractéristiques importantes (modèle, capacité, options…).
- N'INVENTE rien. Si aucune offre trouvée, renvoie "services": [].
- Maximum 40 entrées, les plus importantes d'abord.
- "confidence" entre 0 et 1.
- Réponds UNIQUEMENT avec le JSON.`;

export async function servicesAgent(ctx: string): Promise<ServicesResult> {
  const r = await runExtractor<{
    services?: Array<Partial<ServiceResult>>;
    confidence?: unknown;
  }>(SERVICES_PROMPT, ctx);
  const services: ServiceResult[] = (Array.isArray(r.services) ? r.services : [])
    .map((s) => ({
      name: String(s?.name ?? "").trim(),
      durationMinutes: Number(s?.durationMinutes) || 30,
      priceILS: Number(s?.priceILS) || 0,
      description: String(s?.description ?? "").trim(),
    }))
    .filter((s) => s.name.length > 0)
    .slice(0, 40);
  return { services, confidence: clampConfidence(r.confidence) };
}

// ─── languagesAgent ─────────────────────────────────────────────────────────

const LANGUAGES_PROMPT = `Tu es un détecteur de langue. À partir du texte d'un site web, détermine la/les langue(s) du site parmi : "fr" (français), "he" (hébreu), "en" (anglais).

Réponds STRICTEMENT en JSON :
{
  "detectedLanguages": ["fr"],
  "suggestedPrimary": "fr",
  "confidence": 0.0
}

Règles :
- "detectedLanguages" : sous-ensemble de ["fr","he","en"] réellement présent.
- "suggestedPrimary" : la langue dominante (une seule), parmi fr/he/en. Défaut "fr".
- "confidence" entre 0 et 1.
- Réponds UNIQUEMENT avec le JSON.`;

export async function languagesAgent(ctx: string): Promise<LanguagesResult> {
  const r = await runExtractor<{
    detectedLanguages?: unknown;
    suggestedPrimary?: unknown;
    confidence?: unknown;
  }>(LANGUAGES_PROMPT, ctx);
  const allowed = new Set(["fr", "he", "en"]);
  const detected = (Array.isArray(r.detectedLanguages) ? r.detectedLanguages : [])
    .map((l) => String(l).toLowerCase().trim())
    .filter((l) => allowed.has(l));
  let primary = String(r.suggestedPrimary ?? "").toLowerCase().trim();
  if (!allowed.has(primary)) primary = detected[0] ?? "fr";
  return {
    detectedLanguages: Array.from(new Set(detected)),
    suggestedPrimary: primary,
    confidence: clampConfidence(r.confidence),
  };
}

// ─── knowledgeAgent ─────────────────────────────────────────────────────────

const KNOWLEDGE_PROMPT = `Tu es un expert qui construit la BASE DE CONNAISSANCES d'un agent vocal commercial, à partir du texte du site web d'une entreprise. Objectif : donner à l'agent de quoi PRÉSENTER l'activité, CONSEILLER, ARGUMENTER et RÉPONDRE aux questions techniques des clients.

Produis un document Markdown clair et factuel, structuré avec ces sections (omets une section si l'info est absente) :
- **Corps de métier** : le secteur/la spécialité exacte de l'entreprise (ex. "torréfacteur & vente de machines à café professionnelles", "salon de coiffure & barbier").
- **Expertise & valeur** : ce qui distingue l'entreprise, son savoir-faire, ses engagements.
- **Services / produits en détail** : pour chaque prestation OU produit important, une description riche + ses **détails techniques** (caractéristiques, modèles, capacités, matériaux, options, garanties, compatibilités…).
- **Arguments de vente** : bénéfices clients, points forts, raisons d'acheter/réserver, réponses aux objections courantes.
- **Infos utiles** : livraison, paiement, SAV, conditions, public visé, FAQ — tout ce qui aide à vendre/rassurer.

Réponds STRICTEMENT en JSON :
{
  "knowledgeBase": "document Markdown (## titres, listes), ou \\"\\" si rien d'exploitable",
  "confidence": 0.0
}

Règles :
- N'INVENTE RIEN : utilise uniquement ce qui est présent sur le site. Pas d'info → omets-la.
- Sois DÉTAILLÉ sur les caractéristiques techniques des produits/services quand elles existent.
- Écris dans la langue principale du site.
- Maximum ~5000 caractères, les infos les plus utiles à la vente d'abord.
- "confidence" entre 0 et 1.
- Réponds UNIQUEMENT avec le JSON.`;

export async function knowledgeAgent(ctx: string): Promise<KnowledgeResult> {
  const r = await runExtractor<{
    knowledgeBase?: unknown;
    confidence?: unknown;
  }>(KNOWLEDGE_PROMPT, ctx);
  return {
    knowledgeBase: String(r.knowledgeBase ?? "").trim().slice(0, 6000),
    confidence: clampConfidence(r.confidence),
  };
}
