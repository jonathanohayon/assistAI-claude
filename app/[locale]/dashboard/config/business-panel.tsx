"use client";

/**
 * Tuile "Business" : structure métier du tenant. Assemble dans l'ordre :
 * - bouton + wizard "Remplir depuis mon site web" (WebsiteScanWizard)
 * - IdentitySection (nom, tagline, email + rappels téléphone/langue)
 * - CentresSection (centres + horaires, voir centres-section.tsx)
 * - CentresRulesSection (règles centres/jours STRICT injectées au prompt)
 * - ServicesSection (soins & tarifs, voir services-section.tsx)
 * - KnowledgeBaseSection (base de connaissances vente/expertise)
 *
 * Utilisé par : config-form.tsx (workspace de la tuile `business`).
 */

import { useState } from "react";

import { WebsiteScanWizard } from "../website-scan-wizard";
import { CentresSection } from "./centres-section";
import { EMAIL_RE } from "./formatting";
import { ServicesSection } from "./services-section";
import type {
  BusinessConfig,
  FormState,
  FormUpdater,
  Translator,
} from "./types";

export function BusinessPanel({
  form,
  update,
  t,
}: {
  form: FormState;
  update: FormUpdater;
  t: Translator;
}) {
  const business = form.business;
  const patch = (partial: Partial<BusinessConfig>) =>
    update("business", { ...business, ...partial });

  const [scanOpen, setScanOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* Auto-remplissage depuis le site web du tenant (plusieurs sous-agents). */}
      <button
        type="button"
        onClick={() => setScanOpen(true)}
        className="group flex items-center justify-between gap-3 rounded-2xl border border-dashed border-[#c4b5fd] bg-gradient-to-br from-[#faf5ff] to-[#f5f3ff] px-4 py-3.5 text-left transition hover:border-[#a78bfa] hover:shadow-sm"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] to-[#7c3aed] text-white shadow-sm">
            ✨
          </span>
          <span>
            <span className="block text-sm font-extrabold tracking-tight text-[#4c1d95]">
              {t("scanWebsiteTitle")}
            </span>
            <span className="block text-[12px] text-[#7c3aed]/80">
              {t("scanWebsiteSubtitle")}
            </span>
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-white/70 px-3 py-1.5 text-[12px] font-bold text-[#7c3aed] transition group-hover:bg-white">
          {t("scanWebsiteCta")}
        </span>
      </button>

      <WebsiteScanWizard
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        existingBusiness={business}
        onApply={(nextBusiness, primaryLanguage) => {
          update("business", nextBusiness);
          if (primaryLanguage) update("primaryLanguage", primaryLanguage);
        }}
      />

      <IdentitySection
        identity={business.identity}
        ownerWhatsapp={form.ownerWhatsapp}
        primaryLanguage={form.primaryLanguage}
        onChange={(identity) => patch({ identity })}
        t={t}
      />
      <CentresSection
        centres={business.centres}
        onChange={(centres) => patch({ centres })}
        t={t}
      />
      <CentresRulesSection
        value={business.centresRules ?? ""}
        onChange={(centresRules) => patch({ centresRules })}
        t={t}
      />
      <ServicesSection
        services={business.services}
        centres={business.centres}
        onChange={(services) => patch({ services })}
        t={t}
      />
      <KnowledgeBaseSection
        value={business.knowledgeBase ?? ""}
        onChange={(knowledgeBase) => patch({ knowledgeBase })}
        t={t}
      />
    </div>
  );
}

// ─── CentresRules ────────────────────────────────────────────────────────

const CENTRES_RULES_MAX = 4000;

const CENTRES_RULES_EXAMPLE = `### Ouverture par jour
- Lundi → **uniquement Ashdod** (Jérusalem et Natanya fermés ce jour-là)
- Mercredi → **uniquement Natanya** (les autres centres sont fermés)
- Autres jours (mardi, jeudi, vendredi, samedi, dimanche) → **uniquement Jérusalem**

### Centre par défaut
Si la cliente ne précise pas le centre, propose celui qui correspond au jour qu'elle demande — NE PAS proposer un autre centre pour ce jour-là.

### Vérification
Avant CHAQUE appel à check_availability, calcule mentalement le jour de la semaine de la date demandée et vérifie qu'il correspond au bon centre. Si non, propose la prochaine date du bon jour.`;

