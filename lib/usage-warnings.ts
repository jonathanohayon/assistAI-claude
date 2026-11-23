// Usage warning emails at 80% and 100% of an entry's included minutes (P2).
// PURE parts + the runner with every effect INJECTED (no lib/db here: the
// real deps are lib/usage-warnings-deps.ts), so the thresholds, the dedupe,
// the flag and the copy are tested without a database or an email provider.
//
// Rules:
//   - behind USAGE_WARNINGS_ENABLED ("1" / "true"), OFF by default: off, the
//     runner returns before reading anything;
//   - ONLY accounts with a VALID users.products record (entitlement source
//     "products"). Grandfathered accounts (no record, an invalid one) never
//     get one, whatever their usage: enforced here AND in the selection
//     query (lib/usage-warnings-deps.ts), not only by the flag;
//   - paid accounts only: subscription_status "active" with a paid_until
//     (a fixed period; trials have their own cap);
//   - per owned entry with included minutes > 0, on the exact seconds:
//     >= 80% crosses 80, >= 100% crosses 100;
//   - once per account × entry × threshold × period (usage_warnings row,
//     claimed BEFORE sending; a lost claim = another run sends it). When one
//     run crosses both (e.g. 150% on the first tick), both are claimed and
//     ONE email is sent, for 100;
//   - no address in events or logs (the event carries entry / threshold /
//     period only).

import type { LogEvent } from "./logger";
import { entitledProducts, type EntitlementInput } from "./product-entitlement";
import type { ProductEntry } from "./product-values";
import type { UsageByProduct } from "./usage-by-product";

export const USAGE_THRESHOLDS = [80, 100] as const;
export type UsageThreshold = (typeof USAGE_THRESHOLDS)[number];

type Env = Record<string, string | undefined>;

