"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Link } from "@/i18n/navigation";
import { ConnectGoogleLink } from "@/components/ConnectGoogleLink";

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}

type Stage = "pick" | "loading" | "review" | "purchasing" | "done" | "error";

export function OnboardingWizard({
  googleConnected: googleConnectedInitial,
  appOrigin,
  subscriptionPlan,
}: {
  googleConnected: boolean;
  /** Origin canonique de l'app (ex: https://aitamara.com), passé depuis le
   *  server pour générer le redirect_uri Google sans hardcode. */
  appOrigin: string;
  /** Plan tenant : 'whatsapp' (basique) | 'global' | 'premium'. Drive
   *  l'activation des features (Google Calendar persisté côté tenant
   *  uniquement pour Globale/Premium). */
  subscriptionPlan: "whatsapp" | "global" | "premium";
}) {
  const t = useTranslations("Onboarding");

  // Mapping clés OAuth callback (?google=...) → clé de traduction. Le
  // callback définit la valeur du query param (connected/denied/...), le
  // wizard la traduit en message lisible. Switch préféré à une map FR
  // hardcodée pour que ESLint flag toute clé inattendue.
  const googleStatusKeyToLabel = (key: string | null): string | null => {
    switch (key) {
      case "connected":
        return t("googleStatusConnected");
      case "denied":
        return t("googleStatusDenied");
      case "no_refresh":
        return t("googleStatusNoRefresh");
      case "bad_state":
        return t("googleStatusBadState");
      case "user_mismatch":
        return t("googleStatusUserMismatch");
      case "missing":
        return t("googleStatusMissing");
      case "error":
        return t("googleStatusError");
      default:
        return null;
    }
  };

  const COUNTRIES = [
    { code: "FR", label: t("countryFrance") },
    { code: "IL", label: t("countryIsrael") },
  ];

  const PRIMARY_LANGUAGES = [
    { value: "fr" as const, label: t("languageFr") },
    { value: "he" as const, label: t("languageHe") },
    { value: "en" as const, label: t("languageEn") },
  ];

  // Plan WhatsApp : pas de Google Calendar perso. La feature "Agenda Google
  // complet (3 centres)" et "CRM Sheet" est réservée Globale/Premium.
  const googleStepDisabled = subscriptionPlan === "whatsapp";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<Stage>("pick");
  const [country, setCountry] = useState("FR");
  const [primaryLanguage, setPrimaryLanguage] = useState<"fr" | "he" | "en">(
    "fr",
  );
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<{
    phoneNumber: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);

  const googleStatusKey = searchParams.get("google");
  const googleStatusMessage = googleStatusKeyToLabel(googleStatusKey);
  const googleConnected =
    googleConnectedInitial || googleStatusKey === "connected";

  const search = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setStage("loading");
    startTransition(async () => {
      const params = new URLSearchParams({ country, limit: "5" });
      const res = await fetch(`/api/onboarding/search?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? t("errSearchFailed"));
        setStage("error");
        return;
      }
      const data = (await res.json()) as { numbers: AvailableNumber[] };
      if (data.numbers.length === 0) {
        setError(t("errNoNumbers"));
        setStage("error");
        return;
      }
      setNumbers(data.numbers);
      setSelected(data.numbers[0]?.phoneNumber ?? null);
      setStage("review");
    });
  };

  const purchase = () => {
    if (!selected) return;
    setError(null);
    setStage("purchasing");
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
        setStage("error");
        return;
      }
      const data = (await res.json()) as { phoneNumber: string };
      setProvisioned({ phoneNumber: data.phoneNumber });
      setStage("done");
    });
  };

  if (stage === "done" && provisioned) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
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
        <div className="space-y-2">
          <h2 className="font-display text-2xl text-[var(--color-foreground)]">
            {t("doneTitle")}
          </h2>
          <p className="font-mono text-lg text-[var(--color-foreground)]">
            {provisioned.phoneNumber}
          </p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t("doneDesc")}
          </p>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.02]"
        >
          {t("doneCta")}
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
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

  return (
    <div className="space-y-6">
      {/* Step 1: Connect Google (skippable, disabled si plan WhatsApp) */}
      <div
        className={`rounded-2xl border border-[var(--color-border)] p-5 transition-colors ${
          googleStepDisabled
            ? "bg-[var(--color-muted)]/40 opacity-70"
            : "bg-white/70"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
              {googleStepDisabled ? t("step1Unavailable") : t("step1Optional")}
            </p>
            <h3 className="mt-1 font-display text-lg text-[var(--color-foreground)]">
              {t("step1Title")}
            </h3>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {googleStepDisabled
                ? t("step1DescDisabled")
                : t("step1DescAvailable")}
            </p>
            {googleStepDisabled && (
              <Link
                href="/dashboard/billing"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:scale-[1.02]"
              >
                {t("upgradeLink")}
              </Link>
            )}
          </div>
          {googleStepDisabled ? (
            <span className="whitespace-nowrap rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
              {t("locked")}
            </span>
          ) : googleConnected ? (
            <span className="whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
              {t("connected")}
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowGoogleSetup((v) => !v)}
                aria-label={t("helpButtonAria")}
                aria-expanded={showGoogleSetup}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M12 11v5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="8" r="1" fill="currentColor" />
                </svg>
              </button>
              <ConnectGoogleLink className="whitespace-nowrap rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[var(--color-primary)]">
                {t("connectGoogle")}
              </ConnectGoogleLink>
            </div>
          )}
        </div>
        {showGoogleSetup && !googleConnected && !googleStepDisabled && (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900">
            <p className="font-medium">{t("redirectHintTitle")}</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                {t("redirectHintStep1Pre")}{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  console.cloud.google.com
                </a>{" "}
                {t("redirectHintStep1Post")}
              </li>
              <li>
                {t("redirectHintStep2")}
                <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-[11px] text-sky-900 ring-1 ring-inset ring-sky-200">
                  {appOrigin}/api/onboarding/google/callback
                </code>
              </li>
              <li>{t("redirectHintStep3")}</li>
            </ol>
            <p className="mt-2 text-[11px] text-sky-800/80">
              {t("redirectHintFooter")}
            </p>
          </div>
        )}
        {googleStatusMessage && !googleConnected && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {googleStatusMessage}
          </p>
        )}
      </div>

      {/* Step 2: Primary language */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-white/70 p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
          {t("step2Header")}
        </p>
        <h3 className="mt-1 font-display text-lg text-[var(--color-foreground)]">
          {t("step2Title")}
        </h3>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {t("step2Desc")}
        </p>
        <select
          value={primaryLanguage}
          onChange={(e) =>
            setPrimaryLanguage(e.target.value as "fr" | "he" | "en")
          }
          className="mt-3 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-xs"
        >
          {PRIMARY_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {/* Step 3: Pick number */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
          {t("step3Header")}
        </p>
      </div>

      {/* Country picker */}
      <form onSubmit={search} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--color-foreground)]">
            {t("countryLabel")}
          </span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={isPending}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-xs"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
        >
          {stage === "loading" ? t("searching") : t("searchButton")}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Number picker */}
      {numbers.length > 0 && stage !== "purchasing" && (
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
          className="w-full rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-md disabled:opacity-50"
        >
          {stage === "purchasing" ? t("purchasing") : t("confirmButton")}
        </button>
      )}

      {/* Le numéro est FACULTATIF : on peut passer et en obtenir un plus tard
          depuis le dashboard (CTA "Obtenir mon numéro" dans le hero). */}
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
