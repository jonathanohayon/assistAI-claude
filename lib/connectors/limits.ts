// Connector limits (B1): how many connectors an account may have, as
// admin-editable catalogue data, plus a HARD ceiling in code that the
// catalogue can never exceed. Client-safe, zero imports (the admin form may
// import it).
//
// Stored ADDITIVELY in the product catalogue row (app_settings
// "product_catalogue_v1", lib/product-catalogue-row.ts) under the top-level
// key `connectorLimits`. Absent = DEFAULT_CONNECTOR_LIMITS, and the row's
// bytes stay exactly what they were before B1.

/** The ceiling no catalogue value can exceed (the parser refuses > 10). */
export const HARD_MAX_CONNECTORS = 10;

export type ConnectorLimits = {
  /** Connectors allowed while the account is in its trial. */
  trial: number;
  /** Connectors allowed on a paid account (paid extras arrive in B6). */
  paid: number;
};

export const CONNECTOR_LIMITS_KEY = "connectorLimits";
export const CONNECTOR_LIMIT_FIELDS: readonly (keyof ConnectorLimits)[] = ["trial", "paid"] as const;
export const DEFAULT_CONNECTOR_LIMITS: Readonly<ConnectorLimits> = Object.freeze({ trial: 1, paid: 5 });

export function defaultConnectorLimits(): ConnectorLimits {
  return { ...DEFAULT_CONNECTOR_LIMITS };
}

/** A valid limit: an integer from 0 to HARD_MAX_CONNECTORS. */
export function isConnectorLimitValue(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= HARD_MAX_CONNECTORS;
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** STRICT parse: exactly { trial, paid }, each an integer 0..10. Anything else → null. */
export function parseConnectorLimits(x: unknown): ConnectorLimits | null {
  if (!isPlainObject(x)) return null;
  const keys = Object.keys(x);
  if (keys.length !== CONNECTOR_LIMIT_FIELDS.length || !CONNECTOR_LIMIT_FIELDS.every((k) => keys.includes(k))) return null;
  if (!isConnectorLimitValue(x.trial) || !isConnectorLimitValue(x.paid)) return null;
  return { trial: x.trial, paid: x.paid };
}

/** Defence in depth: whatever a caller hands over, never above the ceiling. */
export function clampConnectorLimit(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), HARD_MAX_CONNECTORS);
}

export type ConnectorLimitsWrite =
  | { ok: true; value: ConnectorLimits }
  | { ok: false; fields: string[] };

/**
 * The admin patch `connectorLimits: { trial?, paid? }` applied to the limits
 * in force. Omitted field = the stored value is kept; a present field must be
 * an integer 0..10 (> 10 is refused, never clamped); an unknown key is
 * refused. Every offending path is named, as `connectorLimits.<field>`.
 */
export function connectorLimitsWrite(stored: ConnectorLimits, patch: unknown): ConnectorLimitsWrite {
  if (!isPlainObject(patch)) return { ok: false, fields: [CONNECTOR_LIMITS_KEY] };
  const next = { ...stored };
  const bad: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(CONNECTOR_LIMIT_FIELDS as readonly string[]).includes(k) || !isConnectorLimitValue(v)) {
      bad.push(`${CONNECTOR_LIMITS_KEY}.${k}`);
      continue;
    }
    next[k as keyof ConnectorLimits] = v;
  }
  return bad.length ? { ok: false, fields: bad } : { ok: true, value: next };
}
