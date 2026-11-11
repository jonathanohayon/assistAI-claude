"use client";

/**
 * Knowledge brick (S3): ONE "what the agent knows" screen, the same module
 * for the receptionist and the outbound agents.
 *
 *   Level 1: "Learn from my site" (one address + button → the one learning
 *            service, #203), the company sheet (name, locations and hours,
 *            services and prices; each line edited in place) — shared by
 *            all the account's agents — and THIS agent's instructions.
 *   Level 2, <MoreSettings>: notes, FAQ, sources (date + learn again),
 *            location rules; on outbound while the agent doesn't read the
 *            sheet yet: "What this agent learned".
 *   Level 3 (admin or developer mode): `devPanel`, given by the screen.
 *
 * The sheet belongs to the ACCOUNT and saves through
 * /api/dashboard/company-sheet (the screen sends sheetPatch); the
 * instructions stay on the agent. Tenant-safe (no supplier word).
 */

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import { WebsiteScanWizard } from "@/app/[locale]/dashboard/website-scan-wizard";
import { HINT, LABEL } from "@/components/bricks/controls";
import { MoreSettings } from "@/components/bricks/MoreSettings";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";
import type { BusinessConfig } from "@/lib/business";
import type { CompanySheet } from "@/lib/knowledge/contract";

import { learnedDate, planScan, withSource, type ScanChange, type SheetIssue } from "./knowledge-ui";
import { BUTTON, GHOST, INPUT, LearnFromSite, LearnReview, SheetCard } from "./SheetCard";

/** Outbound, while this agent still reads its own learned text (S5 off for the account). */
export interface AgentLearned {
  text: string;
  sources: string[];
  language: string;
  onChange: (next: { text: string; sources: string[] }) => void;
}

export interface KnowledgeBrickProps {
  kind: "inbound" | "outbound";
  sheet: CompanySheet;
  onSheetChange: (next: CompanySheet) => void;
  /** From the last refused sheet save (400 fields), shown under the sheet. */
  issues?: SheetIssue[];
  instructions: string;
  onInstructionsChange: (next: string) => void;
  /** The scan's suggested language (applied with the learned facts). */
  onSuggestedLanguage?: (lang: string) => void;
  /** Outbound: does this account's outbound agent read the sheet (S5)? Told by the server. */
  outboundUsesCompanySheet?: boolean;
  /** Outbound with the sheet not used yet: the agent's own learned text. */
  agentLearned?: AgentLearned;
  isAdmin?: boolean;
  asUserId?: string | null;
  /** Level 3 content (session preview; admin-only inheritance). */
  devPanel?: ReactNode;
}

const NOTES_MAX = 6000;
const RULES_MAX = 4000;

