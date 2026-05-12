// Envoi d'emails transactionnels via Resend.
//
// Config Railway :
//   RESEND_API_KEY  — clé API Resend (gratuit jusqu'à 3000 emails/mois)
//   EMAIL_FROM      — adresse d'expédition, ex "Tamara <noreply@tamara.app>"
//                     Doit être un domaine vérifié dans Resend, sauf si on
//                     reste sur "onboarding@resend.dev" (sandbox limité à
//                     l'adresse propriétaire du compte Resend).
//
// Sans clé : on log le contenu de l'email dans la console (dev/test fallback)
// pour que le code de verification reste utilisable même sans setup complet.
// → NE PAS laisser cette fallback en prod sans clé : le user ne recevra
// jamais son code et sera bloqué au signup.

import { Resend } from "resend";

import type { PlanFeatures } from "@/lib/plan-features";
import { getLocalizedPlan } from "@/lib/plan-i18n";

const FROM_DEFAULT = "Tamara <onboarding@resend.dev>";

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

export async function sendVerificationEmail(
  to: string,
  code: string,
): Promise<SendResult> {
  const client = getResend();
  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;

  // Fallback dev : pas de clé Resend → log en console pour que le user
  // puisse quand même se vérifier en lisant les logs Railway. Affiche un
  // gros warning pour que ce soit visible.
  if (!client) {
    console.warn(
      `\n=================== EMAIL FALLBACK (no RESEND_API_KEY) ===================` +
        `\nTo:   ${to}` +
        `\nFrom: ${from}` +
        `\nCode: ${code}` +
        `\nSubject: Votre code de vérification Tamara` +
        `\n==========================================================================\n`,
    );
    return { ok: true, fallback: "console_log" };
  }

  const subject = `Votre code de vérification : ${code}`;
  const text =
    `Bonjour,\n\n` +
    `Voici votre code à 4 chiffres pour valider votre adresse email sur Tamara :\n\n` +
    `   ${code}\n\n` +
    `Ce code expire dans 15 minutes.\n\n` +
    `Si vous n'avez pas créé de compte sur Tamara, ignorez ce message.\n\n` +
    `— L'équipe Tamara`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
      <h1 style="font-size:22px;margin:0 0 16px;">Votre code Tamara</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 24px;color:#555;">
        Voici votre code à 4 chiffres pour valider votre adresse email.
      </p>
      <div style="font-family:'SF Mono',Menlo,Monaco,monospace;font-size:42px;letter-spacing:0.4em;font-weight:600;text-align:center;background:linear-gradient(135deg,#fef3c7,#fce7f3);padding:20px 24px;border-radius:14px;color:#831843;">
        ${code}
      </div>
      <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#888;">
        Ce code expire dans 15 minutes.<br/>
        Si vous n'avez pas créé de compte sur Tamara, ignorez ce message.
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
      return {
        ok: false,
        error: `${res.error.name}: ${res.error.message}`,
      };
    }
    return { ok: true, id: res.data?.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erreur Resend",
    };
  }
}

