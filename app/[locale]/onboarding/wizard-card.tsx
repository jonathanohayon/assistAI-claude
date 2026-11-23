// The Réception wizard in its card, exactly the markup the onboarding page
// has always rendered. ONE component for both ways in: the page (reception
// door, or a usable product) and the welcome screen's "Essayer la Réception
// en attendant". No hook here, so a Server or a Client Component can render it.

import { OnboardingWizard } from "./wizard";

type Language = "fr" | "he" | "en";

export const ONBOARDING_CARD_CLASS =
  "rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur sm:p-10";

export function WizardCard({
  sectionHeader,
  title,
  subtitle,
  initialLanguage,
  initialCompanyName,
  defaultCountry,
}: {
  sectionHeader: string;
  title: string;
  subtitle: string;
  initialLanguage: Language;
  initialCompanyName: string;
  defaultCountry: "FR" | "IL";
}) {
  return (
    <div className={ONBOARDING_CARD_CLASS}>
      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
        {sectionHeader}
      </p>
      <h1 className="mt-3 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
        {subtitle}
      </p>

      <div className="mt-8">
        <OnboardingWizard
          initialLanguage={initialLanguage}
          initialCompanyName={initialCompanyName}
          defaultCountry={defaultCountry}
        />
      </div>
    </div>
  );
}
