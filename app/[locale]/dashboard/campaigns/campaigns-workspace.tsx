"use client";

/**
 * Workspace plein écran du centre d'appels sortant. Ouvert depuis la tuile
 * "Centre d'appels sortant" de config-form (premium/admin uniquement).
 *
 * Vues : list → editor (Setup | Contacts | Launch). L'editor crée/édite une
 * campagne ; Contacts & Launch se déverrouillent une fois la campagne créée.
 * Monitor live + analytics animées sont branchés dans les phases suivantes.
 */

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_CALL_WINDOW,
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRY_RULES,
} from "@/lib/campaigns/constants";
import type {
  CampaignDraft,
  CampaignListItem,
} from "@/lib/campaigns/types";
import { useRealtimeCatalog, voicesForCatalog } from "@/lib/use-realtime-catalog";

import { CampaignList } from "./campaign-list";
import { CampaignSetupStep } from "./campaign-setup-step";
import { ContactsImportStep } from "./contacts-import-step";
import { CampaignLaunch } from "./campaign-launch";
import { StatusPill } from "./_ui";

type View = "list" | "editor";
type EditorTab = "setup" | "contacts" | "launch";

function emptyDraft(): CampaignDraft {
  return {
    name: "",
    goalPreset: "cold",
    objective: "",
    fromNumber: "",
    persona: {},
    extractionSchema: [],
    concurrency: DEFAULT_CONCURRENCY,
    retryRules: { ...DEFAULT_RETRY_RULES },
    callWindow: { ...DEFAULT_CALL_WINDOW },
  };
}