function CentresRulesSection({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  t: Translator;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const hasContent = value.trim().length > 0;
  const charCount = value.length;
  const overBudget = charCount > CENTRES_RULES_MAX;

  const insertExample = () => {
    onChange(
      hasContent ? `${value.trimEnd()}\n\n${CENTRES_RULES_EXAMPLE}` : CENTRES_RULES_EXAMPLE,
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#fef3c7]/40 to-white shadow-sm">
      <header className="border-b border-[#e2e8f0]/70 bg-white/60 px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#dc2626] to-[#b45309] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden
              >
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[#18181b]">
                {t("businessRulesTitle")}
              </h3>
              <p className="text-[11px] text-[#64748b]">
                {t("businessRulesSubtitlePre")}{" "}
                <code className="rounded bg-[#fef3c7]/70 px-1 font-mono text-[10px]">
                  Centers and Days Rules (STRICT)
                </code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-white px-3 text-[11px] font-medium text-[#475569] transition hover:bg-[#fef3c7]/40"
          >
            {showHelp ? t("businessRulesHelpHide") : t("businessRulesHelpToggle")}
          </button>
        </div>
      </header>

      <div className="px-5 py-4">
        {showHelp && (
          <div className="mb-3 rounded-xl border border-[#fde68a] bg-[#fffbeb]/80 px-4 py-3 text-[12px] leading-relaxed text-[#92400e]">
            <p className="font-semibold">{t("businessRulesHelpUseCase")}</p>
            <p className="mt-1">{t("businessRulesHelpBody")}</p>
            <p className="mt-2">
              {t.rich("businessRulesHelpInjected", {
                strong: (chunks) => <strong>{chunks}</strong>,
                em: (chunks) => <em>{chunks}</em>,
              })}
            </p>
            <button
              type="button"
              onClick={insertExample}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#dc2626] px-3.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#b91c1c]"
            >
              {t("businessRulesInsertExample")}
            </button>
          </div>
        )}

        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("businessRulesPlaceholder")}
          rows={Math.max(6, Math.min(20, value.split("\n").length + 1))}
          className={`w-full resize-y rounded-xl border bg-white px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-[#18181b] shadow-inner transition placeholder:text-[#cbd5e1] focus:outline-none focus:ring-2 ${
            overBudget
              ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
              : "border-[#e2e8f0] focus:border-[#dc2626]/60 focus:ring-[#dc2626]/20"
          }`}
          aria-describedby="centres-rules-help"
        />

        <div
          id="centres-rules-help"
          className="mt-2 flex items-center justify-between gap-3 text-[11px]"
        >
          <p className="text-[#64748b]">
            {hasContent
              ? t("businessRulesActiveNote")
              : t("businessRulesEmptyNote")}
          </p>
          <p
            className={`font-mono ${
              overBudget ? "font-semibold text-red-600" : "text-[#94a3b8]"
            }`}
          >
            {charCount.toLocaleString()} / {CENTRES_RULES_MAX.toLocaleString()}
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── KnowledgeBase ───────────────────────────────────────────────────────

const KNOWLEDGE_BASE_MAX = 6000;

// Base de connaissances vente/expertise — texte libre (markdown) rempli par le
// scan du site (corps de métier, descriptions détaillées, détails techniques,
// arguments de vente) et éditable ici. Injecté dans le system prompt.
function KnowledgeBaseSection({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  t: Translator;
}) {
  const hasContent = value.trim().length > 0;
  const charCount = value.length;
  const overBudget = charCount > KNOWLEDGE_BASE_MAX;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-[#ecfeff]/50 to-white shadow-sm">
      <header className="border-b border-[#e2e8f0]/70 bg-white/60 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0891b2] to-[#0e7490] text-white shadow-sm">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            </svg>
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[#18181b]">
              {t("knowledgeBaseTitle")}
            </h3>
            <p className="text-[11px] text-[#64748b]">
              {t("knowledgeBaseSubtitle")}
            </p>
          </div>
        </div>
      </header>

      <div className="px-5 py-4">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("knowledgeBasePlaceholder")}
          rows={Math.max(6, Math.min(24, value.split("\n").length + 1))}
          className={`w-full resize-y rounded-xl border bg-white px-3.5 py-2.5 text-[12px] leading-relaxed text-[#18181b] shadow-inner transition placeholder:text-[#cbd5e1] focus:outline-none focus:ring-2 ${
            overBudget
              ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
              : "border-[#e2e8f0] focus:border-[#0e7490]/60 focus:ring-[#0e7490]/20"
          }`}
        />
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
          <p className="text-[#64748b]">
            {hasContent
              ? t("knowledgeBaseActiveNote")
              : t("knowledgeBaseEmptyNote")}
          </p>
          <p
            className={`font-mono ${
              overBudget ? "font-semibold text-red-600" : "text-[#94a3b8]"
            }`}
          >
            {charCount.toLocaleString()} / {KNOWLEDGE_BASE_MAX.toLocaleString()}
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Identity ────────────────────────────────────────────────────────────

function IdentitySection({
  identity,
  ownerWhatsapp,
  primaryLanguage,
  onChange,
  t,
}: {
  identity: BusinessConfig["identity"];
  ownerWhatsapp: string;
  primaryLanguage: string;
  onChange: (identity: BusinessConfig["identity"]) => void;
  t: Translator;
}) {
  const [emailError, setEmailError] = useState(false);
  const setField = <K extends keyof BusinessConfig["identity"]>(
    key: K,
    value: BusinessConfig["identity"][K],
  ) => onChange({ ...identity, [key]: value });

  return (
    <section
      className="anim-fade-up overflow-hidden rounded-2xl border border-[#fde68a]/60 bg-gradient-to-br from-[#fff7ed] to-white shadow-sm"
      style={{ animationDelay: "60ms" }}
    >
      <header className="flex items-center gap-3 border-b border-[#fde68a]/40 px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] text-white shadow-md">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-extrabold tracking-tight text-[#18181b]">
            {t("businessIdentityTitle")}
          </h3>
          <p className="text-[11px] text-[#92400e]">
            {t("businessIdentitySubtitle")}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 px-5 py-5">
        <IdentityField
          label={t("businessIdentityNameLabel")}
          icon={
            <>
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4a1 1 0 0 1-1-1v-5h-4v5a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2z" />
            </>
          }
        >
          <input
            type="text"
            value={identity.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder={t("businessIdentityNamePlaceholder")}
            className="w-full min-h-[44px] rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
          />
        </IdentityField>

        <IdentityField
          label={t("businessIdentityTaglineLabel")}
          icon={
            <>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
            </>
          }
        >
          <textarea
            value={identity.tagline}
            rows={2}
            onChange={(e) => setField("tagline", e.target.value)}
            placeholder={t("businessIdentityTaglinePlaceholder")}
            className="w-full resize-y rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
          />
        </IdentityField>

        <IdentityField
          label={t("businessIdentityEmailLabel")}
          icon={
            <>
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <polyline points="22,6 12,13 2,6" />
            </>
          }
        >
          <input
            type="email"
            value={identity.email}
            onChange={(e) => {
              setField("email", e.target.value);
              if (emailError) setEmailError(false);
            }}
            onBlur={() =>
              setEmailError(
                identity.email.length > 0 && !EMAIL_RE.test(identity.email),
              )
            }
            placeholder={t("businessIdentityEmailPlaceholder")}
            className={`w-full min-h-[44px] rounded-xl border bg-white px-3.5 py-2.5 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:outline-none focus:ring-4 ${
              emailError
                ? "border-[#dc2626] focus:border-[#dc2626] focus:ring-[#dc2626]/15"
                : "border-[#e2e8f0] focus:border-[#f59e0b] focus:ring-[#f59e0b]/15"
            }`}
            aria-invalid={emailError}
          />
          {emailError && (
            <p className="mt-1 text-[11px] font-medium text-[#dc2626]">
              {t("businessIdentityEmailInvalid")}
            </p>
          )}
        </IdentityField>

        <div className="mt-1 grid grid-cols-1 gap-2 rounded-xl border border-[#e2e8f0] bg-white/60 px-3.5 py-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-[11px] text-[#475569]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#0e7490]" aria-hidden>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="font-mono">{ownerWhatsapp || "—"}</span>
            <span className="ml-auto text-[10px] text-[#94a3b8]">
              {t("businessIdentityPhoneEditIn")} <span className="font-semibold text-[#0e7490]">{t("businessIdentityPhoneEditTarget")}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[#475569]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#0e7490]" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span className="font-mono uppercase">{primaryLanguage}</span>
            <span className="ml-auto text-[10px] text-[#94a3b8]">
              {t("businessIdentityPhoneEditIn")} <span className="font-semibold text-[#0e7490]">{t("businessIdentityLangEditTarget")}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function IdentityField({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#78350f]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-[#b45309]" aria-hidden>
          {icon}
        </svg>
        {label}
      </label>
      {children}
    </div>
  );
}
