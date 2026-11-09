// Client-side helpers for the call-transfer number field: a country prefix
// selector plus a free-form number. The server (lib/transfer-number.ts)
// refuses a national number like "050…", so the UI converts it to E.164
// before saving. Unit-tested in scripts/tests/transfer-number-input.test.ts.

import { parseTransferNumber, type TransferNumberParse } from "./transfer-number";

export const TRANSFER_PREFIXES = ["+972", "+33", "+1"] as const;
export type TransferPrefix = (typeof TRANSFER_PREFIXES)[number];
export const DEFAULT_TRANSFER_PREFIX: TransferPrefix = "+972";

// Countries whose national format starts with a trunk "0" (050…, 06…).
const TRUNK_ZERO: Record<TransferPrefix, boolean> = { "+972": true, "+33": true, "+1": false };

/**
 * Builds the E.164 number from the selected prefix and what the user typed.
 * An explicit international number (+… or 00…) wins over the prefix; a
 * national number drops its trunk 0 and gets the prefix. Empty = no transfer.
 */
export function toTransferE164(prefix: TransferPrefix, input: string): TransferNumberParse {
  const cleaned = input.replace(/[\s().-]/g, "");
  if (cleaned === "") return { ok: true, value: "" };
  if (cleaned.startsWith("+") || cleaned.startsWith("00")) return parseTransferNumber(cleaned);
  if (!/^\d+$/.test(cleaned)) return { ok: false, error: "invalid_transfer_number" };
  const national = TRUNK_ZERO[prefix] ? cleaned.replace(/^0/, "") : cleaned;
  return parseTransferNumber(prefix + national);
}

/** Splits a stored E.164 value back into prefix + national number for display. */
export function splitTransferE164(value: string): { prefix: TransferPrefix; local: string } {
  const hit = [...TRANSFER_PREFIXES]
    .sort((a, b) => b.length - a.length)
    .find((p) => value.startsWith(p));
  if (!value || !hit) return { prefix: DEFAULT_TRANSFER_PREFIX, local: value };
  const rest = value.slice(hit.length);
  return { prefix: hit, local: TRUNK_ZERO[hit] ? `0${rest}` : rest };
}
