// The onboarding page's header: logo, the account's email and, when the
// account is in the Réception wizard, the trial pill. ONE component for the
// page (reception door: always the pill, exactly the markup it always had) and
// the welcome screen (no pill: the trial is the Réception one, not chosen yet;
// it appears once "Essayer la Réception en attendant" opens the wizard).
// No hook here, so a Server or a Client Component can render it.

import { Logo } from "@/components/ui/Logo";
import { Link } from "@/i18n/navigation";

export function OnboardingHeader({ email, trialLabel }: { email: string | null | undefined; trialLabel: string | null }) {
  return (
    <div className="mb-8 flex items-center justify-between gap-4">
      <Link href="/">
        <Logo />
      </Link>
      <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
        <span className="truncate">{email}</span>
        {trialLabel !== null && (
          <>
            <span
              aria-hidden
              className="h-1 w-1 shrink-0 rounded-full bg-[var(--color-border)]"
            />
            <span className="inline-flex shrink-0 items-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#be185d] px-2.5 py-0.5 text-[11px] font-semibold text-white"
            >
              {trialLabel}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
