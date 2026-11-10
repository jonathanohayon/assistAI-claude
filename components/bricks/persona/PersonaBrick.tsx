"use client";

/**
 * Persona brick — the ONE "who answers" screen (spec §3), used as is by the
 * receptionist and by outbound agents. Edits a `Persona` (lib/persona/contract)
 * and hands every valid change back through `onChange` (mergePersona).
 *
 *   Level 1: agent name, main language, first sentence (Automatic | My
 *            sentence) with the live "Callers will hear" preview.
 *   Level 2, <MoreSettings>: the AI disclosure (inbound only until P5).
 *   Level 3, developer mode: the variables usable in the first sentence
 *            (outbound only: the receptionist has none).
 *
 * The heard sentence comes from the side's existing single source
 * (persona-ui.ts heardGreeting), never re-implemented here. The "other
 * spoken languages" control waits for P4 (no store, no engine path yet):
 * it is not shown rather than shown doing nothing.
 */

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { ChipGroup, FOCUS, HINT, LABEL, Segmented, ToggleRow } from "@/components/bricks/controls";
import { MoreSettings } from "@/components/bricks/MoreSettings";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";
import { AI_DISCLOSURE_MAX_LENGTH, parseDisclosureText } from "@/lib/ai-disclosure";
import { GREETING_VARIABLES, PERSONA_LANGUAGES, mergePersona, type Persona } from "@/lib/persona/contract";

import { heardGreeting, insertVariable, type PersonaKind } from "./persona-ui";

const INPUT =
  "w-full rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#18181b] focus:border-[#0e7490] focus:outline-none focus:ring-2 focus:ring-[#0e7490]/20";

const LANGUAGE_NAME: Record<(typeof PERSONA_LANGUAGES)[number], string> = {
  fr: "Français",
  he: "עברית",
  en: "English",
};

/** Mock contact for the outbound preview (fills the variables). */
const EXAMPLE_CONTACT = { contactName: "Dana", phoneNumber: "050 000 0000" };

export interface PersonaBrickProps {
  value: Persona;
  onChange: (next: Persona) => void;
  kind: PersonaKind;
  /** Inbound: the business name the default disclosure sentence uses. */
  businessName?: string;
  isAdmin?: boolean;
  asUserId?: string | null;
}

export function PersonaBrick({ value, onChange, kind, businessName = "", isAdmin = false, asUserId }: PersonaBrickProps) {
  const t = useTranslations("PersonaBrick");
  const dev = useDeveloperMode(asUserId);
  const nameId = useId();
  const greetingId = useId();

  const apply = (patch: Record<string, unknown>) => {
    const r = mergePersona(value, patch);
    if (r.ok) onChange(r.value);
  };

  const heard = heardGreeting(value, kind, { businessName, exampleContact: EXAMPLE_CONTACT });
  const showVariables = kind === "outbound" && (isAdmin || dev.on);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Level 1 ─────────────────────────────────────────── */}
      <div>
        <label htmlFor={nameId} className={LABEL}>
          {t("nameLabel")}
        </label>
        <p className={HINT}>{kind === "outbound" ? t("nameHintOutbound") : t("nameHint")}</p>
        <input
          id={nameId}
          dir="auto"
          value={value.name}
          maxLength={80}
          placeholder={t("namePlaceholder")}
          onChange={(e) => apply({ name: e.target.value })}
          className={`mt-2 min-h-11 ${INPUT}`}
        />
      </div>

      <ChipGroup
        label={t("languageLabel")}
        options={PERSONA_LANGUAGES.map((l) => ({ id: l, label: LANGUAGE_NAME[l] }))}
        selected={value.primaryLanguage}
        onPick={(primaryLanguage) => apply({ primaryLanguage, languages: value.languages.filter((l) => l !== primaryLanguage) })}
      />

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={LABEL}>{t("greetingLabel")}</p>
          <Segmented
            label={t("greetingLabel")}
            options={[
              { id: "auto", label: t("greetingAuto") },
              { id: "custom", label: t("greetingCustom") },
            ]}
            selected={value.greeting.mode}
            onPick={(mode) => apply({ greeting: { mode } })}
          />
        </div>
        {value.greeting.mode === "custom" && (
          <>
            <label htmlFor={greetingId} className="sr-only">
              {t("greetingCustom")}
            </label>
            <textarea
              id={greetingId}
              dir="auto"
              value={value.greeting.text}
              maxLength={1000}
              rows={3}
              placeholder={t("greetingPlaceholder")}
              onChange={(e) => apply({ greeting: { text: e.target.value } })}
              className={`mt-2 py-2 ${INPUT}`}
            />
          </>
        )}
        <div className="mt-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5" aria-live="polite">
          <p className="text-xs font-semibold text-[#475569]">
            {kind === "outbound" ? t("previewTitleOutbound") : t("previewTitle")}
          </p>
          <p className="mt-1 text-sm text-[#18181b]">
            {/* dir="auto": the sentence may not be in the page's language. */}
            {heard ? <q dir="auto">{heard}</q> : <span className="text-[#475569]">{t("previewAuto")}</span>}
          </p>
        </div>
      </div>

      {/* ── Level 2 ─────────────────────────────────────────── */}
      {kind === "inbound" && (
        <MoreSettings>
          <DisclosureFields value={value} apply={apply} />
        </MoreSettings>
      )}

      {/* ── Level 3 ─────────────────────────────────────────── */}
      {showVariables && (
        <section aria-labelledby="persona-dev-title" className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-4">
          <h3 id="persona-dev-title" className="text-sm font-semibold text-[#18181b]">
            {t("variablesTitle")}
          </h3>
          <p className={HINT}>{t("variablesHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {GREETING_VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => apply({ greeting: { mode: "custom", text: insertVariable(value.greeting.text, v) } })}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 ${FOCUS}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5 text-[#be185d]">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t(`variable.${v.replace(/[{}\s]/g, "")}`)}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** AI disclosure: switch + optional own sentence (checked on blur: it must say it's an AI). */
function DisclosureFields({ value, apply }: { value: Persona; apply: (patch: Record<string, unknown>) => void }) {
  const t = useTranslations("PersonaBrick");
  const id = useId();
  // Draft while typing: "Je suis…" doesn't mention AI yet, so validate on blur.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = draft ?? value.aiDisclosure.text;

  const commit = () => {
    if (draft === null) return;
    const r = parseDisclosureText(draft);
    if (!r.ok) {
      setError(r.error === "ai_disclosure_must_mention_ai" ? t("disclosureMustMentionAi") : t("disclosureTooLong", { max: AI_DISCLOSURE_MAX_LENGTH }));
      return;
    }
    setError(null);
    setDraft(null);
    apply({ aiDisclosure: { text: r.value } });
  };

  return (
    <>
      <ToggleRow
        label={t("disclosureLabel")}
        hint={value.aiDisclosure.enabled ? t("disclosureOn") : t("disclosureOff")}
        checked={value.aiDisclosure.enabled}
        onChange={(enabled) => apply({ aiDisclosure: { enabled } })}
      />
      {value.aiDisclosure.enabled && (
        <div>
          <label htmlFor={id} className={LABEL}>
            {t("disclosureTextLabel")}
          </label>
          <p className={HINT}>{t("disclosureTextHint")}</p>
          <input
            id={id}
            dir="auto"
            value={text}
            maxLength={AI_DISCLOSURE_MAX_LENGTH}
            placeholder={t("disclosureTextPlaceholder")}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`mt-2 min-h-11 ${INPUT}`}
          />
          {error && (
            <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-[#b91c1c]">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
