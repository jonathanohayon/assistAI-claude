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
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  DEFAULT_CALL_WINDOW,
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRY_RULES,
} from "@/lib/campaigns/constants";
import type {
  CampaignDraft,
  CampaignListItem,
} from "@/lib/campaigns/types";
import type { OutboundAgentListItem } from "@/lib/outbound-agents/types";

import { CampaignAnalytics } from "./campaign-analytics";
import { CampaignList } from "./campaign-list";
import { CampaignSetupStep } from "./campaign-setup-step";
import { ContactsImportStep } from "./contacts-import-step";
import { CampaignContactsList } from "./campaign-contacts-list";
import { CampaignLaunch } from "./campaign-launch";
import { StatusPill } from "./_ui";

type View = "list" | "editor";
type EditorTab = "setup" | "contacts" | "launch";

// Les 3 étapes de l'editor, dans l'ordre, pour le stepper numéroté.
const STEPS: { key: EditorTab; n: number }[] = [
  { key: "setup", n: 1 },
  { key: "contacts", n: 2 },
  { key: "launch", n: 3 },
];

function emptyDraft(defaultName: string): CampaignDraft {
  return {
    name: defaultName,
    goalPreset: "cold",
    objective: "",
    fromNumber: "",
    // Agent choisi dans l'étape « Agent » (null tant qu'aucun associé).
    agentId: null,
    successCriteria: "",
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
  variant = "modal",
}: {
  open: boolean;
  onClose: () => void;
  asUserId?: string;
  // "modal" = overlay portal (ouvert depuis une tuile). "page" = rendu inline
  // dans le flux du layout dashboard (onglet « Appels sortants »), sans
  // backdrop ni fixed inset, pour laisser la nav visible au-dessus.
  variant?: "modal" | "page";
}) {
  const t = useTranslations("DashboardCampaigns");
  // Agents sortants du tenant (pour le sélecteur d'agent de l'étape Setup).
  const [agents, setAgents] = useState<OutboundAgentListItem[]>([]);

  const [view, setView] = useState<View>("list");
  const [tab, setTab] = useState<EditorTab>("setup");
  const [list, setList] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromNumbers, setFromNumbers] = useState<string[]>([]);
  // Incrémenté à chaque ajout de contacts → rafraîchit la liste affichée.
  const [contactsVersion, setContactsVersion] = useState(0);

  // Campagne en cours d'édition.
  const [draft, setDraft] = useState<CampaignDraft>(() =>
    emptyDraft(t("newCampaign")),
  );
  const [activeStatus, setActiveStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Feedback de sauvegarde réussie (badge "✓ Enregistré" + bouton Suivant).
  const [justSaved, setJustSaved] = useState(false);
  // Campagne dont on affiche les analytics (modal).
  const [analyticsFor, setAnalyticsFor] = useState<{ id: string; name: string } | null>(null);

  // Portal monté côté client → modal rendu dans <body>, donc `fixed` = viewport
  // garanti (immunisé contre un ancêtre transformé qui le confinerait et le
  // couperait en haut).
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";

  // setState uniquement après await → pas de setState synchrone (lint
  // react-hooks/set-state-in-effect). `loading` part à true (état initial,
  // remonté à chaque ouverture via key) et retombe à false en fin de fetch.
  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/campaigns${qs}`);
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { campaigns: CampaignListItem[] };
      setList(data.campaigns ?? []);
      setError(null);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [qs, t]);

  // Charge la liste + les numéros caller-id à l'ouverture. Fetches inline en
  // .then (setState seulement dans les callbacks async, gardés par `cancelled`)
  // pour rester clean vis-à-vis de react-hooks/set-state-in-effect. Le
  // composant est remonté (key) à chaque ouverture → vue "list" par défaut.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/dashboard/campaigns${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((data: { campaigns?: CampaignListItem[] }) => {
        if (cancelled) return;
        setList(data.campaigns ?? []);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("loadError"));
        setLoading(false);
      });
    fetch(`/api/dashboard/channels${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch"))))
      .then((data: { numbers?: Array<{ phoneNumber: string; channel: string }> }) => {
        if (cancelled) return;
        setFromNumbers(
          (data.numbers ?? [])
            .filter((n) => n.channel === "pstn")
            .map((n) => n.phoneNumber),
        );
      })
      .catch(() => {
        /* silencieux : pas de numéros caller-id proposés */
      });
    fetch(`/api/dashboard/outbound-agents${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch"))))
      .then((data: { agents?: OutboundAgentListItem[] }) => {
        if (cancelled) return;
        setAgents(data.agents ?? []);
      })
      .catch(() => {
        /* silencieux : sélecteur d'agent vide → invite à en créer un */
      });
    return () => {
      cancelled = true;
    };
  }, [open, qs, t]);

  const openNew = () => {
    setDraft(emptyDraft(t("newCampaign")));
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
      agentId: c.agentId ?? null,
      successCriteria: c.successCriteria ?? "",
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

  const patchDraft = (patch: Partial<CampaignDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // Toute modif après une sauvegarde efface le badge "Enregistré".
    if (justSaved) setJustSaved(false);
  };

  // Suppression d'une campagne (depuis la liste ou l'éditeur). Confirme,
  // appelle l'API DELETE, rafraîchit la liste, et revient à la liste si la
  // campagne ouverte était celle supprimée.
  const deleteCampaign = async (c: { id: string; name: string }) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(t("deleteCampaignConfirm", { name: c.name }))
    )
      return;
    try {
      await fetch(`/api/dashboard/campaigns/${c.id}${qs}`, { method: "DELETE" });
    } catch {
      /* best-effort : on rafraîchit quand même la liste */
    }
    if (draft.id === c.id) setView("list");
    await loadList();
  };

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
      // Succès : on reste sur l'étape 1 avec un feedback clair + bouton Suivant
      // (au lieu d'un saut silencieux), pour que l'utilisateur voie que c'est
      // bien enregistré et choisisse d'avancer.
      setJustSaved(true);
    } catch {
      setSaveError(t("createError"));
    } finally {
      setSaving(false);
    }
  };

  if (!open || !mounted) return null;

  const savedCampaign = !!draft.id;
  const currentStats = list.find((c) => c.id === draft.id)?.stats;
  const stepIdx = STEPS.findIndex((s) => s.key === tab);
  const stepLabel = t(
    tab === "setup"
      ? "stepSetup"
      : tab === "contacts"
        ? "stepContacts"
        : "stepLaunch",
  );

  const isPage = variant === "page";

  const dialog = (
        <motion.div
          role="dialog"
          aria-modal={isPage ? undefined : "true"}
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className={
            isPage
              ? "relative z-10 flex min-h-[78vh] w-full flex-col overflow-hidden rounded-3xl bg-[#f8fafc] shadow-xl ring-1 ring-black/5"
              : "relative z-10 flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-[#f8fafc] shadow-2xl sm:h-[88vh] sm:rounded-3xl"
          }
        >
          {/* Header dégradé chaud */}
          <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#f97316] via-[#ef4444] to-[#db2777] px-6 py-4 text-white">
            <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-center gap-3">
              {view === "editor" && (
                <button
                  onClick={() => setView("list")}
                  aria-label={t("back")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M11 18l-6-6 6-6" />
                  </svg>
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/75">
                  <span>📣</span>
                  <span className="truncate">
                    {view === "editor"
                      ? `${t("stepProgress", { current: stepIdx + 1, total: STEPS.length })} · ${stepLabel}`
                      : t("kicker")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-lg font-extrabold tracking-tight">
                    {view === "editor"
                      ? draft.name.trim() || t("title")
                      : t("title")}
                  </h3>
                  {view === "editor" && savedCampaign && (
                    <StatusPill
                      status={activeStatus}
                      label={t(`status_${activeStatus}`)}
                    />
                  )}
                </div>
              </div>
              {view === "editor" && savedCampaign && draft.id && (
                <button
                  onClick={() =>
                    setAnalyticsFor({ id: draft.id!, name: draft.name })
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
                  aria-label={t("analytics")}
                  title={t("analytics")}
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18M7 14l3-3 3 3 5-6" />
                  </svg>
                </button>
              )}
              {view === "editor" && savedCampaign && draft.id && (
                <button
                  onClick={() =>
                    deleteCampaign({ id: draft.id!, name: draft.name })
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
                  aria-label={t("deleteCampaign")}
                  title={t("deleteCampaign")}
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6" />
                  </svg>
                </button>
              )}
              <button
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
                aria-label={t("close")}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Stepper 1·2·3 — rend les 3 étapes explicites (numéro, libellé,
             *  état fait/actif/verrouillé, ligne de progression). */}
            {view === "editor" && (
              <div className="relative mt-3 flex items-center border-t border-white/15 pt-3">
                {STEPS.map((s, i) => {
                  const locked = s.key !== "setup" && !savedCampaign;
                  const active = tab === s.key;
                  const done =
                    !active &&
                    (s.key === "setup"
                      ? savedCampaign
                      : s.key === "contacts"
                        ? (currentStats?.total ?? 0) > 0
                        : activeStatus === "running" ||
                          activeStatus === "completed");
                  return (
                    <div
                      key={s.key}
                      className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => !locked && setTab(s.key)}
                        disabled={locked}
                        aria-current={active ? "step" : undefined}
                        className={`group flex shrink-0 items-center gap-2 ${
                          locked ? "cursor-not-allowed" : "cursor-pointer"
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold transition ${
                            active
                              ? "bg-white text-[#db2777] shadow-sm ring-2 ring-white/60"
                              : done
                                ? "bg-white/25 text-white"
                                : locked
                                  ? "bg-white/10 text-white/40"
                                  : "bg-white/15 text-white"
                          }`}
                        >
                          {done ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          ) : (
                            s.n
                          )}
                        </span>
                        <span
                          className={`whitespace-nowrap text-[12px] font-bold transition ${
                            active
                              ? "text-white"
                              : locked
                                ? "text-white/40"
                                : "text-white/85"
                          }`}
                        >
                          {t(
                            s.key === "setup"
                              ? "stepSetup"
                              : s.key === "contacts"
                                ? "stepContacts"
                                : "stepLaunch",
                          )}
                        </span>
                      </button>
                      {i < STEPS.length - 1 && (
                        <span
                          className={`mx-2 h-px flex-1 rounded ${
                            done ? "bg-white/60" : "bg-white/25"
                          }`}
                        />
                      )}
                    </div>
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
                onDelete={deleteCampaign}
                onAnalytics={(c) => setAnalyticsFor({ id: c.id, name: c.name })}
              />
            )}

            {view === "editor" && tab === "setup" && (
              <CampaignSetupStep
                draft={draft}
                onChange={patchDraft}
                agents={agents}
                fromNumbers={fromNumbers}
              />
            )}

            {view === "editor" && tab === "contacts" && draft.id && (
              <>
                <ContactsImportStep
                  campaignId={draft.id}
                  asUserId={asUserId}
                  onAdded={() => {
                    setContactsVersion((v) => v + 1);
                    void loadList();
                  }}
                />
                <CampaignContactsList
                  campaignId={draft.id}
                  asUserId={asUserId}
                  refreshKey={contactsVersion}
                />
              </>
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

          {/* Footer (editor / setup) — sauver + feedback + Suivant */}
          {view === "editor" && tab === "setup" && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#e2e8f0] bg-white px-6 py-3.5">
              <span className="min-w-0 truncate text-[12px] font-semibold">
                {saveError ? (
                  <span className="text-[#dc2626]">{saveError}</span>
                ) : justSaved ? (
                  <span className="inline-flex items-center gap-1.5 text-[#16a34a]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    {t("savedOk")}
                  </span>
                ) : null}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className={`rounded-xl px-5 py-2.5 text-sm font-bold shadow-sm transition disabled:opacity-60 ${
                    justSaved
                      ? "border border-[#e2e8f0] bg-white text-[#64748b] hover:bg-[#f8fafc]"
                      : "bg-gradient-to-br from-[#f97316] to-[#db2777] text-white hover:opacity-90"
                  }`}
                >
                  {saving
                    ? t("savingLabel")
                    : savedCampaign
                      ? t("saveCta")
                      : t("createCta")}
                </button>
                {savedCampaign && (
                  <button
                    onClick={() => setTab("contacts")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
                  >
                    {t("nextStepContacts")}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Footer (étape 2 — Contacts) : Précédent + Suivant → Lancement */}
          {view === "editor" && tab === "contacts" && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#e2e8f0] bg-white px-6 py-3.5">
              <button
                onClick={() => setTab("setup")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#64748b] transition hover:bg-[#f8fafc]"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M19 12H5M11 18l-6-6 6-6" />
                </svg>
                {t("prevStep")}
              </button>
              <button
                onClick={() => setTab("launch")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#f97316] to-[#db2777] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
              >
                {t("nextStepLaunch")}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}

          {/* Footer (étape 3 — Lancement) : Précédent (dernière étape) */}
          {view === "editor" && tab === "launch" && (
            <div className="flex shrink-0 items-center justify-start gap-3 border-t border-[#e2e8f0] bg-white px-6 py-3.5">
              <button
                onClick={() => setTab("contacts")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#64748b] transition hover:bg-[#f8fafc]"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M19 12H5M11 18l-6-6 6-6" />
                </svg>
                {t("prevStep")}
              </button>
            </div>
          )}
        </motion.div>
  );

  const analytics = analyticsFor && (
    <CampaignAnalytics
      campaignId={analyticsFor.id}
      campaignName={analyticsFor.name}
      asUserId={asUserId}
      onClose={() => setAnalyticsFor(null)}
    />
  );

  // Mode page : rendu inline dans le flux du layout (sous la nav), pas de
  // portal ni backdrop. Le X (onClose) ramène vers /dashboard côté page.
  if (isPage) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-5 sm:px-6">
        {dialog}
        {analytics}
      </div>
    );
  }

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
        <motion.div
          className="absolute inset-0 bg-[#0f172a]/55 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        {dialog}
      </div>
      {analytics}
    </AnimatePresence>,
    document.body,
  );
}
