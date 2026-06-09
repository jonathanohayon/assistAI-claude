"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";

import { useRealtimeCatalog, voicesForCatalog } from "@/lib/use-realtime-catalog";
import {
  emptyAgentDraft,
  type OutboundAgentDraft,
  type OutboundAgentListItem,
} from "@/lib/outbound-agents/types";

import { Field, Section, inputCls } from "../_ui";

const ACCENT_AGENTS = "from-[#6366f1] to-[#8b5cf6]";

const LANGS: ReadonlyArray<[string, string]> = [
  ["fr", "Français"],
  ["he", "עברית"],
  ["en", "English"],
];

type View = "list" | "editor";

/**
 * Workspace « Agents » — agents IA sortants réutilisables. Liste + éditeur à
 * 5 sections inline (voix / persona / business / notifications / canaux). Un
 * agent est ensuite associé à une ou plusieurs campagnes.
 */
export function AgentsWorkspace({
  asUserId,
  onBack,
}: {
  asUserId?: string;
  onBack: () => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  const locale = useLocale();
  const catalog = useRealtimeCatalog();
  const voices = useMemo(() => voicesForCatalog(catalog, ""), [catalog]);
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";

  const [view, setView] = useState<View>("list");
  const [list, setList] = useState<OutboundAgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<OutboundAgentDraft>(() =>
    emptyAgentDraft(locale),
  );
  const [usage, setUsage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/outbound-agents${qs}`);
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { agents: OutboundAgentListItem[] };
      setList(data.agents ?? []);
      setError(null);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [qs, t]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/outbound-agents${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((data: { agents?: OutboundAgentListItem[] }) => {
        if (cancelled) return;
        setList(data.agents ?? []);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("loadError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [qs, t]);

  const set = (patch: Partial<OutboundAgentDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const openNew = () => {
    setDraft(emptyAgentDraft(locale));
    setUsage(0);
    setView("editor");
  };

  const openEdit = (a: OutboundAgentListItem) => {
    setDraft({
      id: a.id,
      name: a.name,
      agentName: a.agentName,
      voice: a.voice,
      language: a.language,
      instructions: a.instructions,
      greeting: a.greeting,
      knowledge: a.knowledge,
      knowledgeSources: a.knowledgeSources ?? [],
      notifications: a.notifications ?? {},
      channels: a.channels ?? { phone: true },
    });
    setUsage(a.campaignCount);
    setView("editor");
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const editing = !!draft.id;
      const res = await fetch(
        `/api/dashboard/outbound-agents${editing ? `/${draft.id}` : ""}${qs}`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      if (!res.ok) throw new Error("save");
      const data = (await res.json()) as { agent: OutboundAgentListItem };
      if (!editing && data.agent?.id) set({ id: data.agent.id });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
      await loadList();
    } catch {
      setError(t("createAgentError"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, campaignCount: number) => {
    const msg =
      campaignCount > 0
        ? t("deleteAgentConfirmUsed", { count: campaignCount })
        : t("deleteAgentConfirm");
    if (!window.confirm(msg)) return;
    await fetch(`/api/dashboard/outbound-agents/${id}${qs}`, {
      method: "DELETE",
    });
    if (draft.id === id) setView("list");
    await loadList();
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-5 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative z-10 flex min-h-[78vh] w-full flex-col overflow-hidden rounded-3xl bg-[#f8fafc] shadow-xl ring-1 ring-black/5"
      >
        {/* Header dégradé indigo→violet (distinct du orange des campagnes). */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#6366f1] via-[#7c3aed] to-[#8b5cf6] px-6 py-4 text-white">
          <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <button
              onClick={() => (view === "editor" ? setView("list") : onBack())}
              aria-label={t("back")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M11 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/75">
                <AgentGlyph className="h-3.5 w-3.5" />
                <span className="truncate">{t("agentsKicker")}</span>
              </div>
              <h3 className="truncate text-lg font-extrabold tracking-tight">
                {view === "editor"
                  ? draft.name.trim() || t("agentsTitle")
                  : t("agentsTitle")}
              </h3>
            </div>
            {view === "editor" && (
              <button
                onClick={save}
                disabled={saving}
                className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#6d28d9] shadow-sm transition hover:bg-white/90 disabled:opacity-60"
              >
                {saving
                  ? t("savingLabel")
                  : justSaved
                    ? t("savedOk")
                    : draft.id
                      ? t("saveCta")
                      : t("createCta")}
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <AnimatePresence mode="wait">
            {view === "list" ? (
              <motion.div
                key="list"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18 }}
              >
                <ListView
                  list={list}
                  loading={loading}
                  error={error}
                  onNew={openNew}
                  onOpen={openEdit}
                  onDelete={remove}
                />
              </motion.div>
            ) : (
              <motion.div
                key="editor"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.18 }}
                className="space-y-4"
              >
                <Editor
                  draft={draft}
                  set={set}
                  voices={voices}
                  usage={usage}
                  onDelete={
                    draft.id ? () => remove(draft.id!, usage) : undefined
                  }
                />
                {/* Save aussi en bas (long formulaire). */}
                <button
                  onClick={save}
                  disabled={saving}
                  className={`w-full cursor-pointer rounded-2xl bg-gradient-to-br ${ACCENT_AGENTS} py-3 text-sm font-bold text-white shadow-md transition hover:opacity-95 disabled:opacity-60`}
                >
                  {saving
                    ? t("savingLabel")
                    : justSaved
                      ? t("savedOk")
                      : draft.id
                        ? t("saveCta")
                        : t("createCta")}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Liste d'agents ─────────────────────────────────────────────────────────

function ListView({
  list,
  loading,
  error,
  onNew,
  onOpen,
  onDelete,
}: {
  list: OutboundAgentListItem[];
  loading: boolean;
  error: string | null;
  onNew: () => void;
  onOpen: (a: OutboundAgentListItem) => void;
  onDelete: (id: string, campaignCount: number) => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  if (loading)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl border border-[#e2e8f0] bg-white"
          />
        ))}
      </div>
    );
  if (error)
    return <p className="text-sm text-[#dc2626]">{error}</p>;

  return (
    <div className="space-y-4">
      <button
        onClick={onNew}
        className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-br ${ACCENT_AGENTS} py-3 text-sm font-bold text-white shadow-md transition hover:opacity-95`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {t("newAgent")}
      </button>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ede9fe] text-[#7c3aed]">
            <AgentGlyph className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-[#18181b]">
            {t("agentsListEmptyTitle")}
          </p>
          <p className="mt-1 text-[13px] text-[#64748b]">
            {t("agentsListEmptyBody")}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="group flex flex-col rounded-2xl border border-[#e2e8f0] bg-white p-4 transition hover:border-[#8b5cf6]/40 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${ACCENT_AGENTS} text-white`}>
                  <AgentGlyph className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold text-[#18181b]">
                    {a.name}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-[#64748b]">
                    {a.agentName} · {a.voice} · {a.language.toUpperCase()}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[11px] font-semibold text-[#94a3b8]">
                {t("usedInCampaigns", { count: a.campaignCount })}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => onOpen(a)}
                  className="flex-1 cursor-pointer rounded-xl border border-[#e2e8f0] bg-white py-2 text-[12px] font-bold text-[#6d28d9] transition hover:bg-[#f5f3ff]"
                >
                  {t("openCta")}
                </button>
                <button
                  onClick={() => onDelete(a.id, a.campaignCount)}
                  aria-label={t("deleteAgent")}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-[#e2e8f0] bg-white text-[#94a3b8] transition hover:border-[#fecaca] hover:bg-[#fef2f2] hover:text-[#dc2626]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Éditeur : 5 sections inline ────────────────────────────────────────────

function Editor({
  draft,
  set,
  voices,
  usage,
  onDelete,
}: {
  draft: OutboundAgentDraft;
  set: (patch: Partial<OutboundAgentDraft>) => void;
  voices: readonly string[];
  usage: number;
  onDelete?: () => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  return (
    <>
      {/* Nom (libellé) de l'agent */}
      <Section title={t("nameLabel")} icon={<TagGlyph />}>
        <input
          className={inputCls}
          value={draft.name}
          placeholder={t("namePlaceholder")}
          onChange={(e) => set({ name: e.target.value })}
        />
        {usage > 0 && (
          <p className="mt-2 text-[11px] font-semibold text-[#94a3b8]">
            {t("usedInCampaigns", { count: usage })}
          </p>
        )}
      </Section>

      {/* 1 — Voix */}
      <Section title={t("sectionVoice")} icon={<MicGlyph />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("voiceLabel")}>
            <select
              className={inputCls}
              value={draft.voice}
              onChange={(e) => set({ voice: e.target.value })}
            >
              {voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("languageLabel")}>
            <select
              className={inputCls}
              value={draft.language}
              onChange={(e) => set({ language: e.target.value })}
            >
              {LANGS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* 2 — Persona */}
      <Section title={t("sectionPersona")} icon={<PersonGlyph />}>
        <div className="space-y-3">
          <Field label={t("agentNameLabel")}>
            <input
              className={inputCls}
              value={draft.agentName}
              placeholder={t("agentNamePlaceholder")}
              onChange={(e) => set({ agentName: e.target.value })}
            />
          </Field>
          <Field label={t("greetingLabel")} hint={t("greetingHint")}>
            <input
              className={inputCls}
              value={draft.greeting}
              placeholder={t("greetingPlaceholder")}
              onChange={(e) => set({ greeting: e.target.value })}
            />
          </Field>
          <Field label={t("instructionsLabel")} hint={t("instructionsHint")}>
            <textarea
              className={`${inputCls} min-h-24 resize-y`}
              value={draft.instructions}
              placeholder={t("instructionsPlaceholder")}
              onChange={(e) => set({ instructions: e.target.value })}
            />
          </Field>
        </div>
      </Section>

      {/* 3 — Business (ce que l'agent vend) */}
      <BusinessSection draft={draft} set={set} />

      {/* 4 — Notifications */}
      <Section title={t("sectionNotifs")} icon={<BellGlyph />}>
        <p className="mb-3 text-[12px] text-[#64748b]">{t("notifsHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("notifsWhatsappLabel")}>
            <input
              className={inputCls}
              type="tel"
              inputMode="tel"
              value={draft.notifications.whatsapp ?? ""}
              placeholder="+33…"
              onChange={(e) =>
                set({
                  notifications: {
                    ...draft.notifications,
                    whatsapp: e.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label={t("notifsEmailLabel")}>
            <input
              className={inputCls}
              type="email"
              inputMode="email"
              value={draft.notifications.email ?? ""}
              placeholder="owner@…"
              onChange={(e) =>
                set({
                  notifications: {
                    ...draft.notifications,
                    email: e.target.value,
                  },
                })
              }
            />
          </Field>
        </div>
      </Section>

      {/* 5 — Canaux */}
      <Section title={t("sectionChannels")} icon={<ChatGlyph />}>
        <p className="mb-3 text-[12px] text-[#64748b]">{t("channelsHint")}</p>
        <div className="space-y-2">
          <ToggleRow
            label={t("channelsPhone")}
            on={draft.channels.phone !== false}
            onToggle={(on) =>
              set({ channels: { ...draft.channels, phone: on } })
            }
          />
          <ToggleRow
            label={t("channelsWhatsappVoice")}
            on={draft.channels.whatsappVoice === true}
            onToggle={(on) =>
              set({ channels: { ...draft.channels, whatsappVoice: on } })
            }
          />
        </div>
        <p className="mt-3 rounded-xl bg-[#f1f5f9] px-3 py-2 text-[11px] text-[#64748b]">
          {t("channelsFromNumberNote")}
        </p>
      </Section>

      {onDelete && (
        <button
          onClick={onDelete}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#fecaca] bg-[#fef2f2] py-2.5 text-[13px] font-bold text-[#dc2626] transition hover:bg-[#fee2e2]"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6" />
          </svg>
          {t("deleteAgent")}
        </button>
      )}
    </>
  );
}

// Section Business : apprentissage depuis un/des site(s) web (route /learn).
function BusinessSection({
  draft,
  set,
}: {
  draft: OutboundAgentDraft;
  set: (patch: Partial<OutboundAgentDraft>) => void;
}) {
  const t = useTranslations("DashboardCampaigns");
  const [urls, setUrls] = useState((draft.knowledgeSources ?? []).join("\n"));
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const learn = async () => {
    const list = urls
      .split(/\r?\n|[,;]/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!list.length || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/campaigns/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: list, language: draft.language || "fr" }),
      });
      if (!res.ok) {
        setError(t("knowledgeError"));
        return;
      }
      const data = (await res.json()) as { knowledge?: string; sources?: string[] };
      if (!data.knowledge) {
        setError(t("knowledgeError"));
        return;
      }
      set({ knowledge: data.knowledge, knowledgeSources: data.sources ?? list });
    } catch {
      setError(t("knowledgeError"));
    } finally {
      setScanning(false);
    }
  };

  return (
    <Section title={t("sectionBusiness")} icon={<BuildingGlyph />}>
      <p className="mb-3 text-[12px] text-[#64748b]">{t("knowledgeHint")}</p>
      <Field label={t("knowledgeUrlsLabel")}>
        <textarea
          className={`${inputCls} min-h-16 resize-y font-mono text-[12px]`}
          value={urls}
          placeholder={t("knowledgeUrlsPlaceholder")}
          onChange={(e) => setUrls(e.target.value)}
        />
      </Field>
      <button
        onClick={learn}
        disabled={scanning}
        className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl bg-[#ede9fe] px-3 py-2 text-[12px] font-bold text-[#6d28d9] transition hover:bg-[#ddd6fe] disabled:opacity-60"
      >
        {scanning ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#6d28d9] border-t-transparent" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
          </svg>
        )}
        {scanning ? t("knowledgeScanning") : t("knowledgeScanCta")}
      </button>
      {error && <p className="mt-2 text-[12px] text-[#dc2626]">{error}</p>}
      {draft.knowledge && (
        <Field label={t("knowledgeLabel")}>
          <textarea
            className={`${inputCls} min-h-32 resize-y`}
            value={draft.knowledge}
            placeholder={t("knowledgePlaceholder")}
            onChange={(e) => set({ knowledge: e.target.value })}
          />
        </Field>
      )}
    </Section>
  );
}

function ToggleRow({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-left transition hover:border-[#8b5cf6]/40"
    >
      <span className="text-[13px] font-semibold text-[#334155]">{label}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition ${on ? "bg-[#8b5cf6]" : "bg-[#cbd5e1]"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

// ─── Glyphes (SVG, pas d'emoji) ─────────────────────────────────────────────

function AgentGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4M9 13h.01M15 13h.01M2 12v3M22 12v3" />
    </svg>
  );
}
function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}
function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
function BuildingGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
    </svg>
  );
}
function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.1a8.5 8.5 0 0 1-.9-3.9 8.38 8.38 0 0 1 8.4-9 8.5 8.5 0 0 1 8.6 8.4Z" />
    </svg>
  );
}
function TagGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}
