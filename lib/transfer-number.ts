// Per-tenant call-transfer number (agent_configs.transfer_number): where the
// phone agent transfers a caller who asks for a person. Editable by the
// tenant and the admin. '' = no transfer (the agent takes a message instead).
// Unit-tested in scripts/tests/transfer-number.test.ts.

export type TransferNumberParse = { ok: true; value: string } | { ok: false; error: "invalid_transfer_number" };

/**
 * Validates and normalises to E.164. Accepts spaces, dashes, dots and
 * parentheses; requires international format (a leading national 0 is NOT
 * guessed into a country code). Empty / null clears it.
 */
export function parseTransferNumber(raw: unknown): TransferNumberParse {
  if (raw === null || raw === undefined) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, error: "invalid_transfer_number" };
  const cleaned = raw.replace(/[\s().-]/g, "");
  if (cleaned === "") return { ok: true, value: "" };
  const m = /^(\+|00)?([1-9]\d{7,14})$/.exec(cleaned);
  if (!m || !m[1]) return { ok: false, error: "invalid_transfer_number" };
  return { ok: true, value: `+${m[2]}` };
}
