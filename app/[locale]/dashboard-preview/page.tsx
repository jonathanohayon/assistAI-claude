import { getTranslations } from "next-intl/server";

import { ConfigForm } from "../dashboard/config-form";
import { PaletteSwitcher } from "./palette-switcher";

/**
 * Route de prévisualisation visuelle du redesign /dashboard config — sans
 * authentification, avec des données mockées. À supprimer une fois le
 * redesign validé (non-prod, pas listée dans la nav).
 */
export default async function DashboardPreviewPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "DashboardConfig" });

  const dateLocale =
    locale === "he" ? "he-IL" : locale === "en" ? "en-US" : "fr-FR";
  const lastUpdated = new Date().toLocaleString(dateLocale, {
    dateStyle: "long",
    timeStyle: "short",
  });

  const mockInstructions = `Tu es Sarah, la secrétaire IA du salon Prestige Coiffure à Ashdod.

# Identité
- Salon haut de gamme situé centre-ville Ashdod, rue Rogozin 12
- Horaires : 9h-19h du dimanche au jeudi, fermé vendredi-samedi
- Spécialités : coloration, mèches, balayage, soins kératine

# Prestations principales
- Coupe femme : 60min, 180₪
- Coloration : 90min, 280₪
- Mèches/balayage : 120min, 350₪
- Brushing : 30min, 80₪

# Style de réponse
- Ton chaleureux, professionnel, jamais familier
- Réponses courtes (1-2 phrases max)
- Tutoiement uniquement si la cliente tutoie en premier
- Si une question hors sujet → rediriger vers la prise de RDV`;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
      <div className="mb-4 rounded-2xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-2.5 text-xs text-[var(--color-warning-strong)]">
        <strong>Preview mode</strong> — données mockées, pas d'authentification.
        Visite <code className="rounded bg-white/60 px-1 font-mono">/dashboard</code>
        {" "}une fois loggé pour la vraie page.
      </div>

      <PaletteSwitcher />

      <ConfigForm
        initial={{
          instructions: mockInstructions,
          greetingInstructions:
            "Bonjour, c'est Sarah du salon Prestige Coiffure. Comment puis-je vous aider ?",
          model: "gpt-realtime-mini",
          voice: "marin",
          temperature: 0.6,
          speed: 1,
          maxResponseTokens: 220,
          ownerWhatsapp: "+972585001007",
          primaryLanguage: locale,
          inheritAdminGlobals: true,
          personality: {},
          agentName: "Sarah",
        }}
        isAdmin={true}
        adminInheritablePreview="═══ Directive admin pour le plan Pro ═══\n\nL'agent doit toujours confirmer le créneau exact avant de raccrocher.\nNe jamais promettre une plage horaire sans avoir vérifié la dispo réelle.\n\n═══ Heure parlée ═══\n\nQuand tu prononces une heure, dis « quatorze heures trente » et pas « 14h30 »."
        planLabel="Pro"
        primaryPhone="+33 1 23 45 67 89"
        lastUpdatedLabel={lastUpdated}
      />
    </main>
  );
}
