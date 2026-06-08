/**
 * Assemble les résultats des sous-agents en un brouillon `BusinessConfig`
 * propre (passé dans `sanitizeBusinessConfig`) + une carte de confiance par
 * section, consommée par l'écran de revue du wizard.
 *
 * Choix produit : la plupart des établissements n'ont qu'un centre → les
 * horaires de `hoursAgent` sont injectés sur le CENTRE PRINCIPAL (centres[0]).
 * S'il y a plusieurs centres, l'utilisateur ajustera en revue.
 */

import {
  sanitizeBusinessConfig,
  type BusinessConfig,
  type WeekDay,
  type WeeklyHours,
} from "@/lib/business";

import type {
  HoursResult,
  IdentityResult,
  LanguagesResult,
  LocationResult,
  ServicesResult,
} from "./agents";

export interface AgentOutputs {
  identity?: IdentityResult;
  hours?: HoursResult;
  location?: LocationResult;
  services?: ServicesResult;
  languages?: LanguagesResult;
}

export interface ScanConfidence {
  identity: number;
  hours: number;
  location: number;
  services: number;
  languages: number;
}

export interface ScanDraft {
  business: BusinessConfig;
  suggestedPrimaryLanguage: string | null;
  confidence: ScanConfidence;
  pages: { url: string; title: string }[];
}

const WEEK_DAYS: WeekDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const closedDay = () => ({ open: false, openTime: "09:00", closeTime: "18:00" });

/** Construit une WeeklyHours complète depuis le partiel de hoursAgent. */
function buildWeeklyHours(partial: HoursResult["hours"]): WeeklyHours {
  return WEEK_DAYS.reduce<WeeklyHours>((acc, d) => {
    const v = partial[d];
    if (v && v.open && v.openTime && v.closeTime) {
      acc[d] = { open: true, openTime: v.openTime, closeTime: v.closeTime };
    } else {
      acc[d] = closedDay();
    }
    return acc;
  }, {} as WeeklyHours);
}

const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function assembleDraft(
  outputs: AgentOutputs,
  pages: { url: string; title: string }[],
): ScanDraft {
  const identity = {
    name: outputs.identity?.name ?? "",
    tagline: outputs.identity?.tagline ?? "",
    email: outputs.identity?.email ?? "",
  };

  const hasHours = outputs.hours
    ? Object.values(outputs.hours.hours).some((d) => d?.open)
    : false;
  const weeklyHours = hasHours
    ? buildWeeklyHours(outputs.hours!.hours)
    : buildWeeklyHours({});

  // Centres : depuis locationAgent. Si aucun mais on a un nom/horaires,
  // on crée un centre principal pour ne pas perdre les horaires.
  const rawCentres = outputs.location?.centres ?? [];
  const centres = rawCentres.map((c, i) => ({
    id: newId("ctr"),
    name: c.name,
    address: c.address,
    hours: i === 0 ? weeklyHours : buildWeeklyHours({}),
  }));
  if (centres.length === 0 && (hasHours || identity.name)) {
    centres.push({
      id: newId("ctr"),
      name: identity.name || "Établissement principal",
      address: "",
      hours: weeklyHours,
    });
  }

  const services = (outputs.services?.services ?? []).map((s) => ({
    id: newId("svc"),
    name: s.name,
    durationMinutes: s.durationMinutes,
    priceILS: s.priceILS,
    centreIds: "all" as const,
    description: s.description,
  }));

  // Toujours sanitizer → structure garantie valide, ids/caps/regex appliqués.
  const business = sanitizeBusinessConfig({
    identity,
    centres,
    services,
    centresRules: "",
  });

  return {
    business,
    suggestedPrimaryLanguage: outputs.languages?.suggestedPrimary ?? null,
    confidence: {
      identity: outputs.identity?.confidence ?? 0,
      hours: outputs.hours?.confidence ?? 0,
      location: outputs.location?.confidence ?? 0,
      services: outputs.services?.confidence ?? 0,
      languages: outputs.languages?.confidence ?? 0,
    },
    pages,
  };
}
