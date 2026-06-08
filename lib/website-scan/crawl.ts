/**
 * Crawler du site web d'un tenant pour l'auto-remplissage de la config business.
 *
 * Récupère la home + quelques pages clés (contact / horaires / services …),
 * nettoie le HTML en texte via cheerio, et renvoie un `ScannedPage[]` borné en
 * taille (cap pages + chars) pour limiter le coût des sous-agents LLM en aval.
 *
 * Sécurité : garde anti-SSRF (DNS resolve + rejet des IP privées/loopback),
 * validation à chaque saut de redirection. Endpoint réservé aux sessions
 * authentifiées mais on ne fait jamais confiance à une URL fournie par l'user.
 */

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export interface ScannedPage {
  url: string;
  title: string;
  text: string;
}

const MAX_PAGES = 12; // home + 11 pages découvertes (couverture élargie)
const PER_PAGE_TIMEOUT_MS = 8000;
const MAX_BYTES = 250_000; // ~250 KB de HTML par page max
const PER_PAGE_TEXT_CHARS = 10_000; // texte par page (borne coût LLM)
const MAX_JSONLD_CHARS = 4000; // données structurées schema.org gardées par page
const MAX_REDIRECTS = 4;
const USER_AGENT =
  "Mozilla/5.0 (compatible; TamaraBot/1.0; +https://aitamara.com/bot)";

// Mots-clés multilingues (fr/en/he-translittéré + hébreu) pour repérer les
// pages utiles. Chaque entrée porte un poids : les pages les plus riches en
// infos requises (services, tarifs, horaires, contact) sont crawlées en
// priorité dans le budget de pages.
const LINK_KEYWORDS: { kw: string; weight: number }[] = [
  // Services / prestations / tarifs — la source #1 des infos manquantes.
  { kw: "service", weight: 5 },
  { kw: "prestation", weight: 5 },
  { kw: "tarif", weight: 5 },
  { kw: "price", weight: 5 },
  { kw: "prix", weight: 5 },
  { kw: "pricing", weight: 5 },
  { kw: "soin", weight: 5 },
  { kw: "menu", weight: 5 },
  { kw: "מחיר", weight: 5 }, // prix (he)
  { kw: "שירות", weight: 5 }, // service (he)
  // Horaires.
  { kw: "horaire", weight: 4 },
  { kw: "hours", weight: 4 },
  { kw: "opening", weight: 4 },
  { kw: "ouverture", weight: 4 },
  { kw: "שעות", weight: 4 }, // heures (he)
  // Contact / coordonnées / adresse.
  { kw: "contact", weight: 4 },
  { kw: "adresse", weight: 4 },
  { kw: "address", weight: 4 },
  { kw: "location", weight: 3 },
  { kw: "acces", weight: 3 },
  { kw: "accès", weight: 3 },
  { kw: "כתובת", weight: 4 }, // adresse (he)
  { kw: "צור-קשר", weight: 4 }, // contact (he)
  // Identité / à-propos.
  { kw: "about", weight: 3 },
  { kw: "a-propos", weight: 3 },
  { kw: "apropos", weight: 3 },
  { kw: "à propos", weight: 3 },
  { kw: "qui-sommes", weight: 3 },
  { kw: "presentation", weight: 2 },
  { kw: "אודות", weight: 3 }, // à propos (he)
  // Prise de RDV / réservation.
  { kw: "rdv", weight: 3 },
  { kw: "rendez-vous", weight: 3 },
  { kw: "booking", weight: 3 },
  { kw: "reserver", weight: 3 },
  { kw: "réserver", weight: 3 },
  { kw: "appointment", weight: 3 },
  // Établissements / agences (multi-centres).
  { kw: "centre", weight: 3 },
  { kw: "agence", weight: 3 },
  { kw: "salon", weight: 2 },
  { kw: "cabinet", weight: 2 },
  { kw: "clinique", weight: 2 },
  { kw: "boutique", weight: 2 },
];

export class ScanError extends Error {}