export function KnowledgeBrick({
  kind,
  sheet,
  onSheetChange,
  issues = [],
  instructions,
  onInstructionsChange,
  onSuggestedLanguage,
  outboundUsesCompanySheet = false,
  agentLearned,
  isAdmin = false,
  asUserId,
  devPanel,
}: KnowledgeBrickProps) {
  const t = useTranslations("KnowledgeBrick");
  const locale = useLocale();
  const dev = useDeveloperMode(asUserId);
  const patch = (p: Partial<CompanySheet>) => onSheetChange({ ...sheet, ...p });

  // `scanUrl` set = the scan is running for that address.
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  // A learned proposal waiting for Apply / Cancel.
  // The draft is kept: Apply re-runs the merge without the unticked lines.
  const [proposal, setProposal] = useState<{
    url: string;
    draft: BusinessConfig;
    changes: ScanChange[];
    lang: string | null;
    /** The plan's location cap from the scan result (undefined: an older server). */
    locationCap?: number;
    locationsTruncated: boolean;
  } | null>(null);
  const [manual, setManual] = useState(false);
  const instructionsId = useId();
  const notesId = useId();
  const rulesId = useId();

  const empty = !sheet.identity.name.trim() && sheet.locations.length === 0 && sheet.services.length === 0;
  const lastSource = sheet.sources[0] ?? null;
  const note = kind === "outbound" && !outboundUsesCompanySheet ? t("sheetOutboundNote") : undefined;
  const showLearned = kind === "outbound" && !outboundUsesCompanySheet && !!agentLearned;
  const showDev = !!devPanel && (isAdmin || dev.on);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Level 1 ─────────────────────────────────────────── */}
      {proposal ? (
        <LearnReview
          url={proposal.url}
          changes={proposal.changes}
          locationCapNote={proposal.locationsTruncated ? proposal.locationCap : undefined}
          onApply={(skip) => {
            const { next } = planScan(sheet, proposal.draft, skip, proposal.locationCap);
            onSheetChange({ ...next, sources: withSource(next.sources, proposal.url, new Date().toISOString()) });
            if (proposal.lang) onSuggestedLanguage?.(proposal.lang);
            setProposal(null);
          }}
          onCancel={() => setProposal(null)}
        />
      ) : (
        <LearnFromSite compact={!empty} lastSource={lastSource} onLearn={setScanUrl} onManual={empty && !manual ? () => setManual(true) : undefined} />
      )}
      <WebsiteScanWizard
        open={scanUrl !== null}
        initialUrl={scanUrl ?? undefined}
        asUserId={asUserId}
        onClose={() => setScanUrl(null)}
        existingBusiness={{ identity: sheet.identity, centres: [], services: [] }}
        onApply={() => {}}
        onDraft={(draft, lang, url, locationCap) => {
          const { changes, locationsTruncated } = planScan(sheet, draft, new Set(), locationCap);
          setProposal({ url: url || scanUrl || "", draft, changes, lang, locationCap, locationsTruncated });
        }}
      />

      {(!empty || manual) && <SheetCard sheet={sheet} onChange={onSheetChange} note={note} />}
      {issues.length > 0 && (
        <div role="alert" className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5 text-sm text-[#b91c1c]">
          <p className="font-semibold">{t("issuesTitle")}</p>
          <ul className="mt-1 list-disc ps-5">
            {issues.map((i, n) => (
              <li key={n}>{t(`issue.${i.key}`, i.params)}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor={instructionsId} className={LABEL}>
          {t("instructionsLabel")}
        </label>
        <p className={HINT}>{t("instructionsHint")}</p>
        <textarea
          id={instructionsId}
          dir="auto"
          value={instructions}
          rows={4}
          placeholder={t("instructionsPlaceholder")}
          onChange={(e) => onInstructionsChange(e.target.value)}
          className={`mt-2 py-2 ${INPUT}`}
        />
      </div>

      {/* ── Level 2 ─────────────────────────────────────────── */}
      <MoreSettings>
        <div className="flex flex-col gap-6 p-4 pt-0">
          {showLearned && agentLearned && <LearnedByAgent value={agentLearned} asUserId={asUserId} />}
          <TextBlock
            id={notesId}
            label={t("notesLabel")}
            hint={t("notesHint")}
            placeholder={t("notesPlaceholder")}
            value={sheet.notes}
            max={NOTES_MAX}
            onChange={(notes) => patch({ notes })}
          />
          <FaqEditor faq={sheet.faq} onChange={(faq) => patch({ faq })} />
          <Sources sources={sheet.sources} locale={locale} onLearnAgain={setScanUrl} />
          <TextBlock
            id={rulesId}
            label={t("rulesLabel")}
            hint={t("rulesHint")}
            placeholder={t("rulesPlaceholder")}
            value={sheet.locationRules}
            max={RULES_MAX}
            onChange={(locationRules) => patch({ locationRules })}
          />
        </div>
      </MoreSettings>

      {/* ── Level 3 ─────────────────────────────────────────── */}
      {showDev && <MoreSettings level={3}>{devPanel}</MoreSettings>}
    </div>
  );
}

function TextBlock({
  id,
  label,
  hint,
  placeholder,
  value,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("KnowledgeBrick");
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <p className={HINT}>{hint}</p>
      <textarea
        id={id}
        dir="auto"
        value={value}
        maxLength={max}
        rows={4}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-2 py-2 ${INPUT}`}
      />
      <p className="mt-1 text-end text-xs text-[#64748b]">
        {/* Numbers keep their order in a right-to-left page. */}
        <bdi dir="ltr">{t("charCount", { n: value.length, max })}</bdi>
      </p>
    </div>
  );
}

const FAQ_MAX = 50;

function FaqEditor({ faq, onChange }: { faq: CompanySheet["faq"]; onChange: (next: CompanySheet["faq"]) => void }) {
  const t = useTranslations("KnowledgeBrick");
  const set = (i: number, p: Partial<CompanySheet["faq"][number]>) => onChange(faq.map((x, n) => (n === i ? { ...x, ...p } : x)));
  return (
    <section aria-labelledby="kb-faq-title">
      <h4 id="kb-faq-title" className={LABEL}>
        {t("faqTitle")}
      </h4>
      <p className={HINT}>{t("faqHint")}</p>
      <ul className="mt-2 flex flex-col gap-3">
        {faq.map((item, i) => (
          <li key={i} className="rounded-xl border border-[#e2e8f0] bg-white p-3">
            <label className="text-xs font-semibold text-[#18181b]">
              {t("faqQuestion")}
              <input
                dir="auto"
                value={item.q}
                maxLength={300}
                onChange={(e) => set(i, { q: e.target.value })}
                className={`mt-1 min-h-11 ${INPUT}`}
              />
            </label>
            <label className="mt-2 block text-xs font-semibold text-[#18181b]">
              {t("faqAnswer")}
              <textarea
                dir="auto"
                value={item.a}
                maxLength={2000}
                rows={2}
                onChange={(e) => set(i, { a: e.target.value })}
                className={`mt-1 py-2 ${INPUT}`}
              />
            </label>
            <button
              type="button"
              onClick={() => onChange(faq.filter((_, n) => n !== i))}
              aria-label={t("faqRemoveLabel", { n: i + 1 })}
              className={`mt-2 ${GHOST} text-[#b91c1c]`}
            >
              {t("faqRemove")}
            </button>
          </li>
        ))}
      </ul>
      {faq.length < FAQ_MAX && (
        <button type="button" onClick={() => onChange([...faq, { q: "", a: "" }])} className={`mt-2 ${GHOST}`}>
          {t("faqAdd")}
        </button>
      )}
    </section>
  );
}

function Sources({
  sources,
  locale,
  onLearnAgain,
}: {
  sources: CompanySheet["sources"];
  locale: string;
  onLearnAgain: (url: string) => void;
}) {
  const t = useTranslations("KnowledgeBrick");
  return (
    <section aria-labelledby="kb-sources-title">
      <h4 id="kb-sources-title" className={LABEL}>
        {t("sourcesTitle")}
      </h4>
      {sources.length === 0 ? (
        <p className={HINT}>{t("sourcesEmpty")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {sources.map((s) => {
            const date = learnedDate(s.learnedAt, locale);
            return (
              <li key={s.url} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2">
                <div className="min-w-0">
                  <bdi dir="ltr" className="block truncate text-sm font-medium text-[#18181b]">
                    {s.url}
                  </bdi>
                  <p className="text-xs text-[#475569]">{date ? t("sourcesLearnedOn", { date }) : t("sourcesNoDate")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onLearnAgain(s.url)}
                  aria-label={t("sourcesLearnAgainLabel", { url: s.url })}
                  className={GHOST}
                >
                  {t("sourcesLearnAgain")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Outbound only, until the agent reads the sheet: its own learned text. */
function LearnedByAgent({ value, asUserId }: { value: AgentLearned; asUserId?: string | null }) {
  const t = useTranslations("KnowledgeBrick");
  const [urls, setUrls] = useState(value.sources.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const urlsId = useId();
  const textId = useId();
  const list = urls
    .split(/[\n,;]+/)
    .map((u) => u.trim())
    .filter(Boolean);

  const learn = async () => {
    if (!list.length || busy) return;
    setBusy(true);
    setError(false);
    try {
      const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
      const res = await fetch(`/api/dashboard/campaigns/learn${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: list, language: value.language || "fr" }),
      });
      const data = (await res.json().catch(() => null)) as { knowledge?: string; sources?: string[] } | null;
      if (!res.ok || !data?.knowledge) throw new Error("learn");
      value.onChange({ text: data.knowledge, sources: data.sources ?? list });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="kb-learned-title">
      <h4 id="kb-learned-title" className={LABEL}>
        {t("learnedTitle")}
      </h4>
      <p className={HINT}>{t("learnedHint")}</p>
      <label htmlFor={urlsId} className="mt-2 block text-xs font-semibold text-[#18181b]">
        {t("learnedUrls")}
      </label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <textarea
          id={urlsId}
          dir="ltr"
          value={urls}
          rows={2}
          placeholder={t("learnPlaceholder")}
          onChange={(e) => setUrls(e.target.value)}
          className={`py-2 ${INPUT}`}
        />
        <button type="button" onClick={() => void learn()} disabled={!list.length || busy} aria-busy={busy} className={BUTTON}>
          {busy ? t("learnedBusy") : t("learnedCta")}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-[#b91c1c]">
          {t("learnedError")}
        </p>
      )}
      <label htmlFor={textId} className="mt-3 block text-xs font-semibold text-[#18181b]">
        {t("learnedText")}
      </label>
      <textarea
        id={textId}
        dir="auto"
        value={value.text}
        rows={6}
        onChange={(e) => value.onChange({ text: e.target.value, sources: value.sources })}
        className={`mt-1 py-2 ${INPUT}`}
      />
    </section>
  );
}
