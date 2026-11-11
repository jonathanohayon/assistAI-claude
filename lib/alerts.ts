// One alert to the admins when production breaks — SERVER-ONLY.
//
// The prod OpenAI key was dead for weeks (137,470 errors on 24–25/10/2026)
// and nobody knew. Channels: WhatsApp to the founder (approved owner
// template, so it delivers outside the 24 h window) to ADMIN_ALERT_WHATSAPP
// or the admin tenant's owner WhatsApp; plus email (Resend) when
// RESEND_API_KEY is set. Severity "warning" waits outside quiet hours
// (23:00–07:00 Israel); "critical" always goes out.
// Recipients: ADMIN_ALERT_EMAIL (comma-separated) if set, else every
// role=admin user. Dedup per key in app_settings, so a flood of identical
// errors sends ONE email per window — claimed atomically (lib/alert-ledger.ts).

import { eq } from "drizzle-orm";

import { claimAlertSlot } from "@/lib/alert-ledger";
import { db } from "@/lib/db";
import { agentConfigs, users } from "@/lib/db/schema";
import { sendAdminAlertEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { type AlertSeverity, shouldDeliver } from "@/lib/monitoring-rules";
import { sendWhatsApp } from "@/lib/whatsapp";

const LEDGER_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

async function recipients(): Promise<string[]> {
  const fromEnv = (process.env.ADMIN_ALERT_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.role, "admin"));
  return admins.map((a) => a.email);
}

/** Founder WhatsApp numbers: ADMIN_ALERT_WHATSAPP, else the admins' owner WhatsApp. */
async function whatsappRecipients(): Promise<string[]> {
  const fromEnv = (process.env.ADMIN_ALERT_WHATSAPP ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  const rows = await db
    .select({ wa: agentConfigs.ownerWhatsapp })
    .from(agentConfigs)
    .innerJoin(users, eq(users.id, agentConfigs.userId))
    .where(eq(users.role, "admin"));
  return [...new Set(rows.map((r) => r.wa.trim()).filter(Boolean))];
}

async function sendAlertWhatsApp(to: string, text: string): Promise<boolean> {
  // The owner template ({{1}} = free text) delivers outside the 24 h window.
  const template =
    process.env.WHATSAPP_OWNER_TEMPLATE_SID_FR || process.env.WHATSAPP_OWNER_TEMPLATE_SID || undefined;
  const r = await sendWhatsApp({
    to,
    body: text,
    templateSid: template,
    ...(template ? { templateVariables: { "1": text.slice(0, 1000) } } : {}),
    ownerTemplateFallback: true,
  });
  return r.ok;
}

/** The side effects of alertAdmins, injectable so tests never send for real. */
export type AlertDeps = {
  emailRecipients: () => Promise<string[]>;
  whatsappRecipients: () => Promise<string[]>;
  sendEmail: (to: string, msg: { subject: string; body: string }) => Promise<{ ok: boolean }>;
  sendWhatsApp: (to: string, text: string) => Promise<boolean>;
  /** Clock override for tests; default Date.now. */
  now?: () => number;
};

const defaultDeps: AlertDeps = {
  emailRecipients: recipients,
  whatsappRecipients,
  sendEmail: sendAdminAlertEmail,
  sendWhatsApp: sendAlertWhatsApp,
};

/**
 * Sends one alert for `key` unless one went out within `dedupMs`.
 * Never throws: alerting must not break the request that triggered it.
 * Returns true when an email was sent.
 */
export async function alertAdmins(args: {
  key: string;
  subject: string;
  body: string;
  dedupMs: number;
  /** Default "critical" (always sent). "warning" waits outside quiet hours. */
  severity?: AlertSeverity;
}, deps: AlertDeps = defaultDeps): Promise<boolean> {
  try {
    const now = deps.now ? deps.now() : Date.now();
    // Not recorded during quiet hours: a PERIODIC check (cron) re-detects and
    // sends it after 07:00; a one-off event warning raised at night is dropped.
    if (!shouldDeliver(args.severity ?? "critical", new Date(now))) return false;
    // Atomic check-and-record, BEFORE sending (lib/alert-ledger.ts): of any
    // number of concurrent triggers for one key, exactly one gets the slot.
    if (!(await claimAlertSlot(args.key, now, args.dedupMs, LEDGER_KEEP_MS))) return false;

    const to = await deps.emailRecipients();
    const results = await Promise.all(
      to.map((addr) =>
        deps.sendEmail(addr, { subject: args.subject, body: args.body }),
      ),
    );
    const waTo = await deps.whatsappRecipients();
    const waText = `⚠️ ${args.subject}\n\n${args.body}`;
    const waResults = await Promise.all(waTo.map((n) => deps.sendWhatsApp(n, waText).catch(() => false)));
    await logEvent({
      source: "web",
      event: "admin_alert_sent",
      message: `Alerte admin « ${args.subject} » → ${to.length} destinataire(s)`,
      level: "warn",
      metadata: {
        key: args.key,
        severity: args.severity ?? "critical",
        recipients: to.length,
        failed: results.filter((r) => !r.ok).length,
        whatsappRecipients: waTo.length,
        whatsappFailed: waResults.filter((ok) => !ok).length,
      },
    });
    return results.some((r) => r.ok) || waResults.some(Boolean);
  } catch (e) {
    console.error("[alerts] failed:", (e as Error).message);
    return false;
  }
}
