// Client WhatsApp confirm after a call — the decision and the send, with every
// side effect injected (lib/client-confirm/deps.ts wires the real ones).
//
// Order: proven event? → one per destination per call → at most
// CLIENT_CONFIRM_PER_NUMBER per number per 24 h (+ a global ceiling) → send.
// Any "no" skips silently for the caller and logs a counts-only event. No
// event or log written here carries the destination number or the text.

import type { JoinCall, JoinEvent } from "@/lib/calls/core";
import {
  appointmentFromEvent,
  callDestinationKey,
  CLIENT_CONFIRM_BUCKET,
  CLIENT_CONFIRM_CALL_BUCKET,
  CLIENT_CONFIRM_DAILY_CEILING,
  CLIENT_CONFIRM_PER_NUMBER,
  CLIENT_CONFIRM_WINDOW_MS,
  clientConfirmText,
  destinationKey,
  lastProvenEvent,
  redactNumbers,
  type ConfirmKind,
} from "@/lib/client-confirm/core";
import type { LogEvent } from "@/lib/logger";
import type { RateLimitResult } from "@/lib/rate-limit-db-core";
import type { WhatsAppOptions, WhatsAppResult } from "@/lib/whatsapp";

export interface ClientConfirmDeps {
  /** The call's tool events (lib/calls/query.ts loadEventsFor). */
  loadToolEvents: (userId: string, call: JoinCall) => Promise<JoinEvent[]>;
  /** The tenant's last book/reschedule event of a calendar event id (for a cancel's date). */
  lastEventOfAppointment: (userId: string, eventId: string, before: Date) => Promise<JoinEvent | null>;
  consumeRateLimit: (opts: {
    bucket: string;
    accountId: string;
    windowMs: number;
    perAccount: number;
    global: number;
  }) => Promise<RateLimitResult>;
  sendWhatsApp: (opts: WhatsAppOptions) => Promise<WhatsAppResult>;
  logEvent: (e: LogEvent) => Promise<unknown>;
  normalizeE164: (n: string) => string;
}

export interface ClientConfirmInput {
  userId: string;
  call: JoinCall;
  /** Caller number ('' on the web live test → nothing). */
  fromNumber: string;
  /** Plan feature whatsapp_confirm (false → nothing). */
  enabled: boolean;
  channel: string | null | undefined;
  lang: string | null | undefined;
  /** summarySignature(cfg.business). */
  signature: string;
  /** The tenant's aitamara number for the "call us" line. */
  callNumber: () => Promise<string | null>;
  /** Per-language approved client template SID (undefined on the WhatsApp channel). */
  templateSid: string | undefined;
}

export type ClientConfirmOutcome =
  | { sent: true; sid: string; kind: ConfirmKind }
  | { sent: false; reason: "not_applicable" | "no_proven_event" | "duplicate" | "rate_limited" | "limiter_error" | "send_failed"; error?: string };

export async function sendClientConfirm(input: ClientConfirmInput, deps: ClientConfirmDeps): Promise<ClientConfirmOutcome> {
  if (!input.fromNumber || !input.enabled) return { sent: false, reason: "not_applicable" };
  const { userId, call } = input;
  const skip = async (
    reason: "no_proven_event" | "duplicate" | "rate_limited" | "limiter_error",
    extra: Record<string, unknown> = {},
  ): Promise<ClientConfirmOutcome> => {
    await deps.logEvent({
      source: "whatsapp",
      event: "whatsapp_skipped_client",
      message: `Client WhatsApp confirm skipped (${reason})`,
      level: reason === "limiter_error" ? "error" : "info",
      userId,
      metadata: { callId: call.id, reason, ...extra },
    });
    return { sent: false, reason };
  };

  const events = await deps.loadToolEvents(userId, call);
  const proven = lastProvenEvent(events);
  if (!proven) return skip("no_proven_event", { toolEvents: events.length });
  if (proven.kind === "cancelled" && proven.eventId) {
    const appt = appointmentFromEvent(await deps.lastEventOfAppointment(userId, proven.eventId, call.createdAt));
    if (appt) Object.assign(proven, appt);
  }

  const e164 = deps.normalizeE164(input.fromNumber);
  const window = { windowMs: CLIENT_CONFIRM_WINDOW_MS, global: CLIENT_CONFIRM_DAILY_CEILING };
  try {
    const perCall = await deps.consumeRateLimit({
      bucket: CLIENT_CONFIRM_CALL_BUCKET,
      accountId: callDestinationKey(call.callId || call.id, e164),
      perAccount: 1,
      ...window,
    });
    if (!perCall.ok) return perCall.scope === "account" ? skip("duplicate") : skip("rate_limited", { scope: "global" });
    const perNumber = await deps.consumeRateLimit({
      bucket: CLIENT_CONFIRM_BUCKET,
      accountId: destinationKey(e164),
      perAccount: CLIENT_CONFIRM_PER_NUMBER,
      ...window,
    });
    if (!perNumber.ok) return skip("rate_limited", { scope: perNumber.scope });
  } catch {
    // Fail closed: no limiter, no message.
    return skip("limiter_error");
  }

  const text = clientConfirmText(proven, {
    lang: input.lang,
    signature: input.signature,
    callNumber: await input.callNumber(),
  });
  const templateSid = input.templateSid || undefined;
  const r = await deps.sendWhatsApp({
    to: input.fromNumber,
    body: text,
    templateSid,
    templateVariables: templateSid ? { "1": text } : undefined,
  });
  const mode = templateSid ? "template" : "free_form";
  if (r.ok && r.sid) {
    await deps.logEvent({
      source: "whatsapp",
      event: "whatsapp_sent_client",
      message: `Client WhatsApp confirm sent (${proven.kind}, ${mode})`,
      userId,
      metadata: { callId: call.id, sid: r.sid, channel: input.channel ?? null, mode, kind: proven.kind },
    });
    return { sent: true, sid: r.sid, kind: proven.kind };
  }
  const error = redactNumbers(r.error).slice(0, 200);
  await deps.logEvent({
    source: "whatsapp",
    event: "whatsapp_failed_client",
    message: `Client WhatsApp confirm failed: ${error}`,
    level: "error",
    userId,
    metadata: { callId: call.id, kind: proven.kind, mode, error },
  });
  return { sent: false, reason: "send_failed", error };
}
