/**
 * Sanitization + types pour la config `business` (jsonb sur agent_configs).
 * Partagé entre /api/dashboard/config et /api/admin/configs/[userId] pour
 * avoir EXACTEMENT les mêmes règles de cleanup côté tenant et côté admin.
 *
 * Le worker côté `assistAI-claude-agent/` lit cette structure via
 * /api/agent/config (passée telle quelle dans FetchedConfig.business).
 */

export type WeekDay =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export interface DayHours {
  open: boolean;
  /** "HH:MM" 00:00-23:59 */
  openTime: string;
  /** "HH:MM" — closeTime > openTime quand open=true. */
  closeTime: string;
}

export type WeeklyHours = Record<WeekDay, DayHours>;

export interface BusinessCentre {
  id: string;
  name: string;
  address: string;
  hours: WeeklyHours;
}

export interface BusinessService {
  id: string;
  name: string;
  durationMinutes: number;
  priceILS: number;
  /** Soit "all" sentinel, soit array d'ids de centres. */
  centreIds: string[] | "all";
  description: string;
}

export interface BusinessConfig {
  identity: { name: string; tagline: string; email: string };
  centres: BusinessCentre[];
  services: BusinessService[];
}

const WEEK_DAYS: readonly WeekDay[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const sanitizeTime = (raw: unknown, fallback: string): string => {
  if (typeof raw !== "string") return fallback;
  return TIME_RE.test(raw) ? raw : fallback;
};

const defaultDayHours = (open: boolean): DayHours => ({
  open,
  openTime: "09:00",
  closeTime: "18:00",
});

const sanitizeDayHours = (raw: unknown): DayHours => {
  if (!raw || typeof raw !== "object") return defaultDayHours(false);
  const r = raw as Partial<DayHours>;
  const open = Boolean(r.open);
  const openTime = sanitizeTime(r.openTime, "09:00");
  const closeTime = sanitizeTime(r.closeTime, "18:00");
  // Hard guarantee : closeTime > openTime quand open=true. Si incohérent,
  // force open=false pour ne jamais envoyer au worker des horaires
  // négatifs ou nuls qui pourraient confuser le LLM ou les tools.
  if (open && closeTime <= openTime) {
    return { open: false, openTime, closeTime };
  }
  return { open, openTime, closeTime };
};

const sanitizeWeeklyHours = (raw: unknown): WeeklyHours => {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return WEEK_DAYS.reduce<WeeklyHours>((acc, day) => {
    acc[day] = sanitizeDayHours(src[day]);
    return acc;
  }, {} as WeeklyHours);
};

const trim = (raw: unknown, max: number): string =>
  (typeof raw === "string" ? raw : "").trim().slice(0, max);

const clampInt = (raw: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};

const genId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const sanitizeCentre = (raw: unknown): BusinessCentre | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<BusinessCentre>;
  const name = trim(r.name, 120);
  if (!name) return null;
  return {
    id: trim(r.id, 64) || genId("ctr"),
    name,
    address: trim(r.address, 240),
    hours: sanitizeWeeklyHours(r.hours),
  };
};

const sanitizeService = (
  raw: unknown,
  centreIds: Set<string>,
): BusinessService | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<BusinessService>;
  const name = trim(r.name, 120);
  if (!name) return null;
  let centreIdsClean: string[] | "all";
  if (r.centreIds === "all") {
    centreIdsClean = "all";
  } else if (Array.isArray(r.centreIds)) {
    const filtered = r.centreIds
      .filter((id): id is string => typeof id === "string")
      .filter((id) => centreIds.has(id));
    centreIdsClean = filtered;
  } else {
    centreIdsClean = "all";
  }
  return {
    id: trim(r.id, 64) || genId("svc"),
    name,
    durationMinutes: clampInt(r.durationMinutes, 5, 480, 30),
    priceILS: clampInt(r.priceILS, 0, 100000, 0),
    centreIds: centreIdsClean,
    description: trim(r.description, 600),
  };
};

