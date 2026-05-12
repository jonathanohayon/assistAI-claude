// Envoi d'emails transactionnels via Resend, traduits FR/HE/EN.
//
// Config Railway :
//   RESEND_API_KEY  — clé API Resend (gratuit jusqu'à 3000 emails/mois)
//   EMAIL_FROM      — adresse d'expédition, ex "Tamara <noreply@aitamara.com>"
//                     Doit être un domaine vérifié dans Resend, sauf si on
//                     reste sur "onboarding@resend.dev" (sandbox limité à
//                     l'adresse propriétaire du compte Resend).
//
// Sans clé : on log le contenu de l'email dans la console (dev/test fallback)
// pour que le code de verification reste utilisable même sans setup complet.
// → NE PAS laisser cette fallback en prod sans clé : le user ne recevra
// jamais son code et sera bloqué au signup.
//
// Locale : chaque fonction prend une locale ('fr'|'he'|'en') et charge les
// strings via next-intl getTranslations namespace "Email.*". Pour les emails
// Hebrew, le HTML wrap inclut dir="rtl" pour aligner correctement.

import { getTranslations } from "next-intl/server";
import { Resend } from "resend";

import type { PlanFeatures } from "@/lib/plan-features";
import { getLocalizedPlan } from "@/lib/plan-i18n";

const FROM_DEFAULT = "Tamara <onboarding@resend.dev>";
const SUPPORTED_LOCALES = ["fr", "he", "en"] as const;
type EmailLocale = (typeof SUPPORTED_LOCALES)[number];

// Normalise une locale arbitraire en EmailLocale supportée (fallback fr).
// Cas d'usage : la valeur vient de users.locale (text) qui pourrait être
// "fr-FR", null, "de" (pas supporté), etc.
const normalizeLocale = (raw: string | null | undefined): EmailLocale => {
  if (!raw) return "fr";
  const short = raw.toLowerCase().split("-")[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(short)
    ? (short as EmailLocale)
    : "fr";
};

const dirFor = (locale: EmailLocale): "rtl" | "ltr" =>
  locale === "he" ? "rtl" : "ltr";

const dateLocaleFor = (locale: EmailLocale): string =>
  locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";

let resendClient: Resend | null = null;
const getResend = (): Resend | null => {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
};

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  fallback?: "console_log";
}

// ──────────────────────────────────────────────────────────────────────
//   Verification code (4 digits)
// ──────────────────────────────────────────────────────────────────────
export async function sendVerificationEmail(
  to: string,
  code: string,
  rawLocale?: string | null,
): Promise<SendResult> {
  const locale = normalizeLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: "Email.verification" });
  const client = getResend();
  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;
  const subject = t("subject", { code });

  if (!client) {
    console.warn(
      `\n=================== EMAIL FALLBACK (no RESEND_API_KEY) ===================` +
        `\nTo:   ${to}` +
        `\nFrom: ${from}` +
        `\nCode: ${code}` +
        `\nSubject: ${subject}` +
        `\n==========================================================================\n`,
    );
    return { ok: true, fallback: "console_log" };
  }

  const text =
    `${t("textIntro")}\n\n` +
    `${t("textCodeBlock")}\n\n` +
    `   ${code}\n\n` +
    `${t("expiresLine")}\n\n` +
    `${t("ignoreLine")}\n\n` +
    t("signature");
  const html = `
    <div dir="${dirFor(locale)}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
      <h1 style="font-size:22px;margin:0 0 16px;">${t("heading")}</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 24px;color:#555;">
        ${t("intro")}
      </p>
      <div style="font-family:'SF Mono',Menlo,Monaco,monospace;font-size:42px;letter-spacing:0.4em;font-weight:600;text-align:center;background:linear-gradient(135deg,#fef3c7,#fce7f3);padding:20px 24px;border-radius:14px;color:#831843;">
        ${code}
      </div>
      <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#888;">
        ${t("expiresLine")}<br/>
        ${t("ignoreLine")}
      </p>
    </div>
  `;

  try {
    const res = await client.emails.send({
      from,
      to: [to],
      subject,
      text,
      html,
    });
    if (res.error) {
      return { ok: false, error: `${res.error.name}: ${res.error.message}` };
    }
    return { ok: true, id: res.data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resend error" };
  }
}