export function usageWarningsEnabled(env: Env = process.env): boolean {
  const v = (env.USAGE_WARNINGS_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** The thresholds crossed by `usedSeconds` out of `includedMinutes` (none when 0 included). */
export function thresholdsCrossed(usedSeconds: number, includedMinutes: number): UsageThreshold[] {
  if (!(includedMinutes > 0)) return [];
  const included = includedMinutes * 60;
  return USAGE_THRESHOLDS.filter((t) => usedSeconds * 100 >= included * t);
}

/** Whether an account may EVER receive a usage warning: a valid products record, paid. */
export function warnableAccount(u: EntitlementInput & { paidUntil: Date | null }): boolean {
  return u.subscriptionStatus === "active" && u.paidUntil !== null && entitledProducts(u).source === "products";
}

// ──────────────────────────────────────────────────────────────────────
//   Copy (messages/*.json → Email.usageWarning)
// ──────────────────────────────────────────────────────────────────────

export type WarningLocale = "fr" | "he" | "en";
export type WarningKey =
  | "subject80"
  | "subject100"
  | "heading80"
  | "heading100"
  | "body"
  | "overage"
  | "cta"
  | "footer"
  | "entryReception";
export type WarningStrings = (key: WarningKey, vars?: Record<string, string>) => string;

export function warningLocale(raw: string | null | undefined): WarningLocale {
  const short = (raw ?? "").toLowerCase().split("-")[0];
  return short === "he" || short === "en" ? short : "fr";
}

export type WarningInput = {
  locale: WarningLocale;
  entry: ProductEntry;
  threshold: UsageThreshold;
  usedMinutes: number;
  includedMinutes: number;
  /** Per minute beyond the included ones, already formatted with its currency. */
  overageRate: string;
};

/** The products the email names by their ONE name key (DashboardNav.<entry>). */
export type NavNamedEntry = "sales" | "connect";
export type NavProductNames = Record<NavNamedEntry, string>;

const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export const BILLING_URL = "https://aitamara.com/dashboard/billing";

/**
 * `navNames`: the sales and connect products' names, read from the ONE key
 * that names each of them everywhere (DashboardNav.sales, "Centre d'appels";
 * DashboardNav.connect, "Connecter votre agent"). The email keeps no copy of
 * its own. Reception keeps its own wording ("Réceptionniste").
 */
export function renderUsageWarningEmail(
  input: WarningInput,
  t: WarningStrings,
  navNames: NavProductNames,
): { subject: string; text: string; html: string } {
  const product = input.entry === "reception" ? t("entryReception") : navNames[input.entry];
  const vars = { product, used: String(input.usedMinutes), included: String(input.includedMinutes), rate: input.overageRate };
  const subject = t(input.threshold === 100 ? "subject100" : "subject80", vars);
  const heading = t(input.threshold === 100 ? "heading100" : "heading80", vars);
  const body = t("body", vars);
  const overage = t("overage", vars);
  const text = `${heading}\n\n${body}\n${overage}\n\n${t("cta")}: ${BILLING_URL}\n\n${t("footer")}`;
  const dir = input.locale === "he" ? "rtl" : "ltr";
  const html = `<div dir="${dir}" lang="${input.locale}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a1a;text-align:${dir === "rtl" ? "right" : "left"};">
  <h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(heading)}</h1>
  <p style="font-size:14px;line-height:1.6;margin:0 0 12px;color:#374151;">${escapeHtml(body)}</p>
  <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#374151;">${escapeHtml(overage)}</p>
  <p style="margin:0 0 24px;"><a href="${BILLING_URL}" style="display:inline-block;background:#be185d;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:999px;">${escapeHtml(t("cta"))}</a></p>
  <p style="font-size:12px;line-height:1.6;margin:0;color:#6b7280;">${escapeHtml(t("footer"))}</p>
</div>`;
  return { subject, text, html };
}

/** "1.5 ₪" / "0.39 €": the rate with its currency sign. */
export function formatRate(rate: number, currency: "EUR" | "ILS"): string {
  return `${rate} ${currency === "ILS" ? "₪" : "€"}`;
}

// ──────────────────────────────────────────────────────────────────────
//   Runner
// ──────────────────────────────────────────────────────────────────────

export type WarnAccount = EntitlementInput & {
  id: string;
  email: string;
  locale: string | null;
  paidUntil: Date | null;
};

export type UsageWarningDeps = {
  env: Env;
  now: () => Date;
  /** Candidate accounts (the query already keeps active + paid_until + a record). */
  listAccounts: () => Promise<WarnAccount[]>;
  /** The account's current period and its per-product usage. */
  usageFor: (a: WarnAccount, now: Date) => Promise<{ periodStart: Date; usage: UsageByProduct }>;
  /** true = this run owns the claim (row inserted); false = already claimed. */
  claim: (c: { userId: string; entry: ProductEntry; threshold: UsageThreshold; periodStart: Date }) => Promise<boolean>;
  send: (to: string, input: WarningInput) => Promise<{ ok: boolean; error?: string }>;
  logEvent: (e: LogEvent) => Promise<unknown>;
};

export type UsageWarningsResult = { enabled: boolean; accounts: number; claimed: number; sent: number; failed: number };

export async function runUsageWarnings(deps: UsageWarningDeps): Promise<UsageWarningsResult> {
  const out: UsageWarningsResult = { enabled: false, accounts: 0, claimed: 0, sent: 0, failed: 0 };
  if (!usageWarningsEnabled(deps.env)) return out;
  out.enabled = true;
  const now = deps.now();
  for (const a of await deps.listAccounts()) {
    // Second lock: whatever the query returned, a grandfathered account
    // (no record, an invalid one), a trial or an unpaid account never gets one.
    if (!warnableAccount(a)) continue;
    out.accounts++;
    const { periodStart, usage } = await deps.usageFor(a, now);
    if (usage.kind !== "products") continue;
    for (const e of usage.entries) {
      if (!e.owned) continue;
      const crossed = thresholdsCrossed(e.usedSeconds, e.includedMinutes);
      const won: UsageThreshold[] = [];
      for (const threshold of crossed) {
        if (await deps.claim({ userId: a.id, entry: e.entry, threshold, periodStart })) won.push(threshold);
      }
      out.claimed += won.length;
      if (won.length === 0) continue;
      const threshold = won[won.length - 1];
      const r = await deps.send(a.email, {
        locale: warningLocale(a.locale),
        entry: e.entry,
        threshold,
        usedMinutes: e.usedMinutes,
        includedMinutes: e.includedMinutes,
        overageRate: formatRate(e.overageRate, usage.currency),
      });
      if (r.ok) out.sent++;
      else out.failed++;
      // No address, no provider error text (it can quote the address).
      await deps.logEvent({
        source: "email",
        event: r.ok ? "usage_warning_sent" : "usage_warning_failed",
        message: `Usage warning ${threshold}% (${e.entry}) ${r.ok ? "sent" : "not sent"}`,
        level: r.ok ? "info" : "warn",
        userId: a.id,
        metadata: { entry: e.entry, threshold, periodStart: periodStart.toISOString(), claimed: won },
      });
    }
  }
  return out;
}
