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

import { AgentEditor } from "./agent-editor";

const ACCENT_AGENTS = "from-[#6366f1] to-[#8b5cf6]";

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
      personality: a.personality ?? { vitesse: 5, creativite: 5, reactivite: 5 },
      noiseReductionLevel: a.noiseReductionLevel ?? 8,
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
                  ? draft.agentName.trim() || t("agentsTitle")
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
                <AgentEditor
                  draft={draft}
                  set={set}
                  voices={voices}
                  asUserId={asUserId}
                />
                {draft.id && (
                  <button
                    onClick={() => remove(draft.id!, usage)}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#fecaca] bg-[#fef2f2] py-2.5 text-[13px] font-bold text-[#dc2626] transition hover:bg-[#fee2e2]"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6" />
                    </svg>
                    {t("deleteAgent")}
                  </button>
                )}
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
                    {a.agentName}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-[#64748b]">
                    {a.voice} · {a.language.toUpperCase()}
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

// ─── Glyphes (SVG, pas d'emoji) ─────────────────────────────────────────────

function AgentGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4M9 13h.01M15 13h.01M2 12v3M22 12v3" />
    </svg>
  );
}
