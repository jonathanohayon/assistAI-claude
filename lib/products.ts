// Products, server side: the admin-editable catalogue (app_settings
// "product_catalogue_v1", defaults = DEFAULT_PRODUCT_CATALOGUE) and the
// account's entitled products. SERVER-ONLY (lib/db). Client code imports
// lib/product-values.ts, lib/product-entitlement.ts or
// lib/product-catalogue.ts instead.
//
// No behaviour change yet: no account has users.products set (sign-up does
// not write it before P3), so every existing read (PLANS, minutesIncluded,
// OVERAGE_RATE_ILS_PER_MIN) stays the source of truth; the catalogue numbers
// are read only where users.products holds a valid record.

import { eq } from "drizzle-orm";

import { alertAdmins } from "@/lib/alerts";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  catalogueMinutes,
  catalogueOverage,
  defaultProductCatalogue,
  parseProductCatalogue,
  type CatalogueCurrency,
  type ProductCatalogue,
} from "@/lib/product-catalogue";
import { entitledProducts, type Entitlement } from "@/lib/product-entitlement";
import type { Product } from "@/lib/product-values";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";

export type StoredCatalogue = { catalogue: ProductCatalogue; source: "stored" | "default" | "invalid" };

/**
 * The catalogue from the raw app_settings value: absent → defaults; a row
 * that is not JSON or fails the strict parse → defaults, flagged "invalid"
 * (the caller alerts). Pure.
 */
export function catalogueFromStored(raw: string | null): StoredCatalogue {
  if (raw == null) return { catalogue: defaultProductCatalogue(), source: "default" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { catalogue: defaultProductCatalogue(), source: "invalid" };
  }
  const cat = parseProductCatalogue(parsed);
  return cat ? { catalogue: cat, source: "stored" } : { catalogue: defaultProductCatalogue(), source: "invalid" };
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

/** The catalogue in force (stored, else the defaults). */
export async function getProductCatalogue(deps: CatalogueDeps = defaultCatalogueDeps): Promise<ProductCatalogue> {
  const r = catalogueFromStored(await deps.read(SETTING_KEYS.PRODUCT_CATALOGUE));
  if (r.source === "invalid") deps.onInvalid();
  return r.catalogue;
}

/** Writes a catalogue that already passed the strict parse. */
export async function setProductCatalogue(cat: ProductCatalogue): Promise<void> {
  if (!parseProductCatalogue(cat)) throw new Error("refusing to store an invalid product catalogue");
  await setSetting(SETTING_KEYS.PRODUCT_CATALOGUE, JSON.stringify(cat));
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

/**
 * The products an account is entitled to. Loads ONLY the explicit pick
 * above, for any userId (so the admin ?asUserId= target works). An unknown
 * account is entitled to nothing (base null).
 */
export async function accountProducts(userId: string): Promise<Entitlement> {
  const [u] = await db.select(ACCOUNT_PRODUCTS_PICK).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return { base: null, addons: [], entries: [], source: "grandfathered" };
  return entitledProducts(u);
}
