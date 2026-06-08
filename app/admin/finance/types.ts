// Types Finance re-déclarés localement pour rester côté client (les modules
// lib/finance/* sont server-friendly mais on évite de bundler leur runtime).
// Source de vérité : lib/finance/cost.ts et lib/finance/rates.ts.

export type Granularity = "day" | "month" | "year";

export interface CategoryCost {
  openai: number;
  twilioVoice: number;
  twilioNumbers: number;
  whatsapp: number;
  infra: number;
  total: number;
}

export interface CostBucket extends CategoryCost {
  period: string; // "YYYY-MM-DD"
  revenueUsd: number;
  marginUsd: number;
}

export interface TenantCost {
  userId: string;
  email: string;
  displayName: string;
  plan: string;
  cost: CategoryCost;
  revenueUsd: number;
  marginUsd: number;
}

export interface UsageTotals {
  inboundMinutes: number;
  outboundMinutes: number;
  whatsappMessages: number;
  activeNumbers: number;
  openaiInputTokens: number;
  openaiOutputTokens: number;
  tokensTracked: boolean;
}

export interface FinanceStats {
  scope: "global" | "user";
  currency: "USD";
  range: { from: string; to: string };
  granularity: Granularity;
  estimated: boolean;
  totals: CategoryCost;
  revenueUsd: number;
  marginUsd: number;
  series: CostBucket[];
  byCategory: { category: string; amount: number }[];
  byPlan: { plan: string; amount: number }[];
  tenants: TenantCost[];
  usage: UsageTotals;
}

export interface CostRates {
  openaiUsdPerMinute: number;
  openaiUsdPerInputToken: number;
  openaiUsdPerOutputToken: number;
  openaiUsdPerCachedInputToken: number;
  twilioInboundUsdPerMinute: number;
  twilioOutboundUsdPerMinute: number;
  twilioNumberUsdPerMonth: number;
  whatsappUsdPerMessage: number;
  infraUsdPerMonth: number;
  eurToUsd: number;
  ilsToUsd: number;
}

// ── Catégories de coût : clés, libellés FR, couleurs ─────────────────────────
export type CostCategoryKey =
  | "openai"
  | "twilioVoice"
  | "twilioNumbers"
  | "whatsapp"
  | "infra";

export const CATEGORY_LABELS: Record<CostCategoryKey, string> = {
  openai: "OpenAI",
  twilioVoice: "Twilio voix",
  twilioNumbers: "Twilio numéros",
  whatsapp: "WhatsApp",
  infra: "Infra",
};

export const CATEGORY_COLORS: Record<CostCategoryKey, string> = {
  openai: "#10b981",
  twilioVoice: "#0e7490",
  twilioNumbers: "#22d3ee",
  whatsapp: "#25D366",
  infra: "#94a3b8",
};

export const CATEGORY_ORDER: CostCategoryKey[] = [
  "openai",
  "twilioVoice",
  "twilioNumbers",
  "whatsapp",
  "infra",
];

// Libellés de formule (plan) en français.
export const PLAN_LABELS: Record<string, string> = {
  whatsapp: "Permanence",
  global: "Réceptionniste",
  premium: "Call Center",
};

export function planLabel(plan: string): string {
  return PLAN_LABELS[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}
