"use client";

import { useTranslations } from "next-intl";

import { Logo } from "@/components/ui/Logo";
import { Link } from "@/i18n/navigation";

interface SignupContentProps {
  error: string | undefined;
  handleSignup: (formData: FormData) => Promise<void>;
  startGoogleSignup: (formData: FormData) => Promise<void>;
}

/** Logo Google multicolore (sign-in officiel). */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/**
 * Signup ultra simple, Google-first, sur une seule colonne centrée. Plus de
 * choix de plan ni de carte recap : l'essai donne accès à tout (provisionné
 * sur TRIAL_PLAN_KEY côté server action), le choix de formule se fait plus
 * tard sur la page billing. Le nom est demandé à l'onboarding.
 */
export function SignupContent({
  error,
  handleSignup,
  startGoogleSignup,
}: SignupContentProps) {
  const t = useTranslations("Signup");

  const errorMessages: Record<string, string> = {
    invalid: t("errInvalid"),
    exists: t("errExists"),
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="flex justify-center">
        <Link href="/" className="inline-block">
          <Logo />
        </Link>
      </div>

      <div className="mt-8 flex flex-col items-center text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
            <circle cx="8" cy="8" r="8" fill="currentColor" fillOpacity="0.15" />
            <path
              d="m5 8.5 2 2 4-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t("freeBadge")}
        </span>
        <h1 className="mt-4 font-display text-3xl tracking-tight text-[var(--color-foreground)]">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
          {t("subtitle")}
        </p>
      </div>

      <div className="mt-8 rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur">
        {/* Google-first : bouton prominent en premier, pleine largeur. */}
        <form action={startGoogleSignup}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2.5 rounded-full border border-[var(--color-border)] bg-white px-4 py-3 text-sm font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-muted)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
          >
            <GoogleIcon />
            {t("continueWithGoogle")}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--color-border)]" />
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {t("orDivider")}
          </span>
          <span className="h-px flex-1 bg-[var(--color-border)]" />
        </div>

        {error && errorMessages[error] && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {errorMessages[error]}
          </p>
        )}

        <form action={handleSignup} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-[var(--color-foreground)]">
              {t("emailLabel")}
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-[var(--color-foreground)]">
              {t("passwordLabel")}
            </span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
            />
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {t("passwordHint")}
            </span>
          </label>

          <button
            type="submit"
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/25"
          >
            {t("submitButton")}
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path
                d="M5 12h14M13 5l7 7-7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-xs text-[var(--color-muted-foreground)]">
        {t("alreadyAccount")}{" "}
        <Link href="/login" className="text-[var(--color-primary)] hover:underline">
          {t("loginLink")}
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-[var(--color-muted-foreground)]">
        <Link href="/" className="hover:text-[var(--color-foreground)]">
          {t("backHome")}
        </Link>
      </p>
    </div>
  );
}
