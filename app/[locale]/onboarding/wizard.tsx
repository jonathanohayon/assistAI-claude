"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}

type Stage = "activity" | "number" | "done";
type NumberSubState =
  | "pick"
  | "loading"
  | "review"
  | "purchasing"
  | "error";
type UseCase = "reception" | "support" | "sales" | "permanence";
type Language = "fr" | "he" | "en";
type Country = "FR" | "IL";

export function OnboardingWizard({
  initialLanguage,
  initialCompanyName,
  defaultCountry,
}: {
  initialLanguage: Language;
  initialCompanyName: string;
  defaultCountry: Country;
}) {
  const t = useTranslations("Onboarding");
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("activity");

  // --- Étape "activity" ---
  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [useCase, setUseCase] = useState<UseCase>("reception");
  const [primaryLanguage, setPrimaryLanguage] =
    useState<Language>(initialLanguage);
  const [profileError, setProfileError] = useState<string | null>(null);

  // --- Étape "number" ---
  const [numberState, setNumberState] = useState<NumberSubState>("pick");
  const [country, setCountry] = useState<Country>(defaultCountry);
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Étape "done" ---
  const [provisioned, setProvisioned] = useState<{ phoneNumber: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPending, startTransition] = useTransition();

  const PRIMARY_LANGUAGES: { value: Language; label: string }[] = [
    { value: "fr", label: t("languageFr") },
    { value: "he", label: t("languageHe") },
    { value: "en", label: t("languageEn") },
  ];

  const COUNTRIES: { code: Country; label: string }[] = [
    { code: "FR", label: t("countryFrance") },
    { code: "IL", label: t("countryIsrael") },
  ];

  const USE_CASES: {
    key: UseCase;
    title: string;
    desc: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: "reception",
      title: t("useCaseReceptionTitle"),
      desc: t("useCaseReceptionDesc"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <rect
            x="3"
            y="5"
            width="18"
            height="16"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M3 9h18M8 3v4M16 3v4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="m8.5 14 2 2 4-4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      key: "support",
      title: t("useCaseSupportTitle"),
      desc: t("useCaseSupportDesc"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M4 13v-1a8 8 0 0 1 16 0v1"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <rect
            x="2.5"
            y="13"
            width="4"
            height="6"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <rect
            x="17.5"
            y="13"
            width="4"
            height="6"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M19.5 19v1a2 2 0 0 1-2 2H13"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
    {
      key: "sales",
      title: t("useCaseSalesTitle"),
      desc: t("useCaseSalesDesc"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M4 19V5M4 19h16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="m7 14 3.5-3.5 3 3L20 7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M16 7h4v4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      key: "permanence",
      title: t("useCasePermanenceTitle"),
      desc: t("useCasePermanenceDesc"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ];

  const search = useCallback(
    (c: Country) => {
      setError(null);
      setNumberState("loading");
      startTransition(async () => {
        const params = new URLSearchParams({ country: c, limit: "5" });
        const res = await fetch(`/api/onboarding/search?${params}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? t("errSearchFailed"));
          setNumberState("error");
          return;
        }
        const data = (await res.json()) as { numbers: AvailableNumber[] };
        if (data.numbers.length === 0) {
          setError(t("errNoNumbers"));
          setNumberState("error");
          return;
        }
        setNumbers(data.numbers);
        setSelected(data.numbers[0]?.phoneNumber ?? null);
        setNumberState("review");
      });
    },
    [t],
  );

  // Lance la recherche automatiquement dès l'entrée dans l'étape "number".
  useEffect(() => {
    if (stage === "number") {
      // search() lance une recherche async via startTransition ; le setState
      // n'est pas synchrone dans le corps de l'effet.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      search(country);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const submitActivity = () => {
    setProfileError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/onboarding/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: companyName.trim(),
            primaryLanguage,
          }),
        });
        if (!res.ok) {
          setProfileError(t("errProfileFailed"));
        }
      } catch {
        setProfileError(t("errProfileFailed"));
      }
      // Best-effort : on passe à l'étape numéro même si l'enregistrement échoue.
      setStage("number");
    });
  };

  const purchase = () => {
    if (!selected) return;
    setError(null);
    setNumberState("purchasing");
    startTransition(async () => {
      const res = await fetch("/api/onboarding/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryCode: country,
          phoneNumber: selected,
          primaryLanguage,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errProvisionFailed"));
        setNumberState("error");
        return;
      }
      const data = (await res.json()) as { phoneNumber: string };
      setProvisioned({ phoneNumber: data.phoneNumber });
      setStage("done");
    });
  };

  const copyNumber = () => {
    if (!provisioned) return;
    navigator.clipboard?.writeText(provisioned.phoneNumber).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  // ============================ ÉTAPE DONE ============================
  if (stage === "done" && provisioned) {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-lg">
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
            <path
              d="m5 13 4 4L19 7"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="space-y-3">
          <h2 className="font-display text-2xl text-[var(--color-foreground)]">
            {t("doneTitle")}
          </h2>
          <p className="font-mono text-3xl font-semibold tracking-tight text-[var(--color-foreground)] sm:text-4xl">
            {provisioned.phoneNumber}
          </p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t("doneDesc")}
          </p>
        </div>

        <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href={`tel:${provisioned.phoneNumber}`}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path
                d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t("callButton")}
          </a>
          <button
            type="button"
            onClick={copyNumber}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-emerald-600">
                <path
                  d="m5 13 4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <rect
                  x="9"
                  y="9"
                  width="11"
                  height="11"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M5 15V5a2 2 0 0 1 2-2h8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {copied ? t("copied") : t("copyNumber")}
          </button>
        </div>

        {/* Encart scan site (secondaire, discret) */}
        <div className="mt-2 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-4 text-start">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-border)]">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="m20 20-3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm text-[var(--color-foreground)]">
                {t("scanSiteTitle")}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                {t("scanSiteDesc")}
              </p>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
              >
                {t("scanSiteCta")}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-muted-foreground)] underline-offset-2 transition-colors hover:text-[var(--color-foreground)] hover:underline"
        >
          {t("doneCta")}
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 rtl:rotate-180">
            <path
              d="M5 12h14M13 5l7 7-7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    );
  }

  // ============================ ÉTAPE NUMBER ============================
  if (stage === "number") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-xl text-[var(--color-foreground)]">
            {t("stepNumberHeader")}
          </h2>
        </div>

        {/* Country picker + recherche de secours */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--color-foreground)]">
              {t("countryLabel")}
            </span>
            <select
              value={country}
              onChange={(e) => {
                const c = e.target.value as Country;
                setCountry(c);
                search(c);
              }}
              disabled={isPending}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => search(country)}
            disabled={isPending}
            className="rounded-full border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-muted)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            {numberState === "loading" ? t("searching") : t("searchButton")}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {numberState === "loading" && numbers.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--color-muted-foreground)]">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-spin">
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="2"
                strokeOpacity="0.25"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            {t("searching")}
          </div>
        )}

        {/* Number picker */}
        {numbers.length > 0 && numberState !== "purchasing" && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
              {t("pickNumber")}
            </p>
            <ul className="space-y-1.5">
              {numbers.map((n) => (
                <li key={n.phoneNumber}>
                  <label
                    className={`flex cursor-pointer items-center justify-between rounded-xl border bg-white px-4 py-3 transition-colors ${
                      selected === n.phoneNumber
                        ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20"
                        : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="phone"
                        value={n.phoneNumber}
                        checked={selected === n.phoneNumber}
                        onChange={() => setSelected(n.phoneNumber)}
                        className="accent-[var(--color-primary)]"
                      />
                      <div>
                        <div className="font-mono text-sm text-[var(--color-foreground)]">
                          {n.friendlyName || n.phoneNumber}
                        </div>
                        {(n.locality || n.region) && (
                          <div className="text-xs text-[var(--color-muted-foreground)]">
                            {[n.locality, n.region].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Confirm */}
        {numbers.length > 0 && (
          <button
            onClick={purchase}
            disabled={!selected || isPending}
            className="w-full rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.01] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            {numberState === "purchasing" ? t("purchasing") : t("confirmButton")}
          </button>
        )}

        {/* Le numéro est FACULTATIF */}
        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            disabled={isPending}
            className="text-xs font-medium text-[var(--color-muted-foreground)] underline-offset-2 hover:text-[var(--color-foreground)] hover:underline disabled:opacity-50"
          >
            {t("skipPhone")}
          </button>
          <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
            {t("skipPhoneNote")}
          </p>
        </div>
      </div>
    );
  }

  // ============================ ÉTAPE ACTIVITY ============================
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-[var(--color-foreground)]">
          {t("stepActivityHeader")}
        </h2>
      </div>

      {/* Nom de l'entreprise */}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-[var(--color-foreground)]">
          {t("companyNameLabel")}
        </span>
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder={t("companyNamePlaceholder")}
          className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        />
      </label>

      {/* Cas d'usage (radio-cards) */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-[var(--color-foreground)]">
          {t("useCaseTitle")}
        </legend>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {USE_CASES.map((uc) => {
            const active = useCase === uc.key;
            return (
              <label
                key={uc.key}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4 transition-colors ${
                  active
                    ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20"
                    : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"
                }`}
              >
                <input
                  type="radio"
                  name="useCase"
                  value={uc.key}
                  checked={active}
                  onChange={() => setUseCase(uc.key)}
                  className="sr-only"
                />
                <span
                  className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    active
                      ? "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white"
                      : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
                  }`}
                  aria-hidden
                >
                  {uc.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-sm text-[var(--color-foreground)]">
                    {uc.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
                    {uc.desc}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Langue principale (pills) */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-[var(--color-foreground)]">
          {t("langTitle")}
        </legend>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {t("langDesc")}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {PRIMARY_LANGUAGES.map((l) => {
            const active = primaryLanguage === l.value;
            return (
              <button
                key={l.value}
                type="button"
                onClick={() => setPrimaryLanguage(l.value)}
                aria-pressed={active}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
                  active
                    ? "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-sm"
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

      <button
        type="button"
        onClick={submitActivity}
        disabled={isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.01] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
      >
        {t("continueButton")}
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 rtl:rotate-180">
          <path
            d="M5 12h14M13 5l7 7-7 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
