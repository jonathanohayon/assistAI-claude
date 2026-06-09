"use client";

/**
 * Wizard "Remplir depuis mon site web" — scanne le site du tenant via plusieurs
 * sous-agents LLM (endpoint NDJSON streaming /api/dashboard/scan-website) et
 * propose un écran de revue avant d'appliquer au formulaire Business.
 *
 * Flux : input URL → scan en direct (cartes agents animées) → revue (édition +
 * inclusion par section) → onApply(business, primaryLanguage?).
 *
 * Les types Business sont structurellement identiques à ceux de config-form ;
 * import type-only pour éviter tout cycle runtime.
 */

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";

import type {
  BusinessConfig,
  BusinessService,
  WeekDay,
} from "./config-form";

type AgentKey =
  | "identity"
  | "hours"
  | "location"
  | "services"
  | "languages"
  | "knowledge";
type AgentStatus = "idle" | "running" | "done" | "error";
type Step = "input" | "scanning" | "review";

interface ScanResultEvent {
  type: "result";
  business: BusinessConfig;
  suggestedPrimaryLanguage: string | null;
  confidence: Record<AgentKey, number>;
  pages: { url: string; title: string }[];
}

type StreamEvent =
  | { type: "crawl"; status: "start" }
  | { type: "crawl"; status: "done"; pages: { url: string; title: string }[] }
  | {
      type: "agent";
      agent: AgentKey;
      status: "running" | "done" | "error";
      confidence?: number;
      error?: string;
    }
  | ScanResultEvent
  | { type: "error"; message: string };

const AGENT_ORDER: AgentKey[] = [
  "identity",
  "location",
  "hours",
  "services",
  "knowledge",
  "languages",
];

const AGENT_ICON: Record<AgentKey, string> = {
  identity: "🏷️",
  location: "📍",
  hours: "🕒",
  services: "✨",
  knowledge: "📚",
  languages: "🌐",
};

