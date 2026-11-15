// Event rows as they may leave the server for a browser. A READ-TIME mask:
// stored rows are never rewritten. It covers rows stored before #332 (caller's
// `fromNumber` in clear, numbers / emails in `message`) and new ones (which
// carry `<key>Hash` correlation keys that a browser has no use for).
//
// Same rules as the Monitoring screen (lib/monitoring-label.ts, built on
// lib/pii-mask.ts): `<key>Hash` dropped, caller numbers -> "…1234", emails ->
// "[email]", the tenant's own line (toNumber / tenantLine /
// origin.calledNumber) kept. No second definition of the masks here.
// Unit-tested in scripts/tests/events-route-mask.test.ts.

import { messageForDisplay, metadataForDisplay } from "@/lib/monitoring-label";

/** One event row with its message and metadata masked; every other field unchanged. */
export function eventRowForBrowser<E extends { message: string; metadata: unknown }>(row: E): E {
  const meta = row.metadata;
  return {
    ...row,
    message: typeof row.message === "string" ? messageForDisplay(row.message) : row.message,
    metadata:
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? metadataForDisplay(meta as Record<string, unknown>)
        : meta,
  };
}

/** Every row masked (see eventRowForBrowser). */
export const eventRowsForBrowser = <E extends { message: string; metadata: unknown }>(rows: E[]): E[] =>
  rows.map(eventRowForBrowser);
