"use client";

/**
 * Persona brick — the ONE "who answers" screen (spec §3), used as is by the
 * receptionist and by outbound agents. Edits a `Persona` (lib/persona/contract)
 * and hands every valid change back through `onChange` (mergePersona).
 *
 *   Level 1: agent name, main language, first sentence (Automatic | My
 *            sentence) with the live "Callers will hear" preview.
 *   Level 2, <MoreSettings>: other spoken languages and, on outbound, the
 *            AI disclosure: shown to tenants only once their flag
 *            (LANGUAGES_ / OUTBOUND_DISCLOSURE_TENANT_EDITABLE) is on.
 *   Level 3, developer mode: the variables usable in the first sentence,
 *            as click-to-insert chips (outbound only: the receptionist has
 *            none, so no section).
 *
 * The heard sentence comes from the side's existing single source
 * (persona-ui.ts heardGreeting), never re-implemented here.
 */

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { ChipGroup, FOCUS, HINT, LABEL, SELECTED, Segmented, ToggleRow } from "@/components/bricks/controls";
import { AdminBadge } from "@/app/[locale]/dashboard/config/shared-ui";
import { MoreSettings } from "@/components/bricks/MoreSettings";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";
import { AI_DISCLOSURE_MAX_LENGTH, parseDisclosureText } from "@/lib/ai-disclosure";
import {
  GREETING_VARIABLES,
  LANGUAGES_TENANT_EDITABLE,
  OUTBOUND_DISCLOSURE_TENANT_EDITABLE,
  PERSONA_LANGUAGES,
  mergePersona,
  type Persona,
} from "@/lib/persona/contract";

import {
  badBraces,
  heardGreeting,
  insertVariable,
  splitSentences,
  textDirection,
  variablesIn,
  type PersonaKind,
} from "./persona-ui";

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

  const variables = GREETING_VARIABLES[kind];
  // Each shown only where it does something and the viewer may change it:
  // other languages until a second-language test call; the outbound
  // disclosure until its test call (P5). Same flags as the server guards.
  const showLanguages = isAdmin || LANGUAGES_TENANT_EDITABLE;
  const showDisclosure = kind === "inbound" || isAdmin || OUTBOUND_DISCLOSURE_TENANT_EDITABLE;
  const heard = heardGreeting(value, kind, { businessName, exampleContact: EXAMPLE_CONTACT });
  // No section on a side with no variable (the receptionist has none).
  const showVariables = variables.length > 0 && (isAdmin || dev.on);

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
        {value.greeting.mode === "custom" && (
          <GreetingChecks text={value.greeting.text} allowed={variables} />
        )}
        <div className="mt-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5" aria-live="polite">
          <p className="text-xs font-semibold text-[#475569]">
            {kind === "outbound" ? t("previewTitleOutbound") : t("previewTitle")}
          </p>
          {heard ? (
            // Its own paragraph, direction from its first strong character
            // (computed: dir="auto" would skip the isolated parts); each
            // sentence isolated (the customer's and the disclosure may be in
            // different scripts); quotes drawn outside the text.
            <p dir={textDirection(heard)} className="mt-1 text-sm text-[#18181b]">
              <span aria-hidden>“</span>
              {splitSentences(heard).map((part, i) => (
                <span key={i}>
                  {i > 0 && " "}
                  <bdi dir="auto">{part}</bdi>
                </span>
              ))}
              <span aria-hidden>”</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-[#475569]">
              {kind === "outbound" && value.aiDisclosure.enabled ? t("previewAutoWithDisclosure") : t("previewAuto")}
            </p>
          )}
        </div>
      </div>

      {/* ── Level 2 ─────────────────────────────────────────── */}
      {(showLanguages || showDisclosure) && (
        <MoreSettings>
          {showLanguages && <OtherLanguages value={value} apply={apply} adminOnly={!LANGUAGES_TENANT_EDITABLE} />}
          {showDisclosure && <DisclosureFields value={value} apply={apply} />}
        </MoreSettings>
      )}

      {/* ── Level 3 ─────────────────────────────────────────── */}
      {showVariables && (
        <MoreSettings level={3}>
          <h4 className="text-sm font-semibold text-[#18181b]">{t("variablesTitle")}</h4>
          <p className={HINT}>{t("variablesHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {variables.map((v) => (
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
        </MoreSettings>
      )}
    </div>
  );
}

/** Under the sentence: what each variable becomes, and any brace that would be read aloud. */
function GreetingChecks({ text, allowed }: { text: string; allowed: readonly string[] }) {
  const t = useTranslations("PersonaBrick");
  const used = variablesIn(text, allowed);
  const bad = badBraces(text, allowed);
  if (!used.length && !bad.length) return null;
  return (
    <div className="mt-1.5 space-y-1 text-xs">
      {used.map((v) => (
        <p key={v} className="text-[#475569]">
          {t("variableExplained", { token: v, meaning: t(`variableMeaning.${v.replace(/[{}\s]/g, "")}`) })}
        </p>
      ))}
      {bad.length > 0 && (
        <p role="alert" className="font-semibold text-[#b91c1c]">
          {t("badBraces", { tokens: bad.join(" ") })}
        </p>
      )}
    </div>
  );
}

/** Other languages the agent may switch to (toggle chips; never the main one). */
function OtherLanguages({
  value,
  apply,
  adminOnly,
}: {
  value: Persona;
  apply: (patch: Record<string, unknown>) => void;
  adminOnly: boolean;
}) {
  const t = useTranslations("PersonaBrick");
  const labelId = useId();
  const options = PERSONA_LANGUAGES.filter((l) => l !== value.primaryLanguage);
  return (
    <div>
      <div className="flex items-center gap-2">
        <p id={labelId} className={LABEL}>
          {t("languagesLabel")}
        </p>
        {adminOnly && <AdminBadge size="xs" />}
      </div>
      <p className={HINT}>{t("languagesHint")}</p>
      <div role="group" aria-labelledby={labelId} className="mt-2 flex flex-wrap gap-2">
        {options.map((l) => {
          const on = value.languages.includes(l);
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              onClick={() => apply({ languages: on ? value.languages.filter((x) => x !== l) : [...value.languages, l] })}
              className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors duration-150 ${FOCUS} ${
                on ? SELECTED : "border-[#e2e8f0] bg-white text-[#18181b] hover:border-[#be185d]/40"
              }`}
            >
              {LANGUAGE_NAME[l]}
            </button>
          );
        })}
      </div>
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
