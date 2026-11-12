"use client";

/**
 * Carte d'un canal de notification owner (WhatsApp today) :
 * toggle on/off, champ de saisie du contact et bouton "Tester".
 *
 * The test goes to the SAVED number only (PR #301): the button is disabled,
 * with the reason shown, until the typed number is saved. Results are our
 * own lines (./whatsapp-test.ts), never the server's text.
 *
 * Utilisé par : notifs-panel.tsx (tuile Notifications).
 */

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import {
  whatsappTestBlock,
  whatsappTestResult,
  whatsappTestUrl,
  type WhatsappTestResult,
} from "./whatsapp-test";

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
  test,
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
  /** The Test button: `saved` is the number last loaded/saved (the only
   *  recipient the route accepts); `asUserId` scopes it to the tenant an
   *  admin is viewing. Without it, no Test button is rendered. */
  test?: { saved: string; asUserId?: string | null };
}) {
  const t = useTranslations("DashboardConfig");
  const id = useId();
  const testNoteId = `${id}-test`;
  const [testStatus, setTestStatus] = useState<"idle" | "sending">("idle");
  const [testResult, setTestResult] = useState<WhatsappTestResult | null>(null);
  const testBlock = test ? whatsappTestBlock(test.saved, value) : null;

  // Timer that clears the result line: kept in a ref so a newer test
  // cancels the older one, and cleared on unmount.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleTest = async () => {
    if (!test || testBlock || testStatus !== "idle") return;
    setTestStatus("sending");
    setTestResult(null);
    let result: WhatsappTestResult;
    try {
      const res = await fetch(whatsappTestUrl(test.asUserId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: test.saved }),
      });
      result = whatsappTestResult(res.status, await res.json().catch(() => null), res.headers.get("Retry-After"));
    } catch {
      result = { key: "whatsappTestFailed" };
    }
    setTestStatus("idle");
    setTestResult(result);
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setTestResult(null), 8000);
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${
        on
          ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]"
          : "border-[#cbd5e1] bg-white hover:border-[#22d3ee]/30 hover:shadow-[0_2px_12px_-4px_rgba(34,211,238,0.2)]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
            style={{
              backgroundColor: on ? color : "#f1f5f9",
              color: on ? "white" : "#94a3b8",
              boxShadow:
                on ? `0 4px 16px -4px ${color}66` : "none",
            }}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#18181b]">
              {label}
            </p>
            <p className="text-[11px] text-[#475569]">
              {on ? (
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

        {/* 44px hit area around the 28px track. The knob moves with
            logical translate classes so it stays inside the track in RTL. */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t("wowToggleAria", { action: on ? t("wowToggleDisable") : t("wowToggleEnable"), label })}
          onClick={() => onToggle(!on)}
          className="group inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] focus-visible:ring-offset-2"
        >
          <span
            aria-hidden
            data-switch-track
            className={`relative inline-flex h-7 w-12 items-center rounded-full p-0.5 transition-all duration-300 ${
              on
                ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_16px_-2px_rgba(34,211,238,0.6)]"
                : "bg-[#94a3b8] group-hover:bg-[#64748b]"
            }`}
          >
            <span
              aria-hidden
              data-switch-knob
              className={`block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                on ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
              }`}
            />
          </span>
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={placeholder}
          disabled={!on}
          dir="ltr"
          aria-label={label}
          aria-describedby={test ? testNoteId : undefined}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#e2e8f0] bg-white/80 px-3 py-2 text-left font-mono text-xs text-[#18181b] transition-all focus:border-[#0e7490] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15 disabled:cursor-not-allowed disabled:opacity-40"
        />
        {test && (
          <button
            type="button"
            onClick={handleTest}
            disabled={testBlock !== null || testStatus !== "idle"}
            aria-label={t("wowTestAria", { label })}
            aria-describedby={testNoteId}
            data-test-block={testBlock ?? undefined}
            className="group inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#0e7490]/30 bg-white px-3 py-2 text-xs font-semibold text-[#0e7490] transition-all hover:border-[#0e7490] hover:bg-[#ecfeff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#0e7490]/30 disabled:hover:bg-white"
          >
            {testStatus === "sending" ? (
              <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 motion-safe:animate-spin">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 rtl:-scale-x-100">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
            {testStatus === "sending" ? t("wowTestSending") : t("wowTestButton")}
          </button>
        )}
      </div>

      {test && (
        <p id={testNoteId} aria-live="polite" className="text-[11px] leading-relaxed text-[#475569] empty:hidden">
          {testResult ? (
            <span
              data-test-result={testResult.key}
              className={testResult.key === "whatsappTestSent" ? "font-medium text-[#047857]" : "font-medium text-[#991b1b]"}
            >
              {t(testResult.key, { number: test.saved, minutes: testResult.minutes ?? 0 })}
            </span>
          ) : testBlock ? (
            <span data-test-block-reason={testBlock}>{t(testBlock)}</span>
          ) : null}
        </p>
      )}
      {hint && !testResult && (
        <p className="text-[11px] text-[#475569]">{hint}</p>
      )}
    </div>
  );
}
