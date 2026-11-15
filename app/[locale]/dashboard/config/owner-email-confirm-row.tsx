"use client";

/**
 * The confirmation row of the owner recap email card (verified contacts N2):
 * the state of the SAVED address ("To confirm" / "Confirmed on {date}" /
 * "Confirmed"), "Send a code", then a 6-digit code field and "Confirm".
 *
 * Enforcement is OFF: recaps are sent either way, so "To confirm" is a
 * neutral state (no error colour) and no line says recaps stop.
 * Rules and API mapping: ./owner-email-confirm.ts. Used by owner-email-card.tsx.
 */

import { useEffect, useId, useRef, useState } from "react";

import { normalizeOwnerEmail, type OwnerEmailSettings } from "./owner-email";
import {
  CODE_INPUT_MAX_LENGTH,
  cleanCode,
  confirmBadge,
  confirmCodeOutcome,
  confirmSendBlock,
  confirmSubmitBlock,
  ownerEmailCodeUrl,
  ownerEmailConfirmUrl,
  sendCodeOutcome,
  type ConfirmErrorKey,
  type RecapEmailConfirmation,
} from "./owner-email-confirm";
import type { Translator } from "./types";

type Feedback = { key: ConfirmErrorKey; minutes?: number; resend?: boolean } | null;

