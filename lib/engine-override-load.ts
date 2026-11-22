// The engine override, server side (E2): loads what engineForCall needs and
// raises the admin alert when an override is ignored. SERVER-ONLY (lib/db).
// Used by the three session-config handlers AND the admin banner endpoint
// (GET /api/admin/users/[userId]/engine), so the screen and the call can't
// disagree: both get the result of the SAME decide* function.
//
// I/O order keeps the no-override path cheap: the catalogue row is read
// first (and, on the sales paths, the account's own sales override, one
// explicit column pick); when neither is set, nothing else is read and
// engineForCall returns `apply: false` (the handler runs today's code).
//
// The client sales override (E2b, users.sales_engine_override) is read ONLY
// here: never served, never spread; only the resolved engine/model goes out.

import { eq } from "drizzle-orm";

import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  engineForCall,
  parseEngineOverride,
  productForPath,
  type CallPath,
  type EngineForCall,
  type EngineOverride,
  type EngineOverrides,
} from "@/lib/engine-override";
import type { ClientEngineColumns, EngineChoice } from "@/lib/engine-resolve";
import { getEngineLanguages } from "@/lib/engine-languages-storage";
import type { Product } from "@/lib/product-values";
import { accountProducts, getEngineOverrides } from "@/lib/products";
import { effectiveRealtimeProvider } from "@/lib/realtime-provider";

/** The alert sink (inbound: fx.alertAdmins, so the dry run stays silent). */
export type EngineAlert = (args: Parameters<typeof alertAdmins>[0]) => Promise<unknown>;
export const LIVE_ENGINE_ALERT: EngineAlert = (args) => alertAdmins(args);
export const NO_ENGINE_ALERT: EngineAlert = async () => false;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The alert ledger key: one alert per account × product per day. */
export function engineIgnoredAlertKey(userId: string, product: Product): string {
  return `engine_override_ignored:${userId}:${product}`;
}

async function alertIgnored(alert: EngineAlert, userId: string, product: Product, language: string, d: EngineForCall) {
  if (!d.ignored) return;
  const w = d.ignored.wanted;
  const why = d.ignored.reason === "language" ? `does not speak the account language (${language})` : `is not honoured for ${product}`;
  await alert({
    key: engineIgnoredAlertKey(userId, product),
    subject: "Engine override ignored for an account",
    body: `The ${w.source} engine override ${w.engine}${w.model ? ` ${w.model}` : ""} for product ${product} ${why}. Account ${userId} keeps its current engine until this is fixed.`,
    dedupMs: DAY_MS,
    severity: "warning",
  });
}

/** Inbound "today" values: the effective provider + the tenant's model (as the handler serves them). */
export function inboundToday(config: ClientEngineColumns): EngineChoice {
  return { engine: effectiveRealtimeProvider(config.realtimeProvider), model: config.model || "gpt-realtime-2" };
}

export type DecideDeps = {
  overrides?: () => Promise<EngineOverrides>;
  entitled?: (userId: string) => Promise<Product[]>;
  clientSalesOverride?: (userId: string) => Promise<EngineOverride | null>;
};

/**
 * The account's stored sales override (users.sales_engine_override), through
 * the SAME strict parser as the product override. NULL or a malformed value
 * (only a hand-edited row: the admin route refuses it) = no override.
 */
export async function getClientSalesOverride(userId: string): Promise<EngineOverride | null> {
  const [row] = await db
    .select({ salesEngineOverride: users.salesEngineOverride })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.salesEngineOverride == null ? null : parseEngineOverride(row.salesEngineOverride);
}

const entitledOf = async (userId: string): Promise<Product[]> => {
  const p = await accountProducts(userId);
  return p.base ? [p.base, ...p.addons] : [...p.addons];
};

async function decide(
  path: CallPath,
  userId: string,
  client: ClientEngineColumns | null,
  language: string,
  today: EngineChoice,
  alert: EngineAlert,
  deps: DecideDeps,
): Promise<{ product: Product | null; decision: EngineForCall }> {
  const overrides = await (deps.overrides ?? (() => getEngineOverrides()))();
  const relevant: Product[] = path === "inbound" ? ["reception", "reception_multi"] : ["sales"];
  // Sales only: the account's own sales override (ranked above the product's).
  const clientSalesOverride = path === "inbound" ? null : await (deps.clientSalesOverride ?? getClientSalesOverride)(userId);
  const none = { path, client, overrides, language, today, clientSalesOverride } as const;
  if (!relevant.some((p) => overrides[p]) && !clientSalesOverride) {
    // No override for this path's products: today's values, nothing else read.
    const product = path === "inbound" ? null : "sales";
    return { product, decision: engineForCall({ ...none, product: null, languages: { openai: {}, gemini: {}, xai: {} } }) };
  }
  const product = productForPath(path, path === "inbound" ? await (deps.entitled ?? entitledOf)(userId) : []);
  const languages = await getEngineLanguages();
  const decision = engineForCall({ ...none, product, languages });
  if (product) await alertIgnored(alert, userId, product, language, decision);
  return { product, decision };
}

/** The inbound (phone / web / call_me) decision for an account. */
export async function decideInboundEngine(
  userId: string,
  config: ClientEngineColumns & { primaryLanguage: string | null },
  alert: EngineAlert,
  deps: DecideDeps = {},
) {
  return decide("inbound", userId, config, config.primaryLanguage || "fr", inboundToday(config), alert, deps);
}

/** The sales (campaign / outbound_test) decision: `today` = openai + the env model. */
export async function decideSalesEngine(
  path: "campaign" | "outbound_test",
  userId: string,
  language: string,
  today: EngineChoice,
  alert: EngineAlert,
  deps: DecideDeps = {},
) {
  return decide(path, userId, null, language, today, alert, deps);
}
