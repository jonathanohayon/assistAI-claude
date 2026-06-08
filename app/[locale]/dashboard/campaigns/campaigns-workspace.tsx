"use client";

/**
 * Workspace plein écran du centre d'appels sortant. Ouvert depuis la tuile
 * "Centre d'appels sortant" de config-form (premium/admin uniquement).
 *
 * Vues : list → editor (Setup | Contacts | Launch). L'editor crée/édite une
 * campagne ; Contacts & Launch se déverrouillent une fois la campagne créée.
 * Monitor live + analytics animées sont branchés dans les phases suivantes.
 */

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
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
import { CampaignMonitor } from "./campaign-monitor-step";
import { CampaignResults } from "./campaign-results-step";
import { StatusPill } from "./_ui";

type View = "list" | "editor";
type EditorTab = "setup" | "contacts" | "launch";

// Les 3 étapes de l'editor, dans l'ordre, pour le stepper.
const STEPS: { key: EditorTab; n: number }[] = [
  { key: "setup", n: 1 },
  { key: "contacts", n: 2 },
  { key: "launch", n: 3 },
];

function emptyDraft(locale: string, defaultName: string): CampaignDraft {
  return {
    name: defaultName,
    goalPreset: "cold",
    objective: "",
    fromNumber: "",
    // Valeurs par défaut de la persona : agent "Sarah", voix "marin",
    // langue = celle de l'utilisateur. Éditables dans l'étape "Agent / voix".
    persona: { agentName: "Sarah", voice: "marin", language: locale },
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
  const locale = useLocale();
  const catalog = useRealtimeCatalog();
  const voices = useMemo(() => voicesForCatalog(catalog, ""), [catalog]);

  const [view, setView] = useState<View>("list");
  const [tab, setTab] = useState<EditorTab>("setup");
  const [list, setList] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromNumbers, setFromNumbers] = useState<string[]>([]);

  // Campagne en cours d'édition.
  const [draft, setDraft] = useState<CampaignDraft>(() =>
    emptyDraft(locale, t("newCampaign")),
  );
  const [activeStatus, setActiveStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Modal ouvert : verrouille le scroll de l'arrière-plan + Échap pour fermer.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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
    return () => {
      cancelled = true;
    };
  }, [open, qs, t]);

  const openNew = () => {
    setDraft(emptyDraft(locale, t("newCampaign")));
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
    // Overlay AU-DESSUS du header du site (z-40) → aucune collision possible.
    // Bottom-sheet sur mobile (items-end), centré sur desktop. Hauteur max-h
    // (pas figée) + scroll interne du body → pleinement responsive.
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <motion.div
        className="absolute inset-0 bg-[#0f172a]/55 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-[#f8fafc] shadow-2xl sm:max-h-[88vh] sm:rounded-3xl"
      >
          {/* Header dégradé chaud (haut du modal, reste visible — le body scrolle
           *  en interne). overflow-hidden : clip du halo + coins arrondis. */}
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

            {/* Stepper 1·2·3 — rend les 3 étapes explicites (numéro, libellé,
             *  état fait/actif/verrouillé, ligne de progression). */}
            {view === "editor" && (
              <div className="relative mt-4 flex items-center">
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
                        className={`group flex items-center gap-2 ${
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

          {/* Body — scroll interne (le reste du modal reste fixe). min-h-0
           *  indispensable pour que flex-1 + overflow fonctionnent. */}
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
              <div className="space-y-5">
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
                <CampaignMonitor
                  campaignId={draft.id}
                  asUserId={asUserId}
                  status={activeStatus}
                />
                <CampaignResults campaignId={draft.id} asUserId={asUserId} />
              </div>
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
  );
}