export function OwnerEmailConfirmRow({
  value,
  base,
  confirmation,
  onConfirmation,
  reloadConfirmation,
  locale,
  asUserId,
  t,
  initialPhase = "idle",
  initialFeedback = null,
}: {
  value: OwnerEmailSettings;
  base: OwnerEmailSettings;
  /** The SAVED address's state from the last GET (null: nothing saved). */
  confirmation: RecapEmailConfirmation;
  onConfirmation: (next: RecapEmailConfirmation) => void;
  /** Re-reads the GET (after already_confirmed). */
  reloadConfirmation: () => void;
  locale: string;
  /** Admin on a tenant page: all three calls target that tenant. */
  asUserId?: string | null;
  t: Translator;
  /** Tests only: render a given step statically. */
  initialPhase?: "idle" | "sent";
  initialFeedback?: Feedback;
}) {
  const id = useId();
  const codeId = `${id}-code`;
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;
  const sendNoteId = `${id}-send-note`;

  const [phase, setPhase] = useState<"idle" | "sent">(initialPhase);
  const [minutes, setMinutes] = useState(10);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"none" | "sending" | "confirming">("none");
  const [feedback, setFeedback] = useState<Feedback>(initialFeedback);
  const [done, setDone] = useState(false);
  const codeRef = useRef<HTMLInputElement | null>(null);

  // A saved address change kills any code sent to the old one (#348): back to the start.
  const savedKey = normalizeOwnerEmail(base.ownerRecapEmail);
  const lastSaved = useRef(savedKey);
  useEffect(() => {
    if (lastSaved.current === savedKey) return;
    lastSaved.current = savedKey;
    setPhase("idle");
    setCode("");
    setFeedback(null);
    setDone(false);
  }, [savedKey]);

  const badge = confirmBadge(confirmation, locale);
  if (!badge) return null;
  const confirmed = confirmation?.state === "confirmed";
  const sendBlock = confirmSendBlock(base, value);
  const submitBlock = confirmSubmitBlock(code);

  const send = async () => {
    if (sendBlock || busy !== "none") return;
    setBusy("sending");
    setFeedback(null);
    let outcome;
    try {
      const res = await fetch(ownerEmailCodeUrl(asUserId), { method: "POST" });
      outcome = sendCodeOutcome(res.status, await res.json().catch(() => null), res.headers.get("Retry-After"));
    } catch {
      outcome = sendCodeOutcome(0, null);
    }
    setBusy("none");
    if (outcome.kind === "sent") {
      setMinutes(outcome.minutes);
      setCode("");
      setPhase("sent");
      requestAnimationFrame(() => codeRef.current?.focus());
    } else if (outcome.kind === "alreadyConfirmed") {
      setPhase("idle");
      onConfirmation({ state: "confirmed" });
      reloadConfirmation();
    } else {
      setFeedback({ key: outcome.key, minutes: outcome.minutes });
    }
  };

  const submit = async () => {
    if (submitBlock || busy !== "none") return;
    setBusy("confirming");
    setFeedback(null);
    let outcome;
    try {
      const res = await fetch(ownerEmailConfirmUrl(asUserId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanCode(code) }),
      });
      outcome = confirmCodeOutcome(res.status, await res.json().catch(() => null));
    } catch {
      outcome = confirmCodeOutcome(0, null);
    }
    setBusy("none");
    if (outcome.kind === "confirmed") {
      setPhase("idle");
      setCode("");
      setDone(true);
      onConfirmation(outcome.confirmation);
    } else {
      setFeedback({ key: outcome.key, resend: outcome.resend });
      if (outcome.resend) setCode("");
      else requestAnimationFrame(() => codeRef.current?.select());
    }
  };

  const sendLabel = busy === "sending"
    ? t("ownerEmailConfirmSending")
    : phase === "sent" || feedback?.resend
      ? t("ownerEmailConfirmResend")
      : t("ownerEmailConfirmSend");

  const btn =
    "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div data-confirm-row data-confirm-phase={phase} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-confirm-state={badge.key}
          className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
            confirmed ? "border-[#0e7490]/30 bg-[#ecfeff] text-[#0e7490]" : "border-[#cbd5e1] bg-[#f8fafc] text-[#334155]"
          }`}
        >
          {confirmed ? (
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          )}
          {badge.key === "ownerEmailConfirmStateConfirmedOn" ? t(badge.key, { date: badge.date }) : t(badge.key)}
        </span>
        {!confirmed && (
          <button
            type="button"
            data-action="send-code"
            onClick={send}
            disabled={sendBlock !== null || busy !== "none"}
            aria-describedby={sendNoteId}
            className={`${btn} border border-[#be185d]/30 bg-white text-[#be185d] hover:border-[#be185d] hover:bg-[#fdf2f8] disabled:hover:border-[#be185d]/30 disabled:hover:bg-white`}
          >
            {sendLabel}
          </button>
        )}
      </div>

      {!confirmed && (
        <p id={sendNoteId} className="text-[11px] leading-relaxed text-[#475569] empty:hidden">
          {sendBlock ? (
            <span data-block={sendBlock}>{t(sendBlock)}</span>
          ) : asUserId ? (
            // Pending the design lead's call: keep or drop.
            <span data-admin-hint>{t("ownerEmailConfirmAdminHint")}</span>
          ) : null}
        </p>
      )}

      {!confirmed && phase === "sent" && sendBlock === null && (
        <div className="flex flex-col gap-1.5">
          <p id={noteId} aria-live="polite" data-sent-note className="text-[11px] leading-relaxed text-[#334155]">
            {t("ownerEmailConfirmSentTo", { email: base.ownerRecapEmail, minutes })}
          </p>
          <label htmlFor={codeId} className="text-xs font-semibold text-[#334155]">
            {t("ownerEmailConfirmCodeLabel")}
          </label>
          <div className="flex gap-2">
            <input
              ref={codeRef}
              id={codeId}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={CODE_INPUT_MAX_LENGTH}
              dir="ltr"
              spellCheck={false}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (feedback && !feedback.resend) setFeedback(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-invalid={feedback?.key === "ownerEmailConfirmErrInvalidCode" || undefined}
              aria-describedby={[noteId, feedback ? errorId : null].filter(Boolean).join(" ")}
              className={`min-h-11 w-36 rounded-xl border bg-white/80 px-3 py-2 text-left font-mono text-base tracking-[0.3em] text-[#18181b] tabular-nums transition-all focus:bg-white focus:outline-none focus:ring-4 ${
                feedback?.key === "ownerEmailConfirmErrInvalidCode"
                  ? "border-[#dc2626] focus:border-[#dc2626] focus:ring-[#dc2626]/15"
                  : "border-[#e2e8f0] focus:border-[#0e7490] focus:ring-[#0e7490]/15"
              }`}
            />
            <button
              type="button"
              data-action="confirm-code"
              onClick={submit}
              disabled={submitBlock !== null || busy !== "none"}
              className={`${btn} bg-[#be185d] text-white hover:bg-[#9d174d]`}
            >
              {busy === "confirming" ? t("ownerEmailConfirmSubmitting") : t("ownerEmailConfirmSubmit")}
            </button>
          </div>
          {submitBlock && !feedback && (
            <p data-block={submitBlock} className="text-[11px] leading-relaxed text-[#475569]">
              {t(submitBlock)}
            </p>
          )}
        </div>
      )}

      {feedback && (
        <p
          id={errorId}
          role="alert"
          data-confirm-error={feedback.key}
          className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1.5 text-[11px] leading-snug text-[#991b1b]"
        >
          {t(feedback.key, { minutes: feedback.minutes ?? 0 })}
        </p>
      )}

      {done && confirmed && (
        <p aria-live="polite" data-confirm-done className="text-[11px] font-medium leading-relaxed text-[#047857]">
          {t("ownerEmailConfirmDone")}
        </p>
      )}
    </div>
  );
}