export function CampaignsWorkspace({
  open,
  onClose,
  asUserId,
}: {
  open: boolean;
  onClose: () => void;
  asUserId?: string;
}) {
  const t = useTranslations("DashboardCampaigns");
  const catalog = useRealtimeCatalog();
  const voices = useMemo(() => voicesForCatalog(catalog, ""), [catalog]);

  const [view, setView] = useState<View>("list");
  const [tab, setTab] = useState<EditorTab>("setup");
  const [list, setList] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromNumbers, setFromNumbers] = useState<string[]>([]);

  // Campagne en cours d'édition.
  const [draft, setDraft] = useState<CampaignDraft>(emptyDraft());
  const [activeStatus, setActiveStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/campaigns${qs}`);
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { campaigns: CampaignListItem[] };
      setList(data.campaigns ?? []);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [qs, t]);

  // Charge la liste + les numéros caller-id à l'ouverture. Le composant est
  // remonté (key) à chaque ouverture → la vue démarre sur "list" par défaut,
  // donc pas de setState synchrone ici.
  useEffect(() => {
    if (!open) return;
    void loadList();
    void (async () => {
      try {
        const res = await fetch(`/api/dashboard/channels${qs}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          channels?: Array<{ phoneNumber: string; channel?: string }>;
        };
        setFromNumbers(
          (data.channels ?? [])
            .filter((c) => c.channel !== "whatsapp")
            .map((c) => c.phoneNumber),
        );
      } catch {
        /* noop */
      }
    })();
  }, [open, qs, loadList]);

  const openNew = () => {
    setDraft(emptyDraft());
    setActiveStatus("draft");
    setSaveError(null);
    setTab("setup");
    setView("editor");
  };

  const openExisting = (c: CampaignListItem) => {
    setDraft({
      id: c.id,
      name: c.name,
      goalPreset: c.goalPreset,
      objective: c.objective,
      fromNumber: c.fromNumber,
      persona: c.persona ?? {},
      extractionSchema: c.extractionSchema ?? [],
      concurrency: c.concurrency,
      retryRules: c.retryRules ?? { ...DEFAULT_RETRY_RULES },
      callWindow: c.callWindow ?? { ...DEFAULT_CALL_WINDOW },
    });
    setActiveStatus(c.status);
    setSaveError(null);
    setTab("setup");
    setView("editor");
  };

  const patchDraft = (patch: Partial<CampaignDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (saving) return;
    if (!draft.name.trim()) {
      setSaveError(t("nameRequired"));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const isNew = !draft.id;
      const res = await fetch(
        isNew
          ? `/api/dashboard/campaigns${qs}`
          : `/api/dashboard/campaigns/${draft.id}${qs}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      if (!res.ok) throw new Error("save");
      const data = (await res.json()) as { campaign: { id: string; status: string } };
      setDraft((d) => ({ ...d, id: data.campaign.id }));
      setActiveStatus(data.campaign.status);
      await loadList();
      if (isNew) setTab("contacts");
    } catch {
      setSaveError(t("createError"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const savedCampaign = !!draft.id;
  const currentStats = list.find((c) => c.id === draft.id)?.stats;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <motion.div
          className="absolute inset-0 bg-[#0f172a]/55 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative z-10 flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-[#f8fafc] shadow-2xl sm:h-[92vh] sm:rounded-3xl"
        >
          {/* Header dégradé chaud */}
          <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#f97316] via-[#ef4444] to-[#db2777] px-6 py-4 text-white">
            <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {view === "editor" && (
                  <button
                    onClick={() => setView("list")}
                    className="rounded-full px-2 py-1 text-[13px] font-semibold text-white/85 transition hover:bg-white/15"
                  >
                    {t("back")}
                  </button>
                )}
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/80">
                    <span>📣</span>
                    {t("kicker")}
                  </div>
                  <h3 className="text-lg font-extrabold tracking-tight">
                    {view === "editor" && draft.name ? draft.name : t("title")}
                  </h3>
                </div>
                {view === "editor" && savedCampaign && (
                  <StatusPill
                    status={activeStatus}
                    label={t(`status_${activeStatus}`)}
                  />
                )}
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
                aria-label={t("close")}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Onglets de l'editor */}
            {view === "editor" && (
              <div className="relative mt-3 flex gap-1">
                {(["setup", "contacts", "launch"] as EditorTab[]).map((tb) => {
                  const locked = tb !== "setup" && !savedCampaign;
                  const active = tab === tb;
                  return (
                    <button
                      key={tb}
                      onClick={() => !locked && setTab(tb)}
                      disabled={locked}
                      className={`rounded-t-lg px-3 py-1.5 text-[12px] font-bold transition ${
                        active
                          ? "bg-[#f8fafc] text-[#db2777]"
                          : locked
                            ? "cursor-not-allowed text-white/40"
                            : "text-white/85 hover:bg-white/10"
                      }`}
                    >
                      {t(
                        tb === "setup"
                          ? "stepSetup"
                          : tb === "contacts"
                            ? "stepContacts"
                            : "stepLaunch",
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {view === "list" && (
              <CampaignList
                campaigns={list}
                loading={loading}
                error={error}
                onOpen={openExisting}
                onCreate={openNew}
              />
            )}

            {view === "editor" && tab === "setup" && (
              <CampaignSetupStep
                draft={draft}
                onChange={patchDraft}
                voices={voices}
                fromNumbers={fromNumbers}
              />
            )}

            {view === "editor" && tab === "contacts" && draft.id && (
              <ContactsImportStep
                campaignId={draft.id}
                asUserId={asUserId}
                onAdded={() => void loadList()}
              />
            )}

            {view === "editor" && tab === "launch" && draft.id && (
              <CampaignLaunch
                campaignId={draft.id}
                asUserId={asUserId}
                status={activeStatus}
                stats={currentStats}
                onChanged={(status) => {
                  setActiveStatus(status);
                  void loadList();
                }}
              />
            )}
          </div>

          {/* Footer (editor / setup) — bouton créer/sauver */}
          {view === "editor" && tab === "setup" && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#e2e8f0] bg-white px-6 py-3.5">
              <span className="text-[12px] font-semibold text-[#dc2626]">
                {saveError ?? ""}
              </span>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
              >
                {saving
                  ? t("savingLabel")
                  : savedCampaign
                    ? t("saveCta")
                    : t("createCta")}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
