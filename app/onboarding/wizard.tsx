"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}

const COUNTRIES = [
  { code: "US", label: "États-Unis (recommandé pour test)" },
  { code: "IL", label: "Israël" },
  { code: "FR", label: "France" },
  { code: "GB", label: "Royaume-Uni" },
  { code: "CA", label: "Canada" },
];

type Stage = "pick" | "loading" | "review" | "purchasing" | "done" | "error";

export function OnboardingWizard() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("pick");
  const [country, setCountry] = useState("US");
  const [areaCode, setAreaCode] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<{
    phoneNumber: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const search = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setStage("loading");
    startTransition(async () => {
      const params = new URLSearchParams({ country, limit: "5" });
      if (areaCode.trim()) params.set("area", areaCode.trim());
      const res = await fetch(`/api/onboarding/search?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Recherche échouée");
        setStage("error");
        return;
      }
      const data = (await res.json()) as { numbers: AvailableNumber[] };
      if (data.numbers.length === 0) {
        setError("Aucun numéro disponible avec ces critères. Essaie un autre indicatif.");
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
        body: JSON.stringify({ countryCode: country, phoneNumber: selected }),
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
    <div className="space-y-5">
      {/* Country + area code */}
      <form onSubmit={search} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--color-foreground)]">
            Indicatif
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value)}
            placeholder="212"
            disabled={isPending}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 font-mono text-sm shadow-xs"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-sm font-medium text-white shadow-sm sm:col-span-3 disabled:opacity-50"
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
