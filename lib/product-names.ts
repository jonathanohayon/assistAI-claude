// SERVER-ONLY: the three products' names, read from the ONE key that names
// each product everywhere (DashboardNav.<entry>, lib/dashboard-nav.ts
// ENTRY_LABEL_KEY). Server pages hand them to client components that can't
// read messages themselves (the admin is outside the [locale] provider).
// The admin is French-only: it passes locale "fr".

import { getTranslations } from "next-intl/server";

import { ENTRY_LABEL_KEY } from "./dashboard-nav";
import { PRODUCT_ENTRIES, type ProductNames } from "./product-values";

export async function productNames(locale: string): Promise<ProductNames> {
  const t = await getTranslations({ locale, namespace: "DashboardNav" });
  return Object.fromEntries(PRODUCT_ENTRIES.map((e) => [e, t(ENTRY_LABEL_KEY[e])])) as ProductNames;
}
