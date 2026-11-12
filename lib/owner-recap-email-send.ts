// Post-call owner recap by EMAIL, called by /api/calls/end next to the owner
// WhatsApp recap. Best-effort: it never throws and never changes the route's
// response; a failure is logged as an event WITHOUT the recipient address or
// the recap body in it.
//
// The sender and the logger are injectable (`ownerRecapEmailDeps`), so tests
// count the sends without ever reaching an email provider.

import { and, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { sendOwnerRecapEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { ownerRecapEmailTarget, redactEmailError } from "@/lib/owner-recap-email";
import { summarySignature } from "@/lib/summarize";

/** Same window as the owner WhatsApp recap's dedup. */
export const OWNER_RECAP_EMAIL_DEDUP_MS = 5 * 60 * 1000;

async function recentOwnerRecapEmailSent(userId: string, since: Date): Promise<boolean> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.source, "email"),
        eq(events.event, "email_sent_owner"),
        gt(events.createdAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export const ownerRecapEmailDeps = {
  send: sendOwnerRecapEmail,
  log: logEvent,
  recentSent: recentOwnerRecapEmailSent,
  now: () => Date.now(),
};

export interface OwnerRecapEmailInput {
  userId: string;
  /** calls row id, for the events. */
  callId: string;
  cfg: {
    ownerRecapEmail?: string | null;
    ownerRecapEmailEnabled?: boolean | null;
    primaryLanguage?: string | null;
    business?: unknown;
  };
  forOwner: string;
  fromNumber: string;
  /** The plan's owner recap feature (whatsapp_recap) is on. */
  recapFeatureOn: boolean;
  /** Transcript entries: ≤ 1 (greeting only) is never recapped, as WhatsApp. */
  transcriptEntries: number;
}

export type OwnerRecapEmailOutcome =
  | "off"
  | "feature_off"
  | "transcript_too_short"
  | "dedup_recent_owner_email"
  | "sent"
  | "failed";

/**
 * Sends the recap when the owner switched it on AND set an address, under the
 * owner WhatsApp recap's conditions. Resolves to what happened; never rejects.
 */
export async function sendOwnerRecapEmailBestEffort(input: OwnerRecapEmailInput): Promise<OwnerRecapEmailOutcome> {
  const to = ownerRecapEmailTarget(input.cfg);
  // Default OFF: no address or switch off → nothing at all, not even a query.
  if (!to) return "off";
  try {
    if (!input.recapFeatureOn) return "feature_off";
    if (input.transcriptEntries <= 1) return "transcript_too_short";
    const since = new Date(ownerRecapEmailDeps.now() - OWNER_RECAP_EMAIL_DEDUP_MS);
    if (await ownerRecapEmailDeps.recentSent(input.userId, since)) {
      await ownerRecapEmailDeps.log({
        source: "email",
        event: "email_skipped_owner_dedup",
        message: "Owner recap email skipped (one sent in the last 5 minutes)",
        userId: input.userId,
        metadata: { callId: input.callId, reason: "dedup_recent_owner_email" },
      });
      return "dedup_recent_owner_email";
    }
    const r = await ownerRecapEmailDeps.send(to, {
      forOwner: input.forOwner,
      fromNumber: input.fromNumber,
      businessName: summarySignature(input.cfg.business),
      locale: input.cfg.primaryLanguage ?? "fr",
    });
    if (r.ok) {
      await ownerRecapEmailDeps.log({
        source: "email",
        event: "email_sent_owner",
        message: "Owner recap email sent",
        userId: input.userId,
        metadata: { callId: input.callId, ...(r.id ? { id: r.id } : {}), ...(r.fallback ? { fallback: r.fallback } : {}) },
      });
      return "sent";
    }
    await logFailure(input, r.error ?? "unknown error");
    return "failed";
  } catch (e) {
    await logFailure(input, e instanceof Error ? e.message : "unknown error");
    return "failed";
  }
}

async function logFailure(input: OwnerRecapEmailInput, error: string): Promise<void> {
  const safe = redactEmailError(error);
  try {
    await ownerRecapEmailDeps.log({
      source: "email",
      event: "email_failed_owner",
      message: `Owner recap email failed: ${safe}`,
      level: "error",
      userId: input.userId,
      metadata: { callId: input.callId, error: safe },
    });
  } catch {
    // Logging must never break the call-end route either.
  }
}
