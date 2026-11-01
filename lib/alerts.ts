// One alert to the admins when production breaks — SERVER-ONLY.
//
// The prod OpenAI key was dead for weeks (137,470 errors on 24–25/10/2026)
// and nobody knew. Alerts go by email (Resend): WhatsApp to the owner needs
// an approved template outside the 24 h window, email always delivers.
// Recipients: ADMIN_ALERT_EMAIL (comma-separated) if set, else every
// role=admin user. Dedup per key in app_settings, so a flood of identical
// errors sends ONE email per window.

import { eq } from "drizzle-orm";

import { type AlertLedger, recordAlert, shouldSendAlert } from "@/lib/alert-dedup";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendAdminAlertEmail } from "@/lib/email";
import { logEvent } from "@/lib/logger";
import { getSetting, setSetting } from "@/lib/settings";

const LEDGER_SETTING = "admin_alert_ledger";
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

async function readLedger(): Promise<AlertLedger> {
  try {
    const raw = await getSetting(LEDGER_SETTING);
    const parsed = raw ? (JSON.parse(raw) as AlertLedger) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

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
}): Promise<boolean> {
  try {
    const now = Date.now();
    const ledger = await readLedger();
    if (!shouldSendAlert(ledger, args.key, now, args.dedupMs)) return false;
    // Record BEFORE sending: two concurrent triggers then send at most twice,
    // never thousands of times.
    await setSetting(
      LEDGER_SETTING,
      JSON.stringify(recordAlert(ledger, args.key, now, LEDGER_KEEP_MS)),
    );

    const to = await recipients();
    const results = await Promise.all(
      to.map((addr) =>
        sendAdminAlertEmail(addr, { subject: args.subject, body: args.body }),
      ),
    );
    await logEvent({
      source: "web",
      event: "admin_alert_sent",
      message: `Alerte admin « ${args.subject} » → ${to.length} destinataire(s)`,
      level: "warn",
      metadata: {
        key: args.key,
        recipients: to.length,
        failed: results.filter((r) => !r.ok).length,
      },
    });
    return results.some((r) => r.ok);
  } catch (e) {
    console.error("[alerts] failed:", (e as Error).message);
    return false;
  }
}
