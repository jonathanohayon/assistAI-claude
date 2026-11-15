// Monitoring (dashboard/logs) labels and the event detail as shown on screen.
// CLIENT-SAFE (no I/O). Unit-tested in scripts/tests/monitoring-sip-label.test.ts.
//
// Since #332 the call_received event carries { callId, toNumber, fromHash,
// fromLast4, transcriptEntries }: the caller's number is never stored. Events
// stored before still carry `fromNumber` in clear and may hold numbers or
// email addresses in their message; the screen applies the storage masks to
// them, so no full caller number reappears from old data. `fromHash` (and any
// other `<key>Hash`) is a correlation key, never displayed.

import { formatPhone } from "@/lib/format-phone";
import { KEPT_KEY_PATHS, last4, maskPii, PHONE_RE } from "@/lib/pii-mask";

/** A SIP call's header: the caller's last 4 digits (null = unknown) and the dialled line, formatted. */
export interface SipLabel {
  last4: string | null;
  to: string;
}

type Meta = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The caller's last 4 digits: `fromLast4`, else the last 4 of a legacy `fromNumber`, else null. */
export function callerLast4(meta: Meta): string | null {
  const l4 = str(meta["fromLast4"]);
  if (/^\d{4}$/.test(l4)) return l4;
  const legacy = last4(str(meta["fromNumber"]));
  return legacy || null;
}

/** The SIP label from a call_received event, or null when it has no dialled line (web session). */
export function sipLabelFromReceived(meta: Meta): SipLabel | null {
  const to = str(meta["toNumber"]);
  if (!to) return null;
  return { last4: callerLast4(meta), to: formatPhone(to) };
}

/** The SIP label from a call_started event (caller not known yet), or null without a dialled line. */
export function sipLabelFromStarted(meta: Meta): SipLabel | null {
  const origin = meta["origin"] as { calledNumber?: unknown } | undefined;
  const to = str(origin?.calledNumber);
  return to ? { last4: null, to: formatPhone(to) } : null;
}

const isWholePhone = (v: string) => new RegExp(`^${PHONE_RE.source}$`).test(v.trim());

/**
 * Event metadata as Monitoring may print it: `<key>Hash` keys dropped, any
 * phone number outside the tenant's own line masked to "…1234", emails and
 * numbers inside free text masked. Idempotent on already-scrubbed metadata.
 */
export function metadataForDisplay(meta: Meta, path = ""): Meta {
  const out: Meta = {};
  for (const [key, value] of Object.entries(meta)) {
    const p = path ? `${path}.${key}` : key;
    if (KEPT_KEY_PATHS.includes(p)) {
      out[key] = value;
      continue;
    }
    if (/Hash$/.test(key)) continue;
    out[key] = valueForDisplay(value, p);
  }
  return out;
}

function valueForDisplay(value: unknown, path: string): unknown {
  if (typeof value === "string") {
    if (isWholePhone(value)) return last4(value) ? `…${last4(value)}` : "[phone]";
    return maskPii(value);
  }
  if (Array.isArray(value)) return value.map((v) => valueForDisplay(v, path));
  if (value && typeof value === "object") return metadataForDisplay(value as Meta, path);
  return value;
}

/** An event message as Monitoring may print it (old messages may hold numbers / emails). */
export const messageForDisplay = (message: string) => maskPii(message);
