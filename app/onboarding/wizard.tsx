"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}

const GOOGLE_STATUS_MESSAGES: Record<string, string> = {
  connected: "✅ Google Calendar et Sheets connectés.",
  denied: "Connexion refusée — réessaie ou continue sans pour l'instant.",
  no_refresh:
    "Google n'a pas renvoyé de refresh token. Va sur https://myaccount.google.com/permissions, retire l'accès à l'app, et reconnecte.",
  bad_state: "État de session invalide — réessaie.",
  user_mismatch: "Compte Google différent du tenant connecté.",
  missing: "Code OAuth manquant — réessaie.",
  error: "Erreur lors de la connexion Google.",
};

const COUNTRIES = [
  { code: "FR", label: "🇫🇷 France" },
  { code: "IL", label: "🇮🇱 Israël" },
];

const PRIMARY_LANGUAGES = [
  { value: "fr", label: "🇫🇷 Français" },
  { value: "he", label: "🇮🇱 עברית (Hébreu)" },
  { value: "en", label: "🇺🇸 English (US)" },
] as const;

type Stage = "pick" | "loading" | "review" | "purchasing" | "done" | "error";

export function OnboardingWizard({
  googleConnected: googleConnectedInitial,
}: {
  googleConnected: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<Stage>("pick");
  const [country, setCountry] = useState("FR");
  const [primaryLanguage, setPrimaryLanguage] = useState<"fr" | "he" | "en">("fr");
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<{
    phoneNumber: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);

  const googleStatusKey = searchParams.get("google");
  const googleStatusMessage = googleStatusKey
    ? GOOGLE_STATUS_MESSAGES[googleStatusKey] ?? null
    : null;
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
        setError(data?.error ?? "Recherche échouée");
        setStage("error");
        return;
      }
      const data = (await res.json()) as { numbers: AvailableNumber[] };
      if (data.numbers.length === 0) {
        setError("Aucun numéro disponible pour ce pays pour le moment. Réessaie dans quelques minutes ou choisis un autre pays.");
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
        setError(data?.error ?? "Provisioning échoué");
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
            <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl text-[var(--color-foreground)]">
            Numéro réservé !
          </h2>
          <p className="font-mono text-lg text-[var(--color-foreground)]">
            {provisioned.phoneNumber}
          </p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Branché à votre secrétaire. Appelez-le pour tester.
          </p>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.02]"
        >
          Aller au dashboard
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Connect Google (skippable) */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-white/70 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">
              Étape 1 · optionnel
            </p>
            <h3 className="mt-1 font-display text-lg text-[var(--color-foreground)]">
              Connecter Google Calendar & Sheets
            </h3>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              Pour que ton agent puisse réserver des RDV dans TON calendrier
              et enregistrer les contacts dans TON sheet. Tu peux aussi le
              faire plus tard depuis le dashboard.
            </p>
          </div>
          {googleConnected ? (
            <span className="whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
              ✓ Connecté
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowGoogleSetup((v) => !v)}
                aria-label="Pré-requis Google Cloud Console"
                aria-expanded={showGoogleSetup}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="8" r="1" fill="currentColor" />
                </svg>
              </button>
              <a
                href="/api/onboarding/google/start"
                className="whitespace-nowrap rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[var(--color-primary)]"
              >
                Connecter Google
              </a>
            </div>
          )}
        </div>
        {showGoogleSetup && !googleConnected && (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900">
            <p className="font-medium">
              Pré-requis : ajoute le redirect URI dans Google Cloud Console
            </p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                Va sur{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  console.cloud.google.com
                </a>{" "}
                → API &amp; Services → Credentials → ton OAuth client.
              </li>
              <li>
                Dans <strong>Authorized redirect URIs</strong>, ajoute :
                <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-[11px] text-sky-900 ring-1 ring-inset ring-sky-200">
                  https://assistai-claude-production.up.railway.app/api/onboarding/google/callback
                </code>
              </li>
              <li>Save.</li>
            </ol>
            <p className="mt-2 text-[11px] text-sky-800/80">
              Sans ça, Google refuse l&apos;OAuth avec{" "}
              <code className="font-mono">redirect_uri_mismatch</code>.
              L&apos;ancienne URI <code className="font-mono">/api/auth/callback</code>{" "}
              peut rester (utilisée par le legacy mutualisé).
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
          Étape 2 · langue principale de l&apos;agent
        </p>
        <h3 className="mt-1 font-display text-lg text-[var(--color-foreground)]">
          Dans quelle langue ton agent doit-il accueillir les appels ?
        </h3>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Cette langue sera utilisée pour la phrase d&apos;accueil. L&apos;agent bascule
          automatiquement vers la langue de la cliente dès qu&apos;elle parle.
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
          Étape 3 · numéro de téléphone
        </p>
      </div>

      {/* Country picker */}
      <form onSubmit={search} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--color-foreground)]">Pays</span>
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
          {stage === "loading" ? "Recherche…" : "Chercher des numéros disponibles"}
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
            Choisis un numéro
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
          {stage === "purchasing"
            ? "Provisionnement en cours…"
            : "Confirmer et activer ce numéro"}
        </button>
      )}

      <p className="text-center text-xs text-[var(--color-muted-foreground)]">
        Tu pourras changer plus tard depuis le dashboard.{" "}
        <Link href="/dashboard" className="underline">
          Sauter pour l&apos;instant
        </Link>
      </p>
    </div>
  );
}
