// Post-call owner recap by EMAIL: the pure parts (no DB, no network), so they
// are unit-tested (scripts/tests/owner-recap-email.test.ts).
//
//   - parseRecapEmail / ownerRecapEmailWrite: the save route's body → stored
//     values (validation + normalisation; an ABSENT field keeps the stored one).
//   - ownerRecapEmailTarget: who gets the email — nobody unless the switch is
//     ON *and* an address is set (default OFF).
//   - renderOwnerRecapEmail: subject / text / HTML of the email, the same
//     recap as the owner WhatsApp one, signed with the tenant's own business
//     name (lib/summarize.ts summarySignature), unsigned when it has none.
//
// Nothing here names a supplier: the email reaches the tenant.

import { ltrIsolate } from "./phone-utils";
import { signClientMessage } from "./summarize";

/** RFC 5321 caps a path at 254 characters. */
export const RECAP_EMAIL_MAX_LENGTH = 254;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RecapEmailParse = { ok: true; value: string } | { ok: false; error: string };

/**
 * The recap address as stored: trimmed + lowercased; '' (or null) = no
 * address, an intended clear. Anything else must look like an address.
 */
export function parseRecapEmail(raw: unknown): RecapEmailParse {
  if (raw == null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, error: "invalid_email" };
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: "" };
  if (value.length > RECAP_EMAIL_MAX_LENGTH || !EMAIL_RE.test(value)) {
    return { ok: false, error: "invalid_email" };
  }
  return { ok: true, value };
}

export interface OwnerRecapEmailSettings {
  ownerRecapEmail: string;
  ownerRecapEmailEnabled: boolean;
}

export type OwnerRecapEmailWrite =
  | { ok: true; updates: Partial<OwnerRecapEmailSettings> }
  | { ok: false; status: 400; body: { error: string; fields: string[] } };

/**
 * The save route's body → the columns to write. A field ABSENT from the body
 * is not written (the stored value stays); `ownerRecapEmail: ""` / `null`
 * clears the address. Nothing here is admin-only: the tenant and an admin
 * (via ?asUserId) write the same two fields.
 */
export function ownerRecapEmailWrite(body: unknown): OwnerRecapEmailWrite {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const updates: Partial<OwnerRecapEmailSettings> = {};
  if ("ownerRecapEmail" in b) {
    const parsed = parseRecapEmail(b.ownerRecapEmail);
    if (!parsed.ok) {
      return { ok: false, status: 400, body: { error: parsed.error, fields: ["ownerRecapEmail"] } };
    }
    updates.ownerRecapEmail = parsed.value;
  }
  if ("ownerRecapEmailEnabled" in b) {
    if (typeof b.ownerRecapEmailEnabled !== "boolean") {
      return { ok: false, status: 400, body: { error: "invalid_boolean", fields: ["ownerRecapEmailEnabled"] } };
    }
    updates.ownerRecapEmailEnabled = b.ownerRecapEmailEnabled;
  }
  return { ok: true, updates };
}

/** The stored settings with a write applied (what the row becomes). */
export function applyOwnerRecapEmailWrite(
  stored: OwnerRecapEmailSettings,
  updates: Partial<OwnerRecapEmailSettings>,
): OwnerRecapEmailSettings {
  return { ...stored, ...updates };
}

/** The address the recap goes to, or null: switch ON *and* an address set. */
export function ownerRecapEmailTarget(cfg: {
  ownerRecapEmail?: string | null;
  ownerRecapEmailEnabled?: boolean | null;
}): string | null {
  if (cfg.ownerRecapEmailEnabled !== true) return null;
  const address = (cfg.ownerRecapEmail ?? "").trim();
  return address ? address : null;
}

// ──────────────────────────────────────────────────────────────────────
//   Rendering
// ──────────────────────────────────────────────────────────────────────

export type RecapLocale = "fr" | "he" | "en";

/** The Email.ownerRecap strings (messages/*.json), already in the locale. */
export type RecapStrings = (key: "subject" | "eyebrow" | "heading" | "caller" | "unknownNumber" | "footer", vars?: Record<string, string>) => string;

export interface RecapInput {
  locale: RecapLocale;
  /** The owner recap from the call summary (summary.forOwner). */
  forOwner: string;
  /** The caller's number, '' when unknown. */
  fromNumber: string;
  /** The tenant's own business name (summarySignature), '' = unsigned. */
  businessName: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * The plain-text recap: heading, the owner recap, the caller, then the
 * tenant's signature (signClientMessage, as the client recap since #274).
 */
export function ownerRecapText(input: RecapInput, t: RecapStrings): string {
  const caller = input.fromNumber
    ? t("caller", { number: ltrIsolate(input.fromNumber) })
    : t("caller", { number: t("unknownNumber") });
  const body = `${t("heading")}\n\n${input.forOwner.trim()}\n\n${caller}`;
  return signClientMessage(body, input.businessName.trim());
}

export function renderOwnerRecapEmail(input: RecapInput, t: RecapStrings): RenderedEmail {
  const dir = input.locale === "he" ? "rtl" : "ltr";
  const name = input.businessName.trim();
  // The number stays left-to-right inside a Hebrew paragraph.
  const number = input.fromNumber
    ? `<span dir="ltr" style="unicode-bidi:isolate;">${escapeHtml(input.fromNumber)}</span>`
    : escapeHtml(t("unknownNumber"));
  const callerLine = escapeHtml(t("caller", { number: "\u0000" })).replace("\u0000", number);
  const html = `<div dir="${dir}" lang="${input.locale}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:0;background:#fff;text-align:${dir === "rtl" ? "right" : "left"};">
  <div style="background:linear-gradient(135deg,#be185d 0%,#db2777 100%);padding:28px 32px;border-radius:16px 16px 0 0;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.9);font-weight:600;">${escapeHtml(t("eyebrow"))}</p>
    <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">${escapeHtml(t("heading"))}</h1>
  </div>
  <div style="padding:28px 32px;background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;">
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#1f2937;white-space:pre-line;">${escapeHtml(input.forOwner.trim())}</p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#475569;">${callerLine}</p>${
      name ? `\n    <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#1f2937;font-weight:600;">— ${escapeHtml(name)}</p>` : ""
    }
    <p style="font-size:12px;line-height:1.6;margin:0;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:20px;">${escapeHtml(t("footer"))}</p>
  </div>
</div>`;
  return { subject: t("subject"), text: ownerRecapText(input, t), html };
}

/**
 * An error string safe for an event's message / metadata: no address (the
 * sender's errors may quote the recipient), clipped.
 */
export function redactEmailError(error: string): string {
  return error.replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, "[redacted]").slice(0, 200);
}
