"use client";

// The first onboarding screen of a sales or connect account while that
// product is not usable (lib/onboarding-route.ts): no number is searched or
// bought here. It says, in the door's words, that the product opens soon and
// that the account will be told first (only once the notify-me row exists),
// asks for the company name and the agent's language (the wizard's fields),
// then either opens the product's preview in the dashboard or today's
// Réception wizard, unchanged.

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import { useRouter } from "@/i18n/navigation";
import { welcomeFormValid, type WelcomeDoor, type WelcomeLanguage } from "@/lib/onboarding-route";

import { continueFromWelcome, recordNotify, type WelcomeChoice } from "./welcome-actions";
import { ONBOARDING_CARD_CLASS, WizardCard } from "./wizard-card";

type NotifyState = "recorded" | "recording" | "failed";

export function DoorWelcome({
  door,
  productName,
  previewHref,
  notifyRecorded,
  initialCompanyName,
  initialLanguage,
  defaultCountry,
}: {
  door: WelcomeDoor;
  /** DashboardNav.<door>, read on the server: the ONE product-name key. */
  productName: string;
  previewHref: string;
  /** accountProducts(userId).notifyRequested includes the door's product. */
  notifyRecorded: boolean;
  initialCompanyName: string;
  initialLanguage: WelcomeLanguage | null;
  defaultCountry: "FR" | "IL";
}) {
  const t = useTranslations("Onboarding");
  const router = useRouter();

  const [mode, setMode] = useState<"welcome" | "wizard">("welcome");
  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [language, setLanguage] = useState<WelcomeLanguage | null>(initialLanguage);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [notify, setNotify] = useState<NotifyState>(notifyRecorded ? "recorded" : "recording");
  const [isPending, startTransition] = useTransition();
  const notifyStarted = useRef(false);

  const runNotify = () => {
    setNotify("recording");
    void recordNotify(door, fetch).then((ok) => setNotify(ok ? "recorded" : "failed"));
  };

  // The row is missing: record it before saying so (once, even under StrictMode).
  useEffect(() => {
    if (notifyRecorded || notifyStarted.current) return;
    notifyStarted.current = true;
    void recordNotify(door, fetch).then((ok) => setNotify(ok ? "recorded" : "failed"));
  }, [door, notifyRecorded]);

  if (mode === "wizard") {
    return (
      <WizardCard
        sectionHeader={t("sectionHeader")}
        title={t("title")}
        subtitle={t("subtitle")}
        initialLanguage={language ?? "fr"}
        initialCompanyName={companyName}
        defaultCountry={defaultCountry}
      />
    );
  }

  const valid = welcomeFormValid(companyName, language);
  const choose = (choice: WelcomeChoice) => {
    setProfileError(null);
    startTransition(async () => {
      const r = await continueFromWelcome(choice, { companyName, language }, {
        fetch,
        navigate: (href) => router.push(href),
        openWizard: () => setMode("wizard"),
        previewHref,
      });
      if (r === "failed") setProfileError(t("errProfileFailed"));
    });
  };

  const LANGUAGES: { value: WelcomeLanguage; label: string }[] = [
    { value: "fr", label: t("languageFr") },
    { value: "he", label: t("languageHe") },
    { value: "en", label: t("languageEn") },
  ];

  return (
    <div className={ONBOARDING_CARD_CLASS} data-onboarding-welcome={door}>
      <span
        aria-hidden
        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[#be185d] text-white shadow-md"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

      <h1 className="mt-5 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
        {t("welcomeTitle", { product: productName })}
      </h1>

      <div className="mt-3 min-h-[1.5rem] text-sm" aria-live="polite">
        {notify === "recorded" && (
          <p data-notify="recorded" className="flex items-start gap-2 text-[var(--color-muted-foreground)]">
            <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden>
              <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{t("welcomeRecorded")}</span>
          </p>
        )}
        {notify === "recording" && (
          <p data-notify="recording" className="text-[var(--color-muted-foreground)]">
            {t("welcomeRecording")}
          </p>
        )}
        {notify === "failed" && (
          <p data-notify="failed" className="text-amber-800">
            {t("welcomeRecordFailed")}{" "}
            <button
              type="button"
              onClick={runNotify}
              className="font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
            >
              {t("welcomeRecordRetry")}
            </button>
          </p>
        )}
      </div>

      <div className="mt-8 space-y-6">
        {/* Company name (the wizard's field) */}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-[var(--color-foreground)]">
            {t("companyNameLabel")}
          </span>
          <input
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder={t("companyNamePlaceholder")}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          />
        </label>

        {/* Agent's language (the wizard's pills) */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-[var(--color-foreground)]">
            {t("langTitle")}
          </legend>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t("langDesc")}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {LANGUAGES.map((l) => {
              const active = language === l.value;
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLanguage(l.value)}
                  aria-pressed={active}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
                    active
                      ? "bg-gradient-to-br from-[var(--color-primary)] to-[#be185d] text-white shadow-sm"
                      : "border border-[var(--color-border)] bg-white text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
                  }`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {profileError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {profileError}
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            data-welcome="preview"
            onClick={() => choose("preview")}
            disabled={!valid || isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#be185d] px-5 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.01] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            {t("welcomePreview")}
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 rtl:rotate-180" aria-hidden>
              <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            data-welcome="reception"
            onClick={() => choose("reception")}
            disabled={!valid || isPending}
            className="inline-flex w-full items-center justify-center rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-muted)] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            {t("welcomeTryReception")}
          </button>
          <p className="text-center text-[11px] text-[var(--color-muted-foreground)]">
            {valid ? t("welcomePreviewNote") : t("welcomeRequired")}
          </p>
        </div>
      </div>
    </div>
  );
}
