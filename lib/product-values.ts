// Product values (client-safe, zero imports). The catalogue sells four
// products; the dashboard groups them into three entries, because
// "reception_multi" is a bigger reception, not a separate surface.

export const PRODUCTS = ["reception", "reception_multi", "sales", "connect"] as const;
export type Product = (typeof PRODUCTS)[number];

export const PRODUCT_ENTRIES = ["reception", "sales", "connect"] as const;
export type ProductEntry = (typeof PRODUCT_ENTRIES)[number];

/** The dashboard entry a product belongs to (reception_multi → reception). */
export function entryOf(p: Product): ProductEntry {
  return p === "reception_multi" ? "reception" : p;
}

/** The shape stored in users.products: one base product plus add-ons. */
export type AccountProductsRecord = { base: Product; addons: Product[] };
