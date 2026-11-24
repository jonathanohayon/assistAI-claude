// The connectors list as the live Connect page mounts it (C1b). SERVER ONLY.
// The page reads the SAME function GET /api/dashboard/connectors answers with
// (loadConnectorsPage, lib/connectors/page.ts): no HTTP call to itself, and
// the secret is never selected there.
//   extraPrice = the page's canAdd.price (the server's next-connector price);
//   basePrice  = the catalogue's connect row in the account's currency
//                (connectorBasePrice, the pricing screens' reader).

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { currencyForLocale } from "@/lib/hyp";
import type { ProductCatalogue } from "@/lib/product-catalogue";
import { getProductCatalogue } from "@/lib/products";

import { connectorBasePrice, type ConnectorBasePrice, type ConnectorExtraPrice } from "./list-view";
import { loadConnectorsPage } from "./page";
import type { ConnectorPriceCurrency } from "./price";
import type { ConnectorsPageView } from "./types";

export type ConnectorsMount = {
  page: ConnectorsPageView;
  extraPrice: ConnectorExtraPrice | null;
  basePrice: ConnectorBasePrice | null;
  /** The server's "now" (ISO): the relative dates render the same on the server and in the browser. */
  now: string;
};

/** Pure: the list's inputs from the page, the catalogue and the account's currency. */
export function connectorsMount(
  page: ConnectorsPageView,
  catalogue: ProductCatalogue,
  currency: ConnectorPriceCurrency,
  now: Date = new Date(),
): ConnectorsMount {
  return {
    page,
    extraPrice: page.canAdd.price ?? null,
    basePrice: connectorBasePrice(catalogue, currency),
    now: now.toISOString(),
  };
}

/** The list's inputs for an account, or null when it does not exist. */
export async function loadConnectorsMount(userId: string): Promise<ConnectorsMount | null> {
  const [page, catalogue, [account]] = await Promise.all([
    loadConnectorsPage(userId),
    getProductCatalogue(),
    db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1),
  ]);
  if (!page || !account) return null;
  // The account's billing currency, as loadConnectorsPage resolves it (he → ILS, else EUR).
  return connectorsMount(page, catalogue, currencyForLocale(account.locale));
}
