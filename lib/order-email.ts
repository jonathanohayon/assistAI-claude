// The confirmation email of a MULTI-LINE order (P4): one row per line
// (product titles from the existing FR/HE/EN titles, lib/product-titles.ts;
// an overage line names its entry and its minutes), then the total. PURE
// (the caller passes the translator), so it is tested without sending.
// The legacy single-plan email (sendSubscriptionConfirmationEmail) is NOT
// built here and is unchanged.

import type { OrderLine } from "./order-lines";
import { entryTitle, productTitle } from "./product-titles";

export type OrderEmailInput = {
  lines: readonly OrderLine[];
  period: "monthly" | "annual";
  amount: number;
  currency: string;
  locale: "fr" | "he" | "en";
};

export type OrderEmailKey =
  | "subject"
  | "eyebrow"
  | "heading"
  | "helloNoName"
  | "intro"
  | "periodLabel"
  | "periodLabelText"
  | "periodMonthly"
  | "periodAnnual"
  | "amountLabel"
  | "amountLabelText"
  | "ctaButton"
  | "footer"
  | "signature"
  | "linesHeading"
  | "addonLine"
  | "overageLine";

export type OrderEmailT = (key: OrderEmailKey, vars?: Record<string, string | number>) => string;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An amount with its symbol: no decimals when whole, two otherwise (overage cents). */
export function formatOrderAmount(amount: number, currency: string, locale: "fr" | "he" | "en"): string {
  const whole = Math.round(amount * 100) % 100 === 0;
  const n = amount.toLocaleString(locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${n} ${currency === "ILS" ? "₪" : "€"}`;
}

export function lineLabel(line: OrderLine, locale: "fr" | "he" | "en", t: OrderEmailT): string {
  if (line.kind === "base") return productTitle(locale, line.product);
  if (line.kind === "addon") return t("addonLine", { product: productTitle(locale, line.product) });
  return t("overageLine", { product: entryTitle(locale, line.entry), minutes: line.minutes });
}

export function renderOrderConfirmationEmail(input: OrderEmailInput, t: OrderEmailT): { subject: string; text: string; html: string } {
  const { locale } = input;
  const dir = locale === "he" ? "rtl" : "ltr";
  const base = input.lines[0];
  const baseTitle = base && base.kind === "base" ? productTitle(locale, base.product) : "Tamara";
  const periodLabel = input.period === "annual" ? t("periodAnnual") : t("periodMonthly");
  const total = formatOrderAmount(input.amount, input.currency, locale);
  const rows = input.lines.map((l) => ({ label: lineLabel(l, locale, t), amount: formatOrderAmount(l.amount, input.currency, locale) }));
  const subject = t("subject", { plan: baseTitle });

  const text =
    `${t("helloNoName")}\n\n` +
    `${t("intro")}\n\n` +
    `${t("linesHeading")}\n` +
    rows.map((r) => `  • ${r.label} — ${r.amount}`).join("\n") +
    `\n\n${t("periodLabelText")} ${periodLabel}\n` +
    `${t("amountLabelText")} ${total}\n\n` +
    `https://aitamara.com/dashboard\n\n` +
    `${t("footer")}\n\n` +
    t("signature");

  const cell = "padding:9px 12px;border:1px solid #e5e7eb;border-top:0;";
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td style="${cell}background:#f9fafb;color:#374151;">${esc(r.label)}</td><td style="${cell}border-left:0;background:#fff;color:#111827;text-align:${dir === "rtl" ? "left" : "right"};white-space:nowrap;">${esc(r.amount)}</td></tr>`,
    )
    .join("");
  const html = `
    <div dir="${dir}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:0;background:#fff;">
      <div style="background:linear-gradient(135deg,#be185d 0%,#db2777 100%);padding:36px 32px;text-align:center;border-radius:16px 16px 0 0;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#fff;font-weight:600;">${t("eyebrow")}</p>
        <h1 style="margin:0;font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.01em;">Tamara</h1>
      </div>
      <div style="padding:32px;background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;">
        <h2 style="font-size:20px;margin:0 0 12px;color:#0e7490;font-weight:700;">✓ ${t("heading")}</h2>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#1f2937;">${t("helloNoName")}</p>
        <p style="font-size:14px;line-height:1.6;margin:0 0 18px;color:#475569;">${t("intro")}</p>
        <h3 style="font-size:14px;margin:0 0 8px;color:#111827;">${t("linesHeading")}</h3>
        <table cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 8px;font-size:13px;border-collapse:collapse;border-top:1px solid #e5e7eb;">
          ${rowsHtml}
          <tr><td style="${cell}background:#f9fafb;color:#6b7280;">${t("periodLabel")}</td><td style="${cell}border-left:0;background:#fff;color:#111827;text-align:${dir === "rtl" ? "left" : "right"};">${periodLabel}</td></tr>
          <tr><td style="${cell}background:#f9fafb;color:#6b7280;font-weight:600;">${t("amountLabel")}</td><td style="${cell}border-left:0;background:#fff;color:#111827;font-weight:700;text-align:${dir === "rtl" ? "left" : "right"};white-space:nowrap;">${esc(total)}</td></tr>
        </table>
        <p style="margin:24px 0 0;">
          <a href="https://aitamara.com/dashboard" style="display:inline-block;background:linear-gradient(135deg,#be185d,#db2777);color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:999px;">
            ${t("ctaButton")}
          </a>
        </p>
        <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
          ${t("footer")}
        </p>
      </div>
    </div>
  `;
  return { subject, text, html };
}