const WEEKDAY_ORDER: WeekDay[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

function confidenceTier(c: number): "high" | "medium" | "low" {
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "medium";
  return "low";
}

const isEmptyBusiness = (b: BusinessConfig): boolean =>
  !b.identity.name &&
  !b.identity.tagline &&
  !b.identity.email &&
  b.centres.length === 0 &&
  b.services.length === 0;

export function WebsiteScanWizard({
  open,
  onClose,
  onApply,
  existingBusiness,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (business: BusinessConfig, primaryLanguage: string | null) => void;
  existingBusiness: BusinessConfig;
}) {
  const t = useTranslations("WebsiteScan");
  const tDays = useTranslations("DashboardConfig");

  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [fatalError, setFatalError] = useState<string | null>(null);

  const [pages, setPages] = useState<{ url: string; title: string }[]>([]);
  const [agentStatus, setAgentStatus] = useState<Record<AgentKey, AgentStatus>>(
    {
      identity: "idle",
      hours: "idle",
      location: "idle",
      services: "idle",
      languages: "idle",
      knowledge: "idle",
    },
  );
  const [agentConfidence, setAgentConfidence] = useState<
    Partial<Record<AgentKey, number>>
  >({});

  // Revue : copie éditable du draft.
  const [draft, setDraft] = useState<BusinessConfig | null>(null);
  const [suggestedLang, setSuggestedLang] = useState<string | null>(null);
  const [include, setInclude] = useState({
    identity: true,
    centres: true,
    services: true,
    knowledge: true,
    language: false,
  });
  const [mergeMode, setMergeMode] = useState<"replace" | "add">("replace");

  const abortRef = useRef<AbortController | null>(null);

  const dayLabel = useCallback(
    (d: WeekDay) => {
      const key = `businessDay${d.charAt(0).toUpperCase()}${d.slice(1)}Short`;
      return tDays(key as Parameters<typeof tDays>[0]);
    },
    [tDays],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep("input");
    setUrl("");
    setFatalError(null);
    setPages([]);
    setAgentStatus({
      identity: "idle",
      hours: "idle",
      location: "idle",
      services: "idle",
      languages: "idle",
      knowledge: "idle",
    });
    setAgentConfidence({});
    setDraft(null);
    setSuggestedLang(null);
    setInclude({
      identity: true,
      centres: true,
      services: true,
      knowledge: true,
      language: false,
    });
    setMergeMode("replace");
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleEvent = useCallback((ev: StreamEvent) => {
    switch (ev.type) {
      case "crawl":
        if (ev.status === "done") setPages(ev.pages);
        break;
      case "agent":
        setAgentStatus((s) => ({ ...s, [ev.agent]: ev.status }));
        if (ev.status === "done" && typeof ev.confidence === "number") {
          setAgentConfidence((c) => ({ ...c, [ev.agent]: ev.confidence }));
        }
        break;
      case "result": {
        setDraft(ev.business);
        setSuggestedLang(ev.suggestedPrimaryLanguage);
        // mergeMode est décidé après la fin du stream (cf. startScan) selon que
        // la config business existante est vide ou non.
        break;
      }
      case "error":
        setFatalError(ev.message);
        break;
    }
  }, []);

  const startScan = useCallback(async () => {
    if (!url.trim()) return;
    setFatalError(null);
    setStep("scanning");
    setAgentStatus({
      identity: "idle",
      hours: "idle",
      location: "idle",
      services: "idle",
      languages: "idle",
      knowledge: "idle",
    });
    const controller = new AbortController();
    abortRef.current = controller;
    let gotResult = false;
    try {
      const res = await fetch("/api/dashboard/scan-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let ev: StreamEvent;
          try {
            ev = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }
          if (ev.type === "result") gotResult = true;
          handleEvent(ev);
        }
      }
      if (gotResult) {
        // existingBusiness non vide → défaut "add" pour ne pas écraser.
        setMergeMode(isEmptyBusiness(existingBusiness) ? "replace" : "add");
        setStep("review");
      } else {
        setFatalError((e) => e ?? t("errorNoResult"));
        setStep("input");
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setFatalError(e instanceof Error ? e.message : t("errorGeneric"));
      setStep("input");
    } finally {
      abortRef.current = null;
    }
  }, [url, existingBusiness, handleEvent, t]);

  // ── Édition du draft en revue ──────────────────────────────────────────
  const patchDraft = useCallback((partial: Partial<BusinessConfig>) => {
    setDraft((d) => (d ? { ...d, ...partial } : d));
  }, []);

  const applyToForm = useCallback(() => {
    if (!draft) return;
    const base: BusinessConfig =
      mergeMode === "add"
        ? { ...existingBusiness }
        : { ...existingBusiness, identity: existingBusiness.identity };

    let identity = existingBusiness.identity;
    if (include.identity) {
      identity =
        mergeMode === "add"
          ? {
              name: existingBusiness.identity.name || draft.identity.name,
              tagline:
                existingBusiness.identity.tagline || draft.identity.tagline,
              email: existingBusiness.identity.email || draft.identity.email,
            }
          : draft.identity;
    }

    const centres = include.centres
      ? mergeMode === "add"
        ? [...existingBusiness.centres, ...draft.centres]
        : draft.centres
      : existingBusiness.centres;

    const services = include.services
      ? mergeMode === "add"
        ? [...existingBusiness.services, ...draft.services]
        : draft.services
      : existingBusiness.services;

    // Base de connaissances : en "add" on concatène à l'existant, en "replace"
    // on prend celle du scan. Si non incluse, on garde l'existante.
    const existingKb = (existingBusiness.knowledgeBase ?? "").trim();
    const draftKb = (draft.knowledgeBase ?? "").trim();
    const knowledgeBase = include.knowledge
      ? mergeMode === "add"
        ? [existingKb, draftKb].filter(Boolean).join("\n\n")
        : draftKb
      : existingKb;

    const finalBusiness: BusinessConfig = {
      ...base,
      identity,
      centres,
      services,
      centresRules: existingBusiness.centresRules ?? "",
      knowledgeBase,
    };

    onApply(
      finalBusiness,
      include.language && suggestedLang ? suggestedLang : null,
    );
    close();
  }, [
    draft,
    mergeMode,
    existingBusiness,
    include,
    suggestedLang,
    onApply,
    close,
  ]);

  if (!open) return null;

  const existingNonEmpty = !isEmptyBusiness(existingBusiness);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-[#0f172a]/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        {/* Header dégradé */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#6366f1] via-[#7c3aed] to-[#a855f7] px-6 py-5 text-white">
          <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/70">
                <span>✨</span>
                {t("kicker")}
              </div>
              <h3 className="mt-1 text-lg font-extrabold tracking-tight">
                {t("title")}
              </h3>
              <p className="mt-0.5 text-[13px] text-white/80">{t("subtitle")}</p>
            </div>
            <button
              onClick={close}
              className="rounded-full p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
              aria-label={t("close")}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait">
            {step === "input" && (
              <motion.div
                key="input"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <InputStep
                  url={url}
                  setUrl={setUrl}
                  onStart={startScan}
                  error={fatalError}
                  t={t}
                />
              </motion.div>
            )}

            {step === "scanning" && (
              <motion.div
                key="scanning"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <ScanningStep
                  pages={pages}
                  agentStatus={agentStatus}
                  agentConfidence={agentConfidence}
                  t={t}
                />
              </motion.div>
            )}

            {step === "review" && draft && (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <ReviewStep
                  draft={draft}
                  patchDraft={patchDraft}
                  confidence={agentConfidence}
                  include={include}
                  setInclude={setInclude}
                  suggestedLang={suggestedLang}
                  mergeMode={mergeMode}
                  setMergeMode={setMergeMode}
                  existingNonEmpty={existingNonEmpty}
                  dayLabel={dayLabel}
                  t={t}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {step === "review" && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#e2e8f0] bg-[#f8fafc] px-6 py-3.5">
            <button
              onClick={() => setStep("input")}
              className="text-[13px] font-semibold text-[#64748b] transition hover:text-[#334155]"
            >
              {t("rescan")}
            </button>
            <button
              onClick={applyToForm}
              className="rounded-xl bg-gradient-to-br from-[#6366f1] to-[#7c3aed] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
            >
              {t("apply")}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ─── Step: input ────────────────────────────────────────────────────────────

function InputStep({
  url,
  setUrl,
  onStart,
  error,
  t,
}: {
  url: string;
  setUrl: (v: string) => void;
  onStart: () => void;
  error: string | null;
  t: ReturnType<typeof useTranslations<"WebsiteScan">>;
}) {
  return (
    <div className="flex flex-col gap-4 py-2">
      <p className="text-[13px] leading-relaxed text-[#475569]">
        {t("inputHelp")}
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-semibold text-[#334155]">
          {t("urlLabel")}
        </label>
        <div className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 focus-within:border-[#7c3aed] focus-within:ring-2 focus-within:ring-[#7c3aed]/20">
          <span className="text-[#94a3b8]">🔗</span>
          <input
            type="url"
            inputMode="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onStart();
            }}
            placeholder="exemple.com"
            className="w-full bg-transparent text-sm text-[#0f172a] outline-none placeholder:text-[#cbd5e1]"
          />
        </div>
      </div>
      {error && (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5 text-[13px] text-[#b91c1c]">
          {error}
        </div>
      )}
      <button
        onClick={onStart}
        disabled={!url.trim()}
        className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#7c3aed] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ✨ {t("scanCta")}
      </button>
      <p className="text-center text-[11px] text-[#94a3b8]">{t("inputNote")}</p>
    </div>
  );
}

// ─── Step: scanning ───────────────────────────────────────────────────────

function ScanningStep({
  pages,
  agentStatus,
  agentConfidence,
  t,
}: {
  pages: { url: string; title: string }[];
  agentStatus: Record<AgentKey, AgentStatus>;
  agentConfidence: Partial<Record<AgentKey, number>>;
  t: ReturnType<typeof useTranslations<"WebsiteScan">>;
}) {
  return (
    <div className="flex flex-col gap-4 py-1">
      {/* Pages analysées */}
      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3.5 py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-[#334155]">
          <span>🔎</span>
          {t("crawlTitle")}
          {pages.length > 0 && (
            <span className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-bold text-[#4338ca]">
              {pages.length}
            </span>
          )}
        </div>
        {pages.length === 0 ? (
          <p className="mt-1.5 flex items-center gap-2 text-[12px] text-[#64748b]">
            <Spinner /> {t("crawlPending")}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {pages.map((p) => (
              <li
                key={p.url}
                className="truncate text-[12px] text-[#475569]"
                title={p.url}
              >
                <span className="text-[#10b981]">✓</span> {p.title || p.url}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Cartes sous-agents */}
      <div>
        <p className="mb-2 text-[12px] font-semibold text-[#334155]">
          {t("agentsTitle")}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {AGENT_ORDER.map((key) => (
            <AgentCard
              key={key}
              agentKey={key}
              status={agentStatus[key]}
              confidence={agentConfidence[key]}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentCard({
  agentKey,
  status,
  confidence,
  t,
}: {
  agentKey: AgentKey;
  status: AgentStatus;
  confidence?: number;
  t: ReturnType<typeof useTranslations<"WebsiteScan">>;
}) {
  const active = status === "running";
  const done = status === "done";
  const error = status === "error";
  return (
    <motion.div
      layout
      animate={{
        borderColor: active
          ? "#a855f7"
          : done
            ? "#bbf7d0"
            : error
              ? "#fecaca"
              : "#e2e8f0",
      }}
      className="relative flex items-center gap-3 overflow-hidden rounded-xl border bg-white px-3.5 py-3"
    >
      {active && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-[#a855f7]/8 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "linear" }}
        />
      )}
      <span className="relative text-xl">{AGENT_ICON[agentKey]}</span>
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[#0f172a]">
          {t(`agent_${agentKey}` as "agent_identity")}
        </p>
        <p className="truncate text-[11px] text-[#94a3b8]">
          {error
            ? t("agentError")
            : done
              ? t("agentDone")
              : active
                ? t("agentRunning")
                : t("agentIdle")}
        </p>
      </div>
      <div className="relative shrink-0">
        {active && <Spinner />}
        {done && (
          <div className="flex items-center gap-1.5">
            {typeof confidence === "number" && (
              <ConfidenceBadge confidence={confidence} t={t} />
            )}
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-[#10b981] text-[11px] text-white"
            >
              ✓
            </motion.span>
          </div>
        )}
        {error && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ef4444] text-[11px] text-white">
            !
          </span>
        )}
        {status === "idle" && (
          <span className="h-2 w-2 rounded-full bg-[#cbd5e1]" />
        )}
      </div>
    </motion.div>
  );
}

// ─── Step: review ───────────────────────────────────────────────────────────

function ReviewStep({
  draft,
  patchDraft,
  confidence,
  include,
  setInclude,
  suggestedLang,
  mergeMode,
  setMergeMode,
  existingNonEmpty,
  dayLabel,
  t,
}: {
  draft: BusinessConfig;
  patchDraft: (partial: Partial<BusinessConfig>) => void;
  confidence: Partial<Record<AgentKey, number>>;
  include: {
    identity: boolean;
    centres: boolean;
    services: boolean;
    knowledge: boolean;
    language: boolean;
  };
  setInclude: React.Dispatch<
    React.SetStateAction<{
      identity: boolean;
      centres: boolean;
      services: boolean;
      knowledge: boolean;
      language: boolean;
    }>
  >;
  suggestedLang: string | null;
  mergeMode: "replace" | "add";
  setMergeMode: (m: "replace" | "add") => void;
  existingNonEmpty: boolean;
  dayLabel: (d: WeekDay) => string;
  t: ReturnType<typeof useTranslations<"WebsiteScan">>;
}) {
  const updateService = (id: string, partial: Partial<BusinessService>) =>
    patchDraft({
      services: draft.services.map((s) =>
        s.id === id ? { ...s, ...partial } : s,
      ),
    });
  const removeService = (id: string) =>
    patchDraft({ services: draft.services.filter((s) => s.id !== id) });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-[#475569]">{t("reviewHelp")}</p>

      {existingNonEmpty && (
        <div className="flex flex-col gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-3.5 py-3">
          <p className="text-[12px] font-semibold text-[#92400e]">
            {t("mergeTitle")}
          </p>
          <div className="flex gap-2">
            {(["replace", "add"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMergeMode(m)}
                className={`flex-1 rounded-lg border px-3 py-2 text-[12px] font-semibold transition ${
                  mergeMode === m
                    ? "border-[#7c3aed] bg-[#7c3aed] text-white"
                    : "border-[#e2e8f0] bg-white text-[#475569] hover:border-[#cbd5e1]"
                }`}
              >
                {t(m === "replace" ? "mergeReplace" : "mergeAdd")}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Identité */}
      <ReviewSection
        title={t("sectionIdentity")}
        icon={AGENT_ICON.identity}
        confidence={confidence.identity}
        included={include.identity}
        onToggle={() =>
          setInclude((s) => ({ ...s, identity: !s.identity }))
        }
        t={t}
      >
        <div className="grid grid-cols-1 gap-2">
          <EditField
            label={t("fieldName")}
            value={draft.identity.name}
            onChange={(v) =>
              patchDraft({ identity: { ...draft.identity, name: v } })
            }
          />
          <EditField
            label={t("fieldTagline")}
            value={draft.identity.tagline}
            onChange={(v) =>
              patchDraft({ identity: { ...draft.identity, tagline: v } })
            }
          />
          <EditField
            label={t("fieldEmail")}
            value={draft.identity.email}
            onChange={(v) =>
              patchDraft({ identity: { ...draft.identity, email: v } })
            }
          />
        </div>
      </ReviewSection>

      {/* Centres + horaires */}
      <ReviewSection
        title={t("sectionCentres")}
        icon={AGENT_ICON.location}
        confidence={Math.max(
          confidence.location ?? 0,
          confidence.hours ?? 0,
        )}
        included={include.centres}
        onToggle={() => setInclude((s) => ({ ...s, centres: !s.centres }))}
        t={t}
      >
        {draft.centres.length === 0 ? (
          <p className="text-[12px] italic text-[#94a3b8]">{t("noneFound")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {draft.centres.map((c, i) => (
              <div
                key={c.id}
                className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-2.5"
              >
                <EditField
                  label={t("fieldCentreName")}
                  value={c.name}
                  onChange={(v) =>
                    patchDraft({
                      centres: draft.centres.map((x, xi) =>
                        xi === i ? { ...x, name: v } : x,
                      ),
                    })
                  }
                />
                <div className="mt-2">
                  <EditField
                    label={t("fieldAddress")}
                    value={c.address}
                    onChange={(v) =>
                      patchDraft({
                        centres: draft.centres.map((x, xi) =>
                          xi === i ? { ...x, address: v } : x,
                        ),
                      })
                    }
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {WEEKDAY_ORDER.map((d) => {
                    const dh = c.hours[d];
                    return (
                      <span
                        key={d}
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          dh?.open
                            ? "bg-[#dcfce7] text-[#166534]"
                            : "bg-[#f1f5f9] text-[#94a3b8]"
                        }`}
                      >
                        {dayLabel(d)}{" "}
                        {dh?.open ? `${dh.openTime}–${dh.closeTime}` : "—"}
                      </span>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[10px] text-[#94a3b8]">
                  {t("hoursEditNote")}
                </p>
              </div>
            ))}
          </div>
        )}
      </ReviewSection>

      {/* Services */}
      <ReviewSection
        title={`${t("sectionServices")}${
          draft.services.length ? ` (${draft.services.length})` : ""
        }`}
        icon={AGENT_ICON.services}
        confidence={confidence.services}
        included={include.services}
        onToggle={() => setInclude((s) => ({ ...s, services: !s.services }))}
        t={t}
      >
        {draft.services.length === 0 ? (
          <p className="text-[12px] italic text-[#94a3b8]">{t("noneFound")}</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
            {draft.services.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5"
              >
                <input
                  value={s.name}
                  onChange={(e) => updateService(s.id, { name: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-[#0f172a] outline-none"
                />
                <input
                  type="number"
                  value={s.durationMinutes}
                  onChange={(e) =>
                    updateService(s.id, {
                      durationMinutes: Number(e.target.value) || 0,
                    })
                  }
                  className="w-14 rounded border border-[#e2e8f0] bg-[#f8fafc] px-1.5 py-0.5 text-right text-[11px] text-[#475569] outline-none"
                />
                <span className="text-[10px] text-[#94a3b8]">min</span>
                <input
                  type="number"
                  value={s.priceILS}
                  onChange={(e) =>
                    updateService(s.id, {
                      priceILS: Number(e.target.value) || 0,
                    })
                  }
                  className="w-16 rounded border border-[#e2e8f0] bg-[#f8fafc] px-1.5 py-0.5 text-right text-[11px] text-[#475569] outline-none"
                />
                <span className="text-[10px] text-[#94a3b8]">₪</span>
                <button
                  onClick={() => removeService(s.id)}
                  className="shrink-0 rounded p-1 text-[#cbd5e1] transition hover:bg-[#fef2f2] hover:text-[#ef4444]"
                  aria-label={t("remove")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </ReviewSection>

      {/* Base de connaissances (corps de métier, descriptions, technique) */}
      <ReviewSection
        title={t("sectionKnowledge")}
        icon={AGENT_ICON.knowledge}
        confidence={confidence.knowledge}
        included={include.knowledge}
        onToggle={() => setInclude((s) => ({ ...s, knowledge: !s.knowledge }))}
        t={t}
      >
        {(draft.knowledgeBase ?? "").trim().length === 0 ? (
          <p className="text-[12px] italic text-[#94a3b8]">{t("noneFound")}</p>
        ) : (
          <>
            <textarea
              value={draft.knowledgeBase ?? ""}
              onChange={(e) => patchDraft({ knowledgeBase: e.target.value })}
              rows={10}
              className="w-full resize-y rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-2 text-[12px] leading-relaxed text-[#0f172a] outline-none focus:border-[#22d3ee]"
            />
            <p className="mt-1.5 text-[10px] text-[#94a3b8]">
              {t("knowledgeEditNote")}
            </p>
          </>
        )}
      </ReviewSection>

      {/* Langue suggérée */}
      {suggestedLang && (
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-3">
          <span className="flex items-center gap-2 text-[13px] text-[#334155]">
            <span>{AGENT_ICON.languages}</span>
            {t("applyLanguage", { lang: suggestedLang.toUpperCase() })}
          </span>
          <input
            type="checkbox"
            checked={include.language}
            onChange={() =>
              setInclude((s) => ({ ...s, language: !s.language }))
            }
            className="h-4 w-4 accent-[#7c3aed]"
          />
        </label>
      )}
    </div>
  );
}

function ReviewSection({
  title,
  icon,
  confidence,
  included,
  onToggle,
  t,
  children,
}: {
  title: string;
  icon: string;
  confidence?: number;
  included: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useTranslations<"WebsiteScan">>;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border transition ${
        included ? "border-[#e2e8f0] bg-white" : "border-[#e2e8f0] bg-[#f8fafc] opacity-60"
      }`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[#f1f5f9] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <h4 className="text-[13px] font-bold text-[#0f172a]">{title}</h4>
          {typeof confidence === "number" && (
            <ConfidenceBadge confidence={confidence} t={t} />
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[#64748b]">
          {t("includeLabel")}
          <input
            type="checkbox"
            checked={included}
            onChange={onToggle}
            className="h-4 w-4 accent-[#7c3aed]"
          />
        </label>
      </header>
      {included && <div className="px-3.5 py-3">{children}</div>}
    </section>
  );
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-[#64748b]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[13px] text-[#0f172a] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-[#7c3aed]/15"
      />
    </label>
  );
}

// ─── Bits ─────────────────────────────────────────────────────────────────

function ConfidenceBadge({
  confidence,
  t,
}: {
  confidence: number;
  t: ReturnType<typeof useTranslations<"WebsiteScan">>;
}) {
  const tier = confidenceTier(confidence);
  const styles = {
    high: "bg-[#dcfce7] text-[#166534]",
    medium: "bg-[#fef9c3] text-[#854d0e]",
    low: "bg-[#fee2e2] text-[#991b1b]",
  }[tier];
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${styles}`}
    >
      {t(`confidence_${tier}` as "confidence_high")}
    </span>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e2e8f0] border-t-[#7c3aed]" />
  );
}
