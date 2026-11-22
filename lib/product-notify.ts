// "Prévenez-moi" (notify-me) records — SERVER-ONLY (lib/db). Used by
// POST /api/dashboard/products/notify, accountProducts (notifyRequested)
// and GET /api/admin/product-notify (counts only).
//
// A record only: no email is sent. The ONE insert is INSERT … ON CONFLICT
// (user_id, product) DO NOTHING RETURNING; when it returns nothing, the
// existing row is read back, so a repeat (or a concurrent double click)
// answers with the ORIGINAL requestedAt. Never served to the worker.

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { productNotifyRequests } from "@/lib/db/schema";
import { PRODUCT_ENTRIES, type ProductEntry } from "@/lib/product-values";

export function isProductEntry(x: unknown): x is ProductEntry {
  return typeof x === "string" && (PRODUCT_ENTRIES as readonly string[]).includes(x);
}

export type NotifyRecord = { product: ProductEntry; requestedAt: Date };

/**
 * Records the request once per (userId, product). `created` is true only for
 * the call whose insert wrote the row; every other call reads the stored row.
 */
export async function recordNotifyRequest(
  userId: string,
  product: ProductEntry,
): Promise<{ created: boolean; record: NotifyRecord }> {
  const [inserted] = await db
    .insert(productNotifyRequests)
    .values({ userId, product })
    .onConflictDoNothing({ target: [productNotifyRequests.userId, productNotifyRequests.product] })
    .returning({ requestedAt: productNotifyRequests.requestedAt });
  if (inserted) return { created: true, record: { product, requestedAt: inserted.requestedAt } };
  const [existing] = await db
    .select({ requestedAt: productNotifyRequests.requestedAt })
    .from(productNotifyRequests)
    .where(and(eq(productNotifyRequests.userId, userId), eq(productNotifyRequests.product, product)))
    .limit(1);
  if (!existing) throw new Error("product notify request vanished after a conflict");
  return { created: false, record: { product, requestedAt: existing.requestedAt } };
}

/** The entries the account asked to be notified about, in PRODUCT_ENTRIES order. */
export async function loadNotifyRequested(userId: string): Promise<ProductEntry[]> {
  const rows = await db
    .select({ product: productNotifyRequests.product })
    .from(productNotifyRequests)
    .where(eq(productNotifyRequests.userId, userId));
  const set = new Set(rows.map((r) => r.product));
  return PRODUCT_ENTRIES.filter((e) => set.has(e));
}

/** Per entry, how many accounts asked (counts only: no ids, no emails). */
export async function notifyCounts(): Promise<Record<ProductEntry, number>> {
  const rows = await db
    .select({ product: productNotifyRequests.product, n: sql<number>`count(*)::int` })
    .from(productNotifyRequests)
    .groupBy(productNotifyRequests.product);
  const out = Object.fromEntries(PRODUCT_ENTRIES.map((e) => [e, 0])) as Record<ProductEntry, number>;
  for (const r of rows) if (isProductEntry(r.product)) out[r.product] = Number(r.n) || 0;
  return out;
}
