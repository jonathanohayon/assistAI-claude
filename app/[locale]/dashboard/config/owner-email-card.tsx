"use client";

/**
 * Owner post-call recap by email: switch + address + Test, with a state
 * line in plain words. Same layout and switch as the WhatsApp card
 * (notif-channel-card.tsx), with two differences:
 *   - the switch is its own stored field (ownerRecapEmailEnabled), so
 *     turning it off keeps the address and an empty address never forces
 *     it off;
 *   - errors and test results are our own lines, never the server's text.
 *
 * Saved by the config form's save bar, like the WhatsApp number
 * (config-form.tsx, step "owner recap email"). Rules: ./owner-email.ts.
 *
 * Used by: notifs-panel.tsx.
 */

import { useEffect, useId, useRef, useState } from "react";

import {
  ownerEmailStateKey,
  ownerEmailTestBlock,
  ownerEmailTestResult,
  ownerEmailTestUrl,
  setOwnerEmailAddress,
  toggleOwnerEmail,
  type OwnerEmailErrorKey,
  type OwnerEmailSettings,
  type OwnerEmailTestResultKey,
} from "./owner-email";
import type { Translator } from "./types";

export function OwnerEmailCard({
  value,
  base,
  onChange,
  error,
  recapFeatureOn = true,
  locale,
  t,
}: {
  /** What is on screen (unsaved edits included). */
  value: OwnerEmailSettings;
  /** The last loaded/saved values. */
  base: OwnerEmailSettings;
  onChange: (next: OwnerEmailSettings) => void;
  /** The last refused save, as one of our message keys. */
  error: OwnerEmailErrorKey | null;
  /** The plan includes the owner recap (plan feature whatsapp_recap). */
  recapFeatureOn?: boolean;
  locale: string;
  t: Translator;
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const stateId = `${id}-state`;
  const errorId = `${id}-error`;
  const testNoteId = `${id}-test`;
  const on = value.ownerRecapEmailEnabled;
  const label = t("ownerEmailTitle");
  const stateKey = ownerEmailStateKey(base, value, recapFeatureOn);
  const testBlock = ownerEmailTestBlock(base, value);

  const [testStatus, setTestStatus] = useState<"idle" | "sending">("idle");
  const [testResult, setTestResult] = useState<OwnerEmailTestResultKey | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
  }, []);

  const handleTest = async () => {
    if (testBlock || testStatus !== "idle") return;
    setTestStatus("sending");
    setTestResult(null);
    let result: OwnerEmailTestResultKey;
    try {
      const res = await fetch(ownerEmailTestUrl(locale), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: base.ownerRecapEmail }),
      });
      result = ownerEmailTestResult(res.status, await res.json().catch(() => null));
    } catch {
      result = "ownerEmailTestFailed";
    }
    setTestStatus("idle");
    setTestResult(result);
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setTestResult(null), 8000);
  };

  const describedBy = [stateId, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div
      data-card="owner-email"
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${
        on
          ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]"
          : "border-[#cbd5e1] bg-white hover:border-[#22d3ee]/30 hover:shadow-[0_2px_12px_-4px_rgba(34,211,238,0.2)]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
            style={{
              background: on ? "linear-gradient(135deg,#be185d 0%,#db2777 100%)" : "#f1f5f9",
              color: on ? "white" : "#94a3b8",
              boxShadow: on ? "0 4px 16px -4px #be185d66" : "none",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#18181b]">{label}</p>
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

        {/* 44px hit area around the 28px track. */}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t("wowToggleAria", { action: on ? t("wowToggleDisable") : t("wowToggleEnable"), label })}
          onClick={() => onChange(toggleOwnerEmail(value))}
          className="group inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22d3ee] focus-visible:ring-offset-2"
        >
          <span
            className={`relative inline-flex h-7 w-12 items-center rounded-full p-0.5 transition-all duration-300 ${
              on
                ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490] shadow-[0_0_16px_-2px_rgba(34,211,238,0.6)]"
                : "bg-[#94a3b8] group-hover:bg-[#64748b]"
            }`}
          >
            <span
              aria-hidden
              className={`block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                on ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
              }`}
            />
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-xs font-semibold text-[#334155]">
          {t("ownerEmailLabel")}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            spellCheck={false}
            value={value.ownerRecapEmail}
            onChange={(e) => onChange(setOwnerEmailAddress(value, e.target.value))}
            placeholder={t("ownerEmailPlaceholder")}
            aria-invalid={error === "ownerEmailErrInvalid" || undefined}
            aria-describedby={describedBy}
            className={`min-h-11 min-w-0 flex-1 rounded-xl border bg-white/80 px-3 py-2 text-left font-mono text-sm text-[#18181b] transition-all focus:bg-white focus:outline-none focus:ring-4 ${
              error === "ownerEmailErrInvalid"
                ? "border-[#dc2626] focus:border-[#dc2626] focus:ring-[#dc2626]/15"
                : "border-[#e2e8f0] focus:border-[#0e7490] focus:ring-[#0e7490]/15"
            }`}
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={testBlock !== null || testStatus !== "idle"}
            aria-label={t("wowTestAria", { label })}
            aria-describedby={testNoteId}
            className="group inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#0e7490]/30 bg-white px-3 py-2 text-xs font-semibold text-[#0e7490] transition-all hover:border-[#0e7490] hover:bg-[#ecfeff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#0e7490]/30 disabled:hover:bg-white"
          >
            {testStatus === "sending" ? t("wowTestSending") : t("wowTestButton")}
          </button>
        </div>
      </div>

      {error && (
        <p id={errorId} role="alert" className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1.5 text-[11px] leading-snug text-[#991b1b]">
          {t(error)}
        </p>
      )}

      <p
        id={stateId}
        data-state={stateKey}
        className={`text-[11px] leading-relaxed ${
          stateKey === "ownerEmailStateOn"
            ? "font-medium text-[#0e7490]"
            : stateKey === "ownerEmailStateOff"
              ? "text-[#64748b]"
              : "font-medium text-[#9d174d]"
        }`}
      >
        {t(stateKey)}
      </p>

      <p id={testNoteId} aria-live="polite" className="text-[11px] leading-relaxed text-[#475569] empty:hidden">
        {testResult ? (
          <span
            data-test-result={testResult}
            className={testResult === "ownerEmailTestSent" ? "font-medium text-[#047857]" : "font-medium text-[#991b1b]"}
          >
            {t(testResult, { email: base.ownerRecapEmail })}
          </span>
        ) : testBlock ? (
          t(testBlock)
        ) : null}
      </p>
    </div>
  );
}