// Alerte 2h-avant-fin du free trial. Le cron trial-cleanup pose
// users.trial_warning_sent_at après envoi pour idempotence (un seul
// warning par trial même si le cron tick toutes les 10 min).
export async function sendTrialWarningEmail(
  to: string,
  opts: { phoneNumber?: string | null; minutesLeft: number },
): Promise<SendResult> {
  const client = getResend();
  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;
  const phoneLine = opts.phoneNumber
    ? `Votre numéro ${opts.phoneNumber} sera libéré côté Twilio.`
    : `Votre numéro Twilio sera libéré.`;
  const minutes = Math.max(1, opts.minutesLeft);

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

  const subject = `⏰ Votre essai Tamara expire dans ${minutes < 120 ? `${minutes} minutes` : `2 heures`}`;
  const text =
    `Bonjour,\n\n` +
    `Votre essai gratuit Tamara expire dans environ 2 heures.\n\n` +
    `À l'expiration :\n` +
    `  • Votre compte sera supprimé.\n` +
    `  • ${phoneLine}\n\n` +
    `Pour conserver votre numéro et votre configuration, activez un plan ` +
    `depuis votre tableau de bord avant l'expiration :\n` +
    `https://aitamara.com/dashboard/billing\n\n` +
    `Si vous ne souhaitez pas continuer, vous n'avez rien à faire — ` +
    `tout sera nettoyé automatiquement.\n\n` +
    `— L'équipe Tamara`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
      <h1 style="font-size:22px;margin:0 0 12px;">⏰ Votre essai expire bientôt</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#555;">
        Votre essai gratuit <strong>Tamara</strong> expire dans environ <strong>2 heures</strong>.
      </p>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 18px;font-size:13px;line-height:1.6;color:#9a3412;margin:0 0 20px;">
        À l'expiration, votre compte sera <strong>supprimé</strong> et ${opts.phoneNumber ? `le numéro <strong>${opts.phoneNumber}</strong>` : `votre numéro Twilio`} sera <strong>libéré</strong>.
      </div>
      <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#555;">
        Pour conserver votre numéro et votre configuration, activez un plan depuis votre tableau de bord :
      </p>
      <p style="margin:0 0 24px;">
        <a href="https://aitamara.com/dashboard/billing" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:999px;">
          Activer mon plan →
        </a>
      </p>
      <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#888;">
        Si vous ne souhaitez pas continuer, ignorez ce message — tout sera nettoyé automatiquement.
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
    return { ok: false, error: e instanceof Error ? e.message : "Erreur Resend" };
  }
}

// Notification post-suppression : le compte vient d'être supprimé en fin
// de trial. Le user reçoit confirmation et peut recréer un compte
// derrière s'il change d'avis (signup classique).
export async function sendTrialDeletedEmail(
  to: string,
  opts: { phoneNumber?: string | null },
): Promise<SendResult> {
  const client = getResend();
  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;
  const phoneLine = opts.phoneNumber
    ? `Votre numéro ${opts.phoneNumber} a été libéré.`
    : `Votre numéro Twilio a été libéré.`;

  if (!client) {
    console.warn(
      `\n=================== TRIAL DELETED EMAIL FALLBACK (no RESEND_API_KEY) ===================` +
        `\nTo:   ${to}` +
        `\nFrom: ${from}` +
        `\n========================================================================================\n`,
    );
    return { ok: true, fallback: "console_log" };
  }

  const subject = `Votre compte Tamara a été supprimé`;
  const text =
    `Bonjour,\n\n` +
    `Votre essai gratuit Tamara est terminé. Comme aucun plan n'a été ` +
    `activé, votre compte a été supprimé automatiquement.\n\n` +
    `${phoneLine}\n\n` +
    `Vous pouvez recréer un compte à tout moment :\n` +
    `https://aitamara.com/signup\n\n` +
    `Merci d'avoir essayé Tamara.\n\n` +
    `— L'équipe Tamara`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
      <h1 style="font-size:22px;margin:0 0 12px;">Votre compte a été supprimé</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#555;">
        Votre essai gratuit <strong>Tamara</strong> est terminé. Aucun plan
        n'a été activé, votre compte a donc été supprimé automatiquement.
      </p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 18px;font-size:13px;line-height:1.6;color:#4b5563;margin:0 0 20px;">
        ${phoneLine}
      </div>
      <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#555;">
        Vous pouvez recréer un compte à tout moment :
      </p>
      <p style="margin:0 0 24px;">
        <a href="https://aitamara.com/signup" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:999px;">
          Créer un nouveau compte →
        </a>
      </p>
      <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#888;">
        Merci d'avoir essayé Tamara.
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
    return { ok: false, error: e instanceof Error ? e.message : "Erreur Resend" };
  }
}

