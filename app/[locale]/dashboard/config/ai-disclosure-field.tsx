"use client";

/**
 * AI disclosure in the greeting (lib/ai-disclosure.ts, EU AI Act art. 50):
 * toggle + optional custom line + a live preview of what callers hear. The
 * preview uses the SAME `effectiveGreeting` as the worker and the
 * pre-rendered opener, so it can't drift from what is actually said.
 *
 * Used by: persona-panel.tsx, right after the greeting field.
 */

import { useId } from "react";

import {
  AI_DISCLOSURE_MAX_LENGTH,
  disclosureSentence,
  effectiveGreeting,
  parseDisclosureText,
} from "@/lib/ai-disclosure";

import type { FormState, FormUpdater, Translator } from "./types";

export function AiDisclosureField({
  form,
  update,
  t,
}: {
  form: FormState;
  update: FormUpdater;
  t: Translator;
}) {
  const id = useId();
  const on = form.aiDisclosureEnabled !== false;
  const text = form.aiDisclosureText ?? "";
  const parsed = parseDisclosureText(text);
  const error = parsed.ok ? null : parsed.error;
  const heard = effectiveGreeting(
    {
      greetingInstructions: form.greetingInstructions,
      agentName: form.agentName,
      primaryLanguage: form.primaryLanguage,
      aiDisclosureEnabled: on,
      aiDisclosureText: parsed.ok ? parsed.value : "",
    },
    form.business?.identity?.name ?? "",
  );

  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={`${id}-label`} className="text-sm font-semibold text-[#18181b]">
            {t("aiDisclosureLabel")}
          </p>
          <p className="mt-0.5 text-[11px] text-[#475569]">{t("aiDisclosureHint")}</p>
        </div>
        <button
          type="button"
          role="switch"
          dir="ltr"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          onClick={() => update("aiDisclosureEnabled", !on)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2 ${
            on ? "bg-[#0e7490]" : "bg-[#94a3b8]"
          }`}
        >
          <span
            aria-hidden
            className={`block h-6 w-6 rounded-full bg-white shadow-md transition-transform ${
              on ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {on ? (
        <div className="mt-3">
          <label htmlFor={`${id}-text`} className="mb-1 flex items-baseline gap-2 text-[11px] font-semibold text-[#334155]">
            {t("aiDisclosureTextLabel")}
            <span className="font-normal text-[#94a3b8]">{t("wowOptional")}</span>
          </label>
          <input
            id={`${id}-text`}
            type="text"
            value={text}
            onChange={(e) => update("aiDisclosureText", e.target.value)}
            placeholder={disclosureSentence(form.primaryLanguage, form.agentName)}
            maxLength={AI_DISCLOSURE_MAX_LENGTH + 20}
            aria-invalid={!!error}
            aria-describedby={`${id}-err`}
            className={`w-full rounded-2xl border bg-white/80 px-4 py-2.5 text-sm text-[#18181b] focus:outline-none focus:ring-4 ${
              error ? "border-red-400 focus:ring-red-200" : "border-[#e2e8f0] focus:border-[#0e7490] focus:ring-[#0e7490]/15"
            }`}
          />
          <p id={`${id}-err`} aria-live="polite" className="mt-1 min-h-[1rem] text-[11px] text-red-600">
            {error === "ai_disclosure_must_mention_ai"
              ? t("aiDisclosureMustMentionAi")
              : error === "invalid_ai_disclosure_text"
                ? t("aiDisclosureTooLong", { max: AI_DISCLOSURE_MAX_LENGTH })
                : ""}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-[#fffbeb] px-3 py-2 text-[11px] text-[#92400e]">{t("aiDisclosureOffNote")}</p>
      )}

      {heard && (
        <div className="mt-2 rounded-xl bg-[#ecfeff]/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0e7490]">{t("aiDisclosurePreview")}</p>
          {/* dir="auto": the greeting's language can differ from the UI's
              (French greeting in the Hebrew dashboard). */}
          <p dir="auto" className="mt-0.5 text-[13px] italic text-[#18181b]">{heard}</p>
        </div>
      )}
    </div>
  );
}