const DEFAULT_BUSINESS: BusinessConfig = {
  identity: { name: "", tagline: "", email: "" },
  centres: [],
  services: [],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Renvoie un BusinessConfig propre — toujours valide, jamais throw. */
export function sanitizeBusinessConfig(raw: unknown): BusinessConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_BUSINESS;
  const r = raw as Partial<BusinessConfig>;
  const identityRaw = (r.identity ?? {}) as Partial<
    BusinessConfig["identity"]
  >;
  const email = trim(identityRaw.email, 160);
  const identity = {
    name: trim(identityRaw.name, 120),
    tagline: trim(identityRaw.tagline, 200),
    // Email accepté seulement si format valide OU vide. Sinon → vide (ne
    // bloque pas le save mais évite d'envoyer du junk au worker/recap).
    email: email.length === 0 || EMAIL_RE.test(email) ? email : "",
  };
  // Centres : dedupe par id (first-wins), max 12, drop entries sans name.
  const centresArr = Array.isArray(r.centres) ? r.centres : [];
  const seenCentreIds = new Set<string>();
  const centres: BusinessCentre[] = [];
  for (const item of centresArr) {
    if (centres.length >= 12) break;
    const c = sanitizeCentre(item);
    if (!c) continue;
    if (seenCentreIds.has(c.id)) continue;
    seenCentreIds.add(c.id);
    centres.push(c);
  }
  // Services : dedupe id, max 60, centreIds filtrés vs centres existants.
  const servicesArr = Array.isArray(r.services) ? r.services : [];
  const validCentreIds = new Set(centres.map((c) => c.id));
  const seenServiceIds = new Set<string>();
  const services: BusinessService[] = [];
  for (const item of servicesArr) {
    if (services.length >= 60) break;
    const s = sanitizeService(item, validCentreIds);
    if (!s) continue;
    if (seenServiceIds.has(s.id)) continue;
    seenServiceIds.add(s.id);
    services.push(s);
  }
  return { identity, centres, services };
}

/** Rendu markdown pour le prompt system block envoyé à OpenAI. */
export function renderBusinessPromptBlock(b: BusinessConfig): string {
  const hasIdentity =
    b.identity.name.length > 0 || b.identity.tagline.length > 0;
  const hasCentres = b.centres.length > 0;
  const hasServices = b.services.length > 0;
  if (!hasIdentity && !hasCentres && !hasServices) return "";

  const dayLabels: Record<WeekDay, string> = {
    sun: "Dim",
    mon: "Lun",
    tue: "Mar",
    wed: "Mer",
    thu: "Jeu",
    fri: "Ven",
    sat: "Sam",
  };
  const orderedDays: WeekDay[] = [
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
  ];

  const parts: string[] = [];
  parts.push(
    `BUSINESS — INFOS STRUCTURÉES (5 tools dédiés : \`list_centres\`, \`get_centre_info\`, \`get_opening_hours\`, \`list_services\`, \`find_service\`).`,
  );

  if (hasIdentity || b.identity.email) {
    const lines = ["", "## Identité"];
    if (b.identity.name) lines.push(`- Nom : ${b.identity.name}`);
    if (b.identity.tagline) lines.push(`- Slogan : ${b.identity.tagline}`);
    if (b.identity.email) lines.push(`- Email : ${b.identity.email}`);
    parts.push(lines.join("\n"));
  }

  if (hasCentres) {
    const centreSection = [`\n## Centres (${b.centres.length})`];
    b.centres.forEach((c, i) => {
      centreSection.push(`\n### ${i + 1}. ${c.name} (id: \`${c.id}\`)`);
      if (c.address) centreSection.push(`- Adresse : ${c.address}`);
      centreSection.push(`- Horaires :`);
      for (const d of orderedDays) {
        const dh = c.hours[d];
        if (!dh || !dh.open) {
          centreSection.push(`  - ${dayLabels[d]} : fermé`);
        } else {
          centreSection.push(
            `  - ${dayLabels[d]} : ${dh.openTime}–${dh.closeTime}`,
          );
        }
      }
    });
    parts.push(centreSection.join("\n"));
  }

  if (hasServices) {
    const lines = [`\n## Soins & tarifs (${b.services.length})`, ""];
    lines.push("| Soin | Durée | Prix | Disponible à |");
    lines.push("|------|-------|------|--------------|");
    for (const s of b.services) {
      const dur = `${s.durationMinutes} min`;
      const price = `${s.priceILS} ₪`;
      let centreLabel = "tous les centres";
      if (s.centreIds !== "all") {
        if (s.centreIds.length === 0) centreLabel = "(aucun)";
        else {
          const names = s.centreIds
            .map((id) => b.centres.find((c) => c.id === id)?.name)
            .filter(Boolean);
          centreLabel = names.length > 0 ? names.join(", ") : "(centres inconnus)";
        }
      }
      lines.push(`| ${s.name} | ${dur} | ${price} | ${centreLabel} |`);
    }
    parts.push(lines.join("\n"));
  }

  parts.push(
    `\nUSAGE : pour toute question factuelle (horaires d'un centre, prix d'un soin, dispo par centre), **appelle le tool dédié** plutôt que de citer cette section de mémoire — les tools renvoient les valeurs à jour.`,
  );

  return parts.join("\n");
}
