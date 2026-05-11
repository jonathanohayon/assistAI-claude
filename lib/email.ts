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
