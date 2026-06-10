"use client";

/**
 * Carte d'un canal de notification owner (WhatsApp / Email / SMS) :
 * toggle on/off, champ de saisie du contact et bouton "Tester" qui POST
 * {to: value} sur testEndpoint (statuts envoi/envoyé/erreur auto-resetés).
 *
 * Utilisé par : notifs-panel.tsx (tuile Notifications).
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

export function NotifChannelCard({
  label,
  icon,
  color,
  on,
  onToggle,
  value,
  onChangeValue,
  placeholder,
  inputType,
  hint,
  comingSoon = false,
  testEndpoint,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  value: string;
  onChangeValue: (v: string) => void;
  placeholder: string;
  inputType: string;
  hint?: string;
  comingSoon?: boolean;
  /** Si fourni, POST {to: value} sur cet endpoint quand l'utilisateur
   *  clique sur Tester. Sans endpoint, le bouton reste désactivé (les
   *  canaux "coming soon" SMS/Email tombent sur cette branche). */
  testEndpoint?: string;
}) {
  const t = useTranslations("DashboardConfig");
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [testError, setTestError] = useState<string | null>(null);

  // Timer de retour à "idle" après un test : conservé dans un ref pour
  // pouvoir l'annuler avant d'en programmer un nouveau (sinon un ancien
  // timer peut écraser le statut d'un test plus récent) et le nettoyer
  // au démontage du composant.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const scheduleStatusReset = (delayMs: number) => {
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setTestStatus("idle");
      setTestError(null);
    }, delayMs);
  };

  const handleTest = async () => {
    if (
      !on ||
      testStatus !== "idle" ||
      comingSoon ||
      !testEndpoint ||
      !value.trim()
    )
      return;
    setTestStatus("sending");
    setTestError(null);
    try {
      const res = await fetch(testEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: value }),
      });
      const data = (await res
        .json()
        .catch(() => ({}))) as { ok?: boolean; error?: string; hint?: string };
      if (!res.ok || !data.ok) {
        setTestStatus("error");
        setTestError(data.error ?? `HTTP ${res.status}`);
        scheduleStatusReset(6000);
        return;
      }
      setTestStatus("sent");
      scheduleStatusReset(6000);
    } catch (e) {
      setTestStatus("error");
      setTestError((e as Error).message);
      scheduleStatusReset(6000);
    }
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${
        on && !comingSoon
          ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]"
          : comingSoon
            ? "border-[#e2e8f0] bg-white/50 opacity-70"
            : "border-[#cbd5e1] bg-white hover:border-[#22d3ee]/30 hover:shadow-[0_2px_12px_-4px_rgba(34,211,238,0.2)]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
            style={{
              backgroundColor: on && !comingSoon ? color : "#f1f5f9",
              color: on && !comingSoon ? "white" : "#94a3b8",
              boxShadow:
                on && !comingSoon ? `0 4px 16px -4px ${color}66` : "none",
            }}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-[#18181b]">
                {label}
              </p>
              {comingSoon && (
                <span className="shrink-0 rounded-full bg-[#f1f5f9] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#94a3b8] ring-1 ring-inset ring-[#cbd5e1]">
                  {t("wowComingSoon")}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#475569]">
              {on && !comingSoon ? (
                <span className="inline-flex items-center gap-1 font-medium text-[#0e7490]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />
                  {t("wowChannelActive")}
                </span>
              ) : (
                t("wowChannelInactive")
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on && !comingSoon}
          aria-label={t("wowToggleAria", { action: on ? t("wowToggleDisable") : t("wowToggleEnable"), label })}
          onClick={() => !comingSoon && onToggle(!on)}
          disabled={comingSoon}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
            on && !comingSoon
              ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_16px_-2px_rgba(34,211,238,0.6)]"
              : comingSoon
                ? "bg-[#e2e8f0]"
                : "bg-[#94a3b8] hover:bg-[#64748b]"
          }`}
        >
          <span
            aria-hidden
            className="block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              transform: on && !comingSoon ? "translateX(20px)" : "translateX(0)",
            }}
          />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={placeholder}
          disabled={!on || comingSoon}
          className="min-w-0 flex-1 rounded-xl border border-[#e2e8f0] bg-white/80 px-3 py-2 font-mono text-xs text-[#18181b] transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="button"
          onClick={handleTest}
          disabled={
            !on ||
            testStatus !== "idle" ||
            comingSoon ||
            !testEndpoint ||
            !value.trim()
          }
          aria-label={t("wowTestAria", { label })}
          className={`group inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
            testStatus === "sent"
              ? "border-[#22d3ee]/40 bg-[#ecfeff] text-[#0e7490]"
              : testStatus === "error"
                ? "border-[#dc2626]/40 bg-[#fee2e2] text-[#991b1b]"
                : "border-[#0e7490]/30 bg-white text-[#0e7490] hover:-translate-y-0.5 hover:border-[#0e7490] hover:bg-[#ecfeff] hover:shadow-sm"
          }`}
        >
          {testStatus === "sending" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 motion-safe:animate-spin">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              {t("wowTestSending")}
            </>
          ) : testStatus === "sent" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("wowTestSent")}
            </>
          ) : testStatus === "error" ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              Échec
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {t("wowTestButton")}
            </>
          )}
        </button>
      </div>

      {testStatus === "sent" && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-2.5 py-1.5 text-[11px] font-medium leading-snug text-[#047857]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t("wowTestSuccess")}
        </p>
      )}
      {testError && (
        <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1.5 text-[11px] leading-snug text-[#991b1b]">
          {testError}
        </p>
      )}
      {hint && testStatus !== "sent" && !testError && (
        <p className="text-[11px] text-[#475569]">{hint}</p>
      )}
    </div>
  );
}