// ─── Garde anti-SSRF ────────────────────────────────────────────────────────

const isPrivateIp = (ip: string): boolean => {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
};

/** Vérifie qu'un hostname ne résout pas vers une IP privée/loopback. */
async function assertPublicHost(hostname: string): Promise<void> {
  // URL.hostname garde les crochets sur une IPv6 littérale ("[::1]") — on les
  // retire pour que isIP/isPrivateIp voient l'adresse réelle.
  hostname = hostname.replace(/^\[|\]$/g, "");
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  ) {
    throw new ScanError("URL non autorisée (hôte local).");
  }
  // Si c'est déjà une IP littérale, on la teste directement.
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new ScanError("URL non autorisée (IP privée).");
    }
    return;
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ScanError("Domaine introuvable (DNS).");
  }
  if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
    throw new ScanError("URL non autorisée (résolution privée).");
  }
}

/** Normalise + valide l'URL racine fournie par l'utilisateur. */
export function normalizeRootUrl(raw: string): URL {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new ScanError("URL manquante.");
  let candidate = trimmed;
  const schemeMatch = candidate.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (schemeMatch) {
    // Schéma explicite présent : rejeter tout ce qui n'est pas http(s).
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      throw new ScanError("Seuls http(s) sont supportés.");
    }
  } else {
    // Pas de schéma → on force https sur le domaine nu.
    candidate = `https://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ScanError("URL invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScanError("Seuls http(s) sont supportés.");
  }
  return url;
}

/**
 * fetch sécurisé : suit les redirections manuellement en re-validant l'hôte
 * de chaque Location (anti-SSRF par rebind / redirect interne).
 */
async function safeFetch(startUrl: URL): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "fr,en;q=0.8,he;q=0.6",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    // Redirection ?
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current);
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new ScanError("Redirection vers un protocole non supporté.");
      }
      continue;
    }
    return res;
  }
  throw new ScanError("Trop de redirections.");
}

// ─── Extraction texte / liens (cheerio chargé dynamiquement) ────────────────

async function fetchHtml(url: URL): Promise<string | null> {
  let res: Response;
  try {
    res = await safeFetch(url);
  } catch (e) {
    if (e instanceof ScanError) throw e;
    return null; // timeout / réseau → page ignorée
  }
  if (!res.ok) return null;
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("html")) return null;
  // Lecture bornée en taille.
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_BYTES);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    concatChunks(chunks, Math.min(total, MAX_BYTES)),
  );
}

function concatChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    const remaining = size - offset;
    if (remaining <= 0) break;
    const slice = c.length <= remaining ? c : c.subarray(0, remaining);
    out.set(slice, offset);
    offset += slice.length;
  }
  return out;
}

interface ParsedPage {
  title: string;
  text: string;
  /** Données structurées schema.org (JSON-LD) — horaires/adresse/services. */
  structured: string;
  links: { href: string; label: string }[];
}

async function parseHtml(html: string): Promise<ParsedPage> {
  const { load } = await import("cheerio");
  const $ = load(html);
  const title = $("title").first().text().trim().slice(0, 200);

  // Liens : AVANT de supprimer les balises non textuelles.
  const links: { href: string; label: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const label = $(el).text().replace(/\s+/g, " ").trim();
    if (href) links.push({ href, label });
  });

  // JSON-LD schema.org (LocalBusiness, OpeningHoursSpecification, PostalAddress,
  // Service, Offer…) AVANT le drop des scripts — souvent la seule source fiable
  // des horaires/adresse/tarifs sur les sites pro. Compacté + capé.
  const jsonLdParts: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      jsonLdParts.push(JSON.stringify(JSON.parse(raw)));
    } catch {
      jsonLdParts.push(raw.replace(/\s+/g, " "));
    }
  });
  // Microdata schema.org (itemprop) en complément léger.
  const micro: string[] = [];
  $("[itemprop]").each((_, el) => {
    if (micro.length >= 40) return;
    const prop = $(el).attr("itemprop");
    const val =
      $(el).attr("content") || $(el).text().replace(/\s+/g, " ").trim();
    if (prop && val) micro.push(`${prop}: ${val.slice(0, 120)}`);
  });
  const structured = [
    jsonLdParts.join("\n"),
    micro.length ? `microdata: ${micro.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_JSONLD_CHARS);

  // Texte : on drop le bruit puis on extrait le body.
  $("script, style, noscript, svg, iframe, head, link, meta").remove();
  const text = $("body")
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return { title, text, structured, links };
}

