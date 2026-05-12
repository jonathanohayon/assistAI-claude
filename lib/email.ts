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