// Welcome email envoyé à la fin de /api/onboarding/provision (juste après
// l'achat du numéro Twilio). Personnalise les recommandations selon le
// plan ET la matrice features active : si calendar=true on pousse Google
// Calendar, si crm=true on parle de sync CRM, etc.
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
  const client = getResend();
  const from = process.env.EMAIL_FROM ?? FROM_DEFAULT;

  const plan = getLocalizedPlan(opts.locale, opts.planKey);
  const planLabel = plan.name;
  const firstName =
    (opts.displayName ?? "").trim().split(/\s+/)[0] || null;
  const hello = firstName ? `Bonjour ${firstName},` : `Bonjour,`;

  const trialLine = opts.trialEndsAt
    ? `Votre essai gratuit court jusqu'au ${opts.trialEndsAt.toLocaleString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Paris",
      })}.`
    : `Votre essai gratuit est actif.`;

  // Reco conditionnelles : on n'affiche que ce qui matche le plan + la
  // matrice features. Si l'admin a coupé calendar pour ce plan, on n'en
  // parle pas (l'agent ne peut pas réserver de toute façon).
  const recos: Array<{ title: string; body: string; href?: string }> = [];

  recos.push({
    title: "1 · Testez votre assistante",
    body: `Appelez le ${opts.phoneNumber} depuis votre téléphone et discutez avec elle comme avec un client. C'est le meilleur moyen de découvrir ce qu'elle sait faire.`,
  });

  let n = 2;
  if (opts.features.calendar) {
    recos.push({
      title: `${n++} · Connectez Google Calendar`,
      body: `Sans calendrier connecté, l'agent ne peut pas réserver dans VOTRE agenda. Ouvrez votre dashboard et cliquez sur "Connecter Google" — 30 secondes.`,
      href: "https://aitamara.com/dashboard",
    });
  }
  if (opts.features.crm) {
    recos.push({
      title: `${n++} · CRM Google Sheet`,
      body: `Chaque contact créé par l'agent est ajouté automatiquement à votre Google Sheet. Pensez à le partager avec votre équipe si plusieurs personnes le consultent.`,
    });
  }
  if (opts.features.whatsapp_recap) {
    recos.push({
      title: `${n++} · Recap WhatsApp owner`,
      body: `Renseignez votre numéro WhatsApp owner dans l'onglet Configuration pour recevoir un récap immédiat à chaque appel.`,
      href: "https://aitamara.com/dashboard",
    });
  }
  recos.push({
    title: `${n++} · Personnalisez la persona`,
    body: `Allez dans Configuration pour ajuster le ton, les horaires, les centres et les règles métier. La persona par défaut est "Johana" — renommez-la et adaptez-la à votre activité.`,
    href: "https://aitamara.com/dashboard",
  });

  const subject = `🎉 Votre assistante Tamara est en ligne — ${opts.phoneNumber}`;
  const text =
    `${hello}\n\n` +
    `Votre assistante vocale Tamara est désormais en ligne sur :\n\n` +
    `   ${opts.phoneNumber}\n\n` +
    `Plan actif : ${planLabel}\n` +
    `${trialLine}\n\n` +
    `À FAIRE MAINTENANT :\n\n` +
    recos
      .map((r) => `${r.title}\n${r.body}${r.href ? `\n→ ${r.href}` : ""}`)
      .join("\n\n") +
    `\n\nBesoin d'aide ? Réponds à ce mail.\n\n— L'équipe Tamara`;

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
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:540px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
      <h1 style="font-size:22px;margin:0 0 8px;">🎉 Votre assistante est en ligne</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 18px;color:#555;">
        ${hello.replace(",", "")} — Tamara est désormais joignable à tout moment sur ce numéro :
      </p>
      <div style="background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:24px;font-weight:600;letter-spacing:0.04em;padding:18px 20px;border-radius:14px;margin:0 0 22px;">
        ${opts.phoneNumber}
      </div>
      <table cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 22px;font-size:13px;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px 0 0 8px;color:#6b7280;width:35%;">Plan actif</td>
          <td style="padding:8px 12px;background:#fff;border:1px solid #e5e7eb;border-left:0;border-radius:0 8px 8px 0;color:#111827;font-weight:600;">${planLabel}</td>
        </tr>
      </table>
      <p style="font-size:13px;line-height:1.6;margin:0 0 22px;color:#6b7280;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 14px;">
        ${trialLine}
      </p>
      <h2 style="font-size:15px;margin:0 0 14px;color:#111827;">À faire maintenant</h2>
      ${recoHtml}
      <p style="font-size:12px;line-height:1.6;margin:28px 0 0;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
        Besoin d'aide ? Réponds directement à ce mail, on lit tout.<br/>
        — L'équipe Tamara
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
    return { ok: false, error: e instanceof Error ? e.message : "Erreur Resend" };
  }
}
