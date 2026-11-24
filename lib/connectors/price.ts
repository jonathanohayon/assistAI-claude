// The extra-connector price (C1b): what one connector BEYOND the one included
// in the product costs per month, as admin-editable catalogue data.
// Client-safe, zero imports (the admin form may import it).
//
// NOT the catalogue's `connect.addonMonthly` (39 € / 149 ₪): that one is the
// price of the connect PRODUCT added to another base. This one is per extra
// connector on an account that already has the product (VP: 19 € / 79 ₪).
//
// Stored ADDITIVELY in the product catalogue row (app_settings
// "product_catalogue_v1", lib/product-catalogue-row.ts) under the top-level
// key `connectorExtraMonthly`: { EUR, ILS }. Absent = DEFAULT_CONNECTOR_EXTRA_MONTHLY,
// and the row's bytes stay exactly what they were before.
// Display data only: nothing is charged from it yet (payment: B6).

export type ConnectorPriceCurrency = "EUR" | "ILS";

export type ConnectorExtraMonthly = Record<ConnectorPriceCurrency, number>;

export const CONNECTOR_EXTRA_MONTHLY_KEY = "connectorExtraMonthly";
export const CONNECTOR_EXTRA_CURRENCIES: readonly ConnectorPriceCurrency[] = ["EUR", "ILS"] as const;
export const DEFAULT_CONNECTOR_EXTRA_MONTHLY: Readonly<ConnectorExtraMonthly> = Object.freeze({ EUR: 19, ILS: 79 });

export function defaultConnectorExtraMonthly(): ConnectorExtraMonthly {
  return { ...DEFAULT_CONNECTOR_EXTRA_MONTHLY };
}

/** A valid price: a finite number >= 0 (the catalogue's own price rule). */
export function isConnectorPriceValue(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** STRICT parse: exactly { EUR, ILS }, each a finite number >= 0. Anything else → null. */
export function parseConnectorExtraMonthly(x: unknown): ConnectorExtraMonthly | null {
  if (!isPlainObject(x)) return null;
  const keys = Object.keys(x);
  if (keys.length !== CONNECTOR_EXTRA_CURRENCIES.length || !CONNECTOR_EXTRA_CURRENCIES.every((k) => keys.includes(k))) return null;
  if (!isConnectorPriceValue(x.EUR) || !isConnectorPriceValue(x.ILS)) return null;
  return { EUR: x.EUR, ILS: x.ILS };
}

export type ConnectorExtraMonthlyWrite =
  | { ok: true; value: ConnectorExtraMonthly }
  | { ok: false; fields: string[] };

/**
 * The admin patch `connectorExtraMonthly: { EUR?, ILS? }` applied to the
 * prices in force. Omitted currency = the stored value is kept; a present one
 * must be a finite number >= 0; an unknown key is refused. Every offending
 * path is named, as `connectorExtraMonthly.<currency>`.
 */
export function connectorExtraMonthlyWrite(stored: ConnectorExtraMonthly, patch: unknown): ConnectorExtraMonthlyWrite {
  if (!isPlainObject(patch)) return { ok: false, fields: [CONNECTOR_EXTRA_MONTHLY_KEY] };
  const next = { ...stored };
  const bad: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(CONNECTOR_EXTRA_CURRENCIES as readonly string[]).includes(k) || !isConnectorPriceValue(v)) {
      bad.push(`${CONNECTOR_EXTRA_MONTHLY_KEY}.${k}`);
      continue;
    }
    next[k as ConnectorPriceCurrency] = v;
  }
  return bad.length ? { ok: false, fields: bad } : { ok: true, value: next };
}

/**
 * The price of the NEXT connector, or null when it is not a paid extra.
 *   - in trial → null (a trial never buys an extra);
 *   - paid with 0 connectors → null (the first one is included in the product);
 *   - paid with >= 1 (the derived legacy card counts as one) → the extra
 *     price in the account's currency.
 * Independent of canAdd.ok: a paid account at max_reached / orders_closed
 * still sees what an extra would cost (the page decides what to show).
 */
export function nextConnectorPrice(args: {
  inTrial: boolean;
  used: number;
  currency: ConnectorPriceCurrency;
  prices: ConnectorExtraMonthly;
}): { monthly: number; currency: ConnectorPriceCurrency } | null {
  if (args.inTrial || args.used < 1) return null;
  return { monthly: args.prices[args.currency], currency: args.currency };
}
