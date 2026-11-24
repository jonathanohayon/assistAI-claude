// A number is NEVER both a connector number and a tamaravox number, and
// never shared between two connectors (B1: the pure rule only). Zero imports.
// TODO(B4/B5): call numberConflict at connector creation (B4) and at
// tamaravox number attach (B5), refusing on a non-null answer. This repo
// holds no tamaravox number list today: the caller passes the set it has.

export type NumberConflict = "connector_number" | "tamaravox_number";

const norm = (e164: string) => e164.replace(/[^\d+]/g, "");

export function numberConflict(args: {
  e164: string;
  /** Numbers already held by a connector (any account). */
  connectorNumbers: Iterable<string>;
  /** Numbers already used by tamaravox. */
  tamaravoxNumbers: Iterable<string>;
}): NumberConflict | null {
  const n = norm(args.e164);
  for (const x of args.connectorNumbers) if (norm(x) === n) return "connector_number";
  for (const x of args.tamaravoxNumbers) if (norm(x) === n) return "tamaravox_number";
  return null;
}
