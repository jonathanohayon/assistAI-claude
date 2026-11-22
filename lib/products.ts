// Products, server side: the admin-editable catalogue (app_settings
// "product_catalogue_v1", defaults = DEFAULT_PRODUCT_CATALOGUE) and the
// account's entitled products. SERVER-ONLY (lib/db). Client code imports
// lib/product-values.ts, lib/product-entitlement.ts or
// lib/product-catalogue.ts instead.
//
// No behaviour change yet: no account has users.products set (sign-up does
// not write it before P3), so every existing read (PLANS, minutesIncluded,
// OVERAGE_RATE_ILS_PER_MIN, billing-stats) stays the source of truth.
// Per-product usage and overage (minutesFor / overageFor) are read in P2.

import { eq } from "drizzle-orm";

import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { accountProductTrials, users } from "@/lib/db/schema";
import {
  catalogueMinutes,
  catalogueOverage,
  defaultProductCatalogue,
  parseProductCatalogue,
  type CatalogueCurrency,
  type ProductCatalogue,
} from "@/lib/product-catalogue";
import { noEngineOverrides, type EngineOverrides } from "@/lib/engine-override";
import { parseCatalogueRow, serializeCatalogueRow, type CatalogueRow } from "@/lib/product-catalogue-row";
import { entitledProducts, type Entitlement } from "@/lib/product-entitlement";
import { activeTrialProducts, trialStates, type ProductTrialRow, type TrialStates } from "@/lib/product-trials";
import type { Product } from "@/lib/product-values";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";

export type StoredCatalogue = {
  catalogue: ProductCatalogue;
  /** E2 (additive): the per-product engine overrides; none when absent / invalid. */
  engineOverrides: EngineOverrides;
  source: "stored" | "default" | "invalid";
};

/**
 * The catalogue from the raw app_settings value: absent → defaults; a row
 * that is not JSON or fails the strict parse → defaults, flagged "invalid"
 * (the caller alerts). The row may carry engine overrides (E2,
 * lib/product-catalogue-row.ts); an invalid row has none. Pure.
 */
export function catalogueFromStored(raw: string | null): StoredCatalogue {
  const fallback = (source: "default" | "invalid"): StoredCatalogue => ({
    catalogue: defaultProductCatalogue(),
    engineOverrides: noEngineOverrides(),
    source,
  });
  if (raw == null) return fallback("default");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback("invalid");
  }
  const row = parseCatalogueRow(parsed);
  return row ? { ...row, source: "stored" } : fallback("invalid");
}

export type CatalogueDeps = {
  read: (key: string) => Promise<string | null>;
  onInvalid: () => void;
};

const defaultCatalogueDeps: CatalogueDeps = {
  read: getSetting,
  onInvalid: () => {
    console.warn(`[products] app_settings.${SETTING_KEYS.PRODUCT_CATALOGUE} is invalid; serving the default catalogue`);
    // Never throws (alertAdmins catches); deduplicated to one alert a day.
    void alertAdmins({
      key: "product_catalogue_invalid",
      subject: "Product catalogue row is invalid",
      body: `app_settings.${SETTING_KEYS.PRODUCT_CATALOGUE} failed the strict parse; the default catalogue is served until it is fixed from /admin.`,
      dedupMs: 24 * 60 * 60 * 1000,
      severity: "warning",
    });
  },
};

/** The whole row in force: prices + engine overrides (stored, else the defaults / none). */
export async function getCatalogueRow(deps: CatalogueDeps = defaultCatalogueDeps): Promise<CatalogueRow> {
  const r = catalogueFromStored(await deps.read(SETTING_KEYS.PRODUCT_CATALOGUE));
  if (r.source === "invalid") deps.onInvalid();
  return { catalogue: r.catalogue, engineOverrides: r.engineOverrides };
}

/** The catalogue in force (stored, else the defaults). Prices only. */
export async function getProductCatalogue(deps: CatalogueDeps = defaultCatalogueDeps): Promise<ProductCatalogue> {
  return (await getCatalogueRow(deps)).catalogue;
}

/** The engine overrides in force (E2). None when the row is absent or invalid. */
export async function getEngineOverrides(deps: CatalogueDeps = defaultCatalogueDeps): Promise<EngineOverrides> {
  return (await getCatalogueRow(deps)).engineOverrides;
}

/**
 * Writes a catalogue that already passed the strict parse, with its engine
 * overrides. `overrides` omitted = the STORED overrides are kept (a price-only
 * caller never wipes them). No override → the pre-E2 bytes.
 */
export async function setProductCatalogue(cat: ProductCatalogue, overrides?: EngineOverrides): Promise<void> {
  if (!parseProductCatalogue(cat)) throw new Error("refusing to store an invalid product catalogue");
  const o = overrides ?? catalogueFromStored(await getSetting(SETTING_KEYS.PRODUCT_CATALOGUE)).engineOverrides;
  const text = serializeCatalogueRow(cat, o);
  if (!parseCatalogueRow(JSON.parse(text))) throw new Error("refusing to store an invalid product catalogue row");
  await setSetting(SETTING_KEYS.PRODUCT_CATALOGUE, text);
}

/** Included monthly minutes of a product in a currency. */
export async function minutesFor(product: Product, currency: CatalogueCurrency): Promise<number> {
  return catalogueMinutes(await getProductCatalogue(), product, currency);
}

/** Overage per minute of a product in a currency. */
export async function overageFor(product: Product, currency: CatalogueCurrency): Promise<number> {
  return catalogueOverage(await getProductCatalogue(), product, currency);
}

/** The three users columns entitlement needs, and nothing else. */
export const ACCOUNT_PRODUCTS_PICK = {
  subscriptionPlan: users.subscriptionPlan,
  subscriptionStatus: users.subscriptionStatus,
  products: users.products,
} as const;

/** The account's per-product trial rows (any userId). */
export async function loadProductTrials(userId: string): Promise<ProductTrialRow[]> {
  return db
    .select({
      product: accountProductTrials.product,
      startedAt: accountProductTrials.startedAt,
      endsAt: accountProductTrials.endsAt,
      minutesIncluded: accountProductTrials.minutesIncluded,
    })
    .from(accountProductTrials)
    .where(eq(accountProductTrials.userId, userId));
}

/** The entitlement plus, ADDITIVELY (P3), each entry's per-product trial state. */
export type AccountProducts = Entitlement & { trials: TrialStates };

/**
 * The products an account is entitled to. Loads ONLY the explicit pick
 * above (plus its trial rows), for any userId (so the admin ?asUserId=
 * target works). An ACTIVE per-product trial makes its entry entitled for
 * the trial's duration (entitledProducts activeTrials). An unknown account
 * is entitled to nothing (base null), every trial "available".
 */
export async function accountProducts(userId: string, now: Date = new Date()): Promise<AccountProducts> {
  const [u] = await db.select(ACCOUNT_PRODUCTS_PICK).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return { base: null, addons: [], entries: [], source: "grandfathered", trials: trialStates([], now) };
  const rows = await loadProductTrials(userId);
  return { ...entitledProducts({ ...u, activeTrials: activeTrialProducts(rows, now) }), trials: trialStates(rows, now) };
}