// ──────────────────────────────────────────────────────────────────────
//   Trial warning (H-2 avant expiration)
// ──────────────────────────────────────────────────────────────────────
export async function sendTrialWarningEmail(
  to: string,
  opts: { phoneNumber?: string | null; minutesLeft: number; locale?: string | null },
): Promise<SendResult> {
  const locale = normalizeLocale(opts.locale);
  const t = await getTranslations({ locale, namespace: "Email.trialWarning" });
  const client = getResend();
  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;
  const minutes = Math.max(1, opts.minutesLeft);
  const subject =
    minutes < 120
      ? t("subjectMinutes", { minutes })
      : t("subjectHours");

  const phoneLineText = opts.phoneNumber
    ? t("phoneLineWithPhone", { phone: opts.phoneNumber })
    : t("phoneLineGeneric");
  const phoneSpecificHtml = opts.phoneNumber
    ? t("phoneSpecific", { phone: opts.phoneNumber })
    : t("phoneGeneric");

  if (!client) {
    console.warn(
      `\n=================== TRIAL WARNING EMAIL FALLBACK (no RESEND_API_KEY) ===================` +
        `\nTo:   ${to}` +
        `\nFrom: ${from}` +
        `\nMin:  ${minutes}` +
        `\n========================================================================================\n`,
    );
    return { ok: true, fallback: "console_log" };
  }

  const text =
    `${t("introText")}\n\n` +
    `${t("textBullet")}\n` +
    `  • ${t("actionLineText")}\n` +
    `  • ${phoneLineText}\n\n` +
    `https://aitamara.com/dashboard/billing\n\n` +
    `${t("footerText")}\n\n` +
    t("signature");

  const html = `
    <div dir="${dirFor(locale)}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
      <h1 style="font-size:22px;margin:0 0 12px;">${t("heading")}</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#555;">
        ${t("introHtml")}
      </p>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 18px;font-size:13px;line-height:1.6;color:#9a3412;margin:0 0 20px;">
        ${t("warningBoxHtml", { phoneLine: phoneSpecificHtml })}
      </div>
      <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#555;">
        ${t("actionLineHtml")}
      </p>
      <p style="margin:0 0 24px;">
        <a href="https://aitamara.com/dashboard/billing" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:999px;">
          ${t("ctaButton")}
        </a>
      </p>
      <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#888;">
        ${t("footerHtml")}
      </p>
    </div>
  `;

  try {
    const res = await client.emails.send({ from, to: [to], subject, text, html });
    if (res.error) {
      return { ok: false, error: `${res.error.name}: ${res.error.message}` };
    }
    return { ok: true, id: res.data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resend error" };
  }
}

// ──────────────────────────────────────────────────────────────────────
//   Trial deleted (post-cleanup)
// ──────────────────────────────────────────────────────────────────────
export async function sendTrialDeletedEmail(
  to: string,
  opts: { phoneNumber?: string | null; locale?: string | null },
): Promise<SendResult> {
  const locale = normalizeLocale(opts.locale);
  const t = await getTranslations({ locale, namespace: "Email.trialDeleted" });
  const client = getResend();
  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;
  const subject = t("subject");
  const phoneLine = opts.phoneNumber
    ? t("phoneLineWithPhone", { phone: opts.phoneNumber })
    : t("phoneLineGeneric");

  if (!client) {
    console.warn(
      `\n=================== TRIAL DELETED EMAIL FALLBACK (no RESEND_API_KEY) ===================` +
        `\nTo:   ${to}` +
        `\nFrom: ${from}` +
        `\n========================================================================================\n`,
    );
    return { ok: true, fallback: "console_log" };
  }

  const text =
    `${t("introText")}\n\n` +
    `${phoneLine}\n\n` +
    `${t("actionLine")}\n` +
    `https://aitamara.com/signup\n\n` +
    `${t("footer")}\n\n` +
    t("signature");
  const html = `
    <div dir="${dirFor(locale)}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
      <h1 style="font-size:22px;margin:0 0 12px;">${t("heading")}</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#555;">
        ${t("introHtml")}
      </p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 18px;font-size:13px;line-height:1.6;color:#4b5563;margin:0 0 20px;">
        ${phoneLine}
      </div>
      <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#555;">
        ${t("actionLine")}
      </p>
      <p style="margin:0 0 24px;">
        <a href="https://aitamara.com/signup" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:999px;">
          ${t("ctaButton")}
        </a>
      </p>
      <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#888;">
        ${t("footer")}
      </p>
    </div>
  `;

  try {
    const res = await client.emails.send({ from, to: [to], subject, text, html });
    if (res.error) {
      return { ok: false, error: `${res.error.name}: ${res.error.message}` };
    }
    return { ok: true, id: res.data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resend error" };
  }
}

// ──────────────────────────────────────────────────────────────────────
//   Welcome (post-provision Twilio)
// ──────────────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(
  to: string,
  opts: {
    displayName?: string | null;
    phoneNumber: string;
    planKey: string;
    features: PlanFeatures;
    trialEndsAt?: Date | null;
    /** Locale du destinataire — fallback fr si absent. */
    locale?: string | null;
  },
): Promise<SendResult> {
  const locale = normalizeLocale(opts.locale);
  const t = await getTranslations({ locale, namespace: "Email.welcome" });
  const client = getResend();
  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;

  const plan = getLocalizedPlan(locale, opts.planKey);
  const planLabel = plan.name;
  const firstName =
    (opts.displayName ?? "").trim().split(/\s+/)[0] || null;
  const helloHtml = firstName
    ? t("introHtmlWithName", { name: firstName })
    : t("introHtmlNoName");
  const helloText = firstName
    ? t("introTextWithName", { name: firstName })
    : t("introTextNoName");

  const trialLine = opts.trialEndsAt
    ? t("trialLineWithDate", {
        date: opts.trialEndsAt.toLocaleString(dateLocaleFor(locale), {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Paris",
        }),
      })
    : t("trialLineActive");

  // Reco conditionnelles : on n'affiche que ce qui matche le plan + la
  // matrice features. Si l'admin a coupé calendar pour ce plan, on n'en
  // parle pas (l'agent ne peut pas réserver de toute façon).
  const recos: Array<{ title: string; body: string; href?: string }> = [];

  recos.push({
    title: t("reco1Title"),
    body: t("reco1Body", { phone: opts.phoneNumber }),
  });

  let n = 2;
  if (opts.features.calendar) {
    recos.push({
      title: t("recoCalendarTitle", { n: n++ }),
      body: t("recoCalendarBody"),
      href: "https://aitamara.com/dashboard",
    });
  }
  if (opts.features.crm) {
    recos.push({
      title: t("recoCrmTitle", { n: n++ }),
      body: t("recoCrmBody"),
    });
  }
  if (opts.features.whatsapp_recap) {
    recos.push({
      title: t("recoWhatsappTitle", { n: n++ }),
      body: t("recoWhatsappBody"),
      href: "https://aitamara.com/dashboard",
    });
  }
  recos.push({
    title: t("recoPersonaTitle", { n: n++ }),
    body: t("recoPersonaBody"),
    href: "https://aitamara.com/dashboard",
  });

  const subject = t("subject", { phone: opts.phoneNumber });
  const text =
    `${helloText}\n\n` +
    `${t("introTextBody")}\n\n` +
    `   ${opts.phoneNumber}\n\n` +
    `${t("activePlanTextLabel")} ${planLabel}\n` +
    `${trialLine}\n\n` +
    `${t("todoHeadingText")}\n\n` +
    recos
      .map((r) => `${r.title}\n${r.body}${r.href ? `\n→ ${r.href}` : ""}`)
      .join("\n\n") +
    `\n\n${t("footerText")}\n\n${t("signature")}`;

  if (!client) {
    console.warn(
      `\n=================== WELCOME EMAIL FALLBACK (no RESEND_API_KEY) ===================` +
        `\nTo:    ${to}` +
        `\nFrom:  ${from}` +
        `\nPhone: ${opts.phoneNumber}` +
        `\nPlan:  ${planLabel}` +
        `\n==================================================================================\n`,
    );
    return { ok: true, fallback: "console_log" };
  }

  const recoHtml = recos
    .map(
      (r) => `
        <div style="margin:0 0 18px;">
          <div style="font-weight:600;font-size:14px;color:#111827;margin:0 0 4px;">${r.title}</div>
          <div style="font-size:13px;line-height:1.6;color:#4b5563;">${r.body}</div>
          ${
            r.href
              ? `<div style="margin-top:6px;"><a href="${r.href}" style="font-size:12px;color:#7c3aed;text-decoration:none;">${r.href.replace(/^https?:\/\//, "")} →</a></div>`
              : ""
          }
        </div>`,
    )
    .join("");

  const html = `
    <div dir="${dirFor(locale)}" style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:540px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
      <h1 style="font-size:22px;margin:0 0 8px;">${t("heading")}</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 18px;color:#555;">
        ${helloHtml}
      </p>
      <div style="background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:24px;font-weight:600;letter-spacing:0.04em;padding:18px 20px;border-radius:14px;margin:0 0 22px;">
        ${opts.phoneNumber}
      </div>
      <table cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 22px;font-size:13px;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px 0 0 8px;color:#6b7280;width:35%;">${t("activePlanLabel")}</td>
          <td style="padding:8px 12px;background:#fff;border:1px solid #e5e7eb;border-left:0;border-radius:0 8px 8px 0;color:#111827;font-weight:600;">${planLabel}</td>
        </tr>
      </table>
      <p style="font-size:13px;line-height:1.6;margin:0 0 22px;color:#6b7280;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 14px;">
        ${trialLine}
      </p>
      <h2 style="font-size:15px;margin:0 0 14px;color:#111827;">${t("todoHeading")}</h2>
      ${recoHtml}
      <p style="font-size:12px;line-height:1.6;margin:28px 0 0;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
        ${t("footerHtml")}
      </p>
    </div>
  `;

  try {
    const res = await client.emails.send({ from, to: [to], subject, text, html });
    if (res.error) {
      return { ok: false, error: `${res.error.name}: ${res.error.message}` };
    }
    return { ok: true, id: res.data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resend error" };
  }
}