/**
 * Sélectionne les URLs candidates (même origine), SCORÉES par pertinence :
 * une page qui matche plusieurs mots-clés à fort poids (services, tarifs,
 * horaires, contact) passe avant un lien générique. On garde le meilleur
 * score par URL, puis on trie décroissant — le budget de pages est ainsi
 * dépensé sur les pages les plus riches en infos requises.
 */
function pickCandidateUrls(
  root: URL,
  links: { href: string; label: string }[],
): URL[] {
  const byKey = new Map<string, { u: URL; score: number; order: number }>();
  let order = 0;
  for (const { href, label } of links) {
    let u: URL;
    try {
      u = new URL(href, root);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (u.hostname !== root.hostname) continue; // même origine uniquement
    u.hash = "";
    const key = u.toString();
    if (key === root.toString()) continue;
    const haystack = `${u.pathname} ${label}`.toLowerCase();
    let score = 0;
    for (const { kw, weight } of LINK_KEYWORDS) {
      if (haystack.includes(kw)) score += weight;
    }
    if (score === 0) continue;
    const prev = byKey.get(key);
    if (!prev || score > prev.score) {
      byKey.set(key, { u, score, order: prev?.order ?? order++ });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((e) => e.u);
}

/** Compose le texte d'une page : données structurées (schema.org) en tête —
 *  pour qu'elles survivent à la troncature — puis le texte du body. */
function composePageText(parsed: ParsedPage): string {
  const body = parsed.text.slice(0, PER_PAGE_TEXT_CHARS);
  if (!parsed.structured) return body;
  return `[DONNÉES STRUCTURÉES schema.org]\n${parsed.structured}\n\n${body}`;
}

/**
 * Crawl la home + jusqu'à MAX_PAGES-1 pages clés. Lève ScanError sur erreur
 * fatale (URL invalide / privée / home injoignable), renvoie [] jamais —
 * au minimum la home si elle répond.
 */
export async function crawlSite(rootRaw: string): Promise<ScannedPage[]> {
  const root = normalizeRootUrl(rootRaw);
  const homeHtml = await fetchHtml(root);
  if (homeHtml == null) {
    throw new ScanError("Impossible de charger la page d'accueil du site.");
  }
  const home = await parseHtml(homeHtml);
  const pages: ScannedPage[] = [
    {
      url: root.toString(),
      title: home.title || root.hostname,
      text: composePageText(home),
    },
  ];

  const candidates = pickCandidateUrls(root, home.links).slice(0, MAX_PAGES - 1);
  const fetched = await Promise.all(
    candidates.map(async (u) => {
      try {
        const html = await fetchHtml(u);
        if (html == null) return null;
        const parsed = await parseHtml(html);
        const text = composePageText(parsed);
        if (!text) return null;
        return {
          url: u.toString(),
          title: parsed.title || u.pathname,
          text,
        } satisfies ScannedPage;
      } catch (e) {
        if (e instanceof ScanError) return null; // page privée → skip, pas fatal
        return null;
      }
    }),
  );
  for (const p of fetched) if (p) pages.push(p);
  return pages;
}

/** Concatène les pages en un seul bloc texte étiqueté pour les sous-agents. */
export function pagesToContext(pages: ScannedPage[]): string {
  return pages
    .map(
      (p, i) =>
        `--- PAGE ${i + 1} : ${p.title} (${p.url}) ---\n${p.text}`,
    )
    .join("\n\n");
}
