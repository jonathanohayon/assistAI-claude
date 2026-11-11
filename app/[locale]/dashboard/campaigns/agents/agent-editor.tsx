"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { LiveTestPanelLK } from "@/components/LiveTestPanelLK";
import { VoiceBrick } from "@/components/bricks/voice/VoiceBrick";
import { PersonaBrick } from "@/components/bricks/persona/PersonaBrick";
import { KnowledgeBrick } from "@/components/bricks/knowledge/KnowledgeBrick";
import { SessionPreview } from "@/components/bricks/knowledge/SessionPreview";
import { ToolsBrick } from "@/components/bricks/tools/ToolsBrick";
import { activeCount, toolsBrickVisible, type ToolsResponse } from "@/components/bricks/tools/tools-ui";
// The screen holds what GET sends: Tools without the client agent secret.
import type { CapabilityKey, PublicTools as Tools } from "@/lib/tools/contract";
import type { SheetIssue } from "@/components/bricks/knowledge/knowledge-ui";
import type { CompanySheet } from "@/lib/knowledge/contract";
import type { Persona } from "@/lib/persona/contract";
import type { ClientVoice } from "@/components/bricks/voice/voice-client";
import type { OutboundAgentDraft } from "@/lib/outbound-agents/types";

import { useVoiceLabel } from "@/lib/use-voice-label";

// Éditeur d'agent sortant — MÊME système de tuiles + panneaux que la config
// entrante (config-form.tsx) pour une cohérence visuelle totale : grille de
// tuiles colorées → panneau inline sous la grille. Réutilise les libellés
// i18n inbound (namespace DashboardConfig) pour voix/personnalité/notifs.

type TileId = "voice" | "persona" | "business" | "tools" | "notifs" | "channels";
type TileDef = { id: TileId; label: string; tagline: string; summary: string; accent: string; icon: React.ReactNode };

export function AgentEditor({
  draft,
  set,
  persona,
  onPersonaChange,
  voice,
  onVoiceChange,
  isAdmin,
  asUserId,
  sheet,
  onSheetChange,
  sheetIssues,
  outboundUsesCompanySheet,
  savedKey,
  dirty = false,
  toolsServed,
  tools,
  onToolsChange,
  toolsRefused = null,
}: {
  draft: OutboundAgentDraft;
  set: (patch: Partial<OutboundAgentDraft>) => void;
  persona: Persona;
  onPersonaChange: (p: Persona) => void;
  voice: ClientVoice;
  onVoiceChange: (v: ClientVoice) => void;
  isAdmin: boolean;
  asUserId?: string;
  /** The ACCOUNT's company sheet (shared by every agent), null while loading. */
  sheet: CompanySheet | null;
  onSheetChange: (next: CompanySheet) => void;
  sheetIssues: SheetIssue[];
  /** Server-told, per account: does the outbound agent read the sheet (S5)? */
  outboundUsesCompanySheet: boolean;
  /** Changes after each save (the level-3 preview reloads). */
  savedKey?: number;
  /** Unsaved changes: the Live Test (saved agent) says to save first. */
  dirty?: boolean;
  /** Tools brick: null for a new (unsaved) agent, or while loading. */
  toolsServed: ToolsResponse | null;
  tools: Tools | null;
  onToolsChange: (next: Tools) => void;
  /** The last tools save was refused for these capabilities (403 outbound_tools_disabled). */
  toolsRefused?: CapabilityKey[] | null;
}) {
  const t = useTranslations("DashboardCampaigns");
  const tKnowledge = useTranslations("KnowledgeBrick");
  const tTools = useTranslations("ToolsBrick");
  const voiceLabel = useVoiceLabel();
  const [activeTile, setActiveTile] = useState<TileId | null>("voice");

  // The Tools tile exists only when the server lets this account's outbound
  // calls use tools: no answer yet (new agent, loading) or visible=false →
  // no tile at all, never an empty one.
  const showTools = toolsBrickVisible("outbound", toolsServed);
  const TILES: TileDef[] = [
    {
      id: "voice",
      label: t("sectionVoice"),
      tagline: t("agentTagVoice"),
      summary: voiceLabel(voice.voiceId),
      accent: "from-[#06b6d4] to-[#0e7490]",
      icon: <IconMic />,
    },
    {
      id: "business",
      label: t("sectionBusiness"),
      tagline: t("agentTagBusiness"),
      summary: sheet?.identity.name || "—",
      accent: "from-[#f59e0b] to-[#b45309]",
      icon: <IconBuilding />,
    },
    {
      id: "persona",
      label: t("sectionPersona"),
      tagline: t("agentTagPersona"),
      summary: `${draft.agentName} · ${draft.language.toUpperCase()}`,
      accent: "from-[#be185d] to-[#ec4899]",
      icon: <IconPerson />,
    },
    ...(showTools && toolsServed
      ? [
          {
            id: "tools" as const,
            label: tTools("tileLabel"),
            tagline: tTools("tileTaglineOutbound"),
            summary: tTools("tileSummary", { n: activeCount(toolsServed.capabilities, "outbound") }),
            accent: "from-[#0e7490] to-[#155e75]",
            icon: <IconTools />,
          },
        ]
      : []),
    {
      id: "notifs",
      label: t("sectionNotifs"),
      tagline: t("agentTagNotifs"),
      summary: draft.notifications.whatsapp || draft.notifications.email ? t("agentNotifOn") : "—",
      accent: "from-[#22d3ee] to-[#0e7490]",
      icon: <IconBell />,
    },
    {
      id: "channels",
      label: t("sectionChannels"),
      tagline: t("agentTagChannels"),
      summary: [draft.channels.phone !== false && "PSTN", draft.channels.whatsappVoice && "WA"].filter(Boolean).join(" · ") || "—",
      accent: "from-[#25D366] to-[#128C7E]",
      icon: <IconChat />,
    },
  ];

  const active = TILES.find((x) => x.id === activeTile);

  return (
    <div className="space-y-4">
      <AgentEditorStyles />


      {/* Grille de tuiles (même look que les appels entrants) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TILES.map((tile, i) => (
          <Tile
            key={tile.id}
            tile={tile}
            active={activeTile === tile.id}
            delay={i * 50}
            onClick={() =>
              setActiveTile((cur) => (cur === tile.id ? null : tile.id))
            }
          />
        ))}
      </div>

      {/* Panneau actif inline (même chrome que config entrante) */}
      {active && (
        <div
          key={active.id}
          className="anim-fade-up overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 shadow-[0_4px_24px_-8px_rgba(99,102,241,0.18)] backdrop-blur-xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] bg-gradient-to-br from-white/60 to-white/30 px-5 py-4 sm:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${active.accent} text-white shadow-md`}>
                {active.icon}
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-extrabold tracking-tight text-[#18181b]">
                  {active.label}
                </h3>
                <p className="truncate text-xs text-[#475569]">{active.tagline}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTile(null)}
              aria-label={t("close")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/80 text-[#475569] transition-all hover:bg-[#fee2e2] hover:text-[#dc2626]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>
          <div className="px-5 py-6 sm:px-7">
            {active.id === "voice" && (
              <VoiceBrick
                value={voice}
                onChange={onVoiceChange}
                isAdmin={isAdmin}
                asUserId={asUserId ?? null}
                primaryLanguage={draft.language}
                // The agent's Live Test is below the editor at every width; a new agent has none yet.
                liveTestLink={draft.id ? { targetId: "agent-live-test", direction: "down" } : undefined}
              />
            )}
            {active.id === "persona" && (
              <div className="flex flex-col gap-5">
                <PersonaBrick
                  value={persona}
                  onChange={onPersonaChange}
                  kind="outbound"
                  isAdmin={isAdmin}
                  asUserId={asUserId ?? null}
                />
              </div>
            )}
            {active.id === "business" &&
              (sheet ? (
                <KnowledgeBrick
                  kind="outbound"
                  sheet={sheet}
                  onSheetChange={onSheetChange}
                  issues={sheetIssues}
                  instructions={draft.instructions}
                  onInstructionsChange={(instructions) => set({ instructions })}
                  outboundUsesCompanySheet={outboundUsesCompanySheet}
                  agentLearned={{
                    text: draft.knowledge,
                    sources: draft.knowledgeSources ?? [],
                    language: draft.language,
                    onChange: ({ text, sources }) => set({ knowledge: text, knowledgeSources: sources }),
                  }}
                  isAdmin={isAdmin}
                  asUserId={asUserId ?? null}
                  devPanel={
                    // A saved agent (its test call reads the base); the server decides the scope.
                    draft.id ? <SessionPreview asUserId={asUserId ?? null} agentId={draft.id} refreshKey={savedKey} /> : undefined
                  }
                />
              ) : (
                <p className="text-sm text-[#475569]" aria-busy="true">
                  {tKnowledge("loading")}
                </p>
              ))}
            {active.id === "tools" && toolsServed && tools && (
              <ToolsBrick
                kind="outbound"
                served={toolsServed}
                tools={tools}
                onChange={onToolsChange}
                returnTo="/dashboard/campaigns"
                asUserId={asUserId ?? null}
                refused={toolsRefused}
              />
            )}
            {active.id === "notifs" && <NotifsPanel draft={draft} set={set} t={t} />}
            {active.id === "channels" && <ChannelsPanel draft={draft} set={set} t={t} asUserId={asUserId} />}
          </div>
        </div>
      )}

      {/* Tester en live — même panneau que les appels entrants. Disponible une
       *  fois l'agent enregistré (le worker lit la config depuis la base). */}
      {draft.id ? (
        <div id="agent-live-test" className="scroll-mt-24 overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 p-4 shadow-[0_4px_24px_-8px_rgba(99,102,241,0.18)] backdrop-blur-xl sm:p-5">
          <LiveTestPanelLK dirty={dirty} asUserId={asUserId} agentId={draft.id} />
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-4 text-center text-[12px] text-[#64748b]">
          {t("agentTestSaveFirst")}
        </p>
      )}
    </div>
  );
}

// ─── Tuile (copie du markup inbound) ────────────────────────────────────────

function Tile({
  tile,
  active,
  onClick,
  delay = 0,
}: {
  tile: TileDef;
  active: boolean;
  onClick: () => void;
  delay?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ animationDelay: `${delay}ms` }}
      className={`anim-bounce-in group relative flex aspect-square cursor-pointer flex-col items-start justify-between overflow-hidden rounded-2xl border-2 p-4 text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1] ${
        active
          ? "border-[#6366f1] bg-white shadow-[0_8px_32px_-8px_rgba(99,102,241,0.4)] -translate-y-0.5"
          : "border-white/40 bg-white/70 backdrop-blur-xl hover:-translate-y-1 hover:border-[#6366f1]/40 hover:bg-white hover:shadow-lg"
      }`}
    >
      {active && (
        <span aria-hidden className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${tile.accent} opacity-15 blur-2xl`} />
      )}
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tile.accent} text-white shadow-md transition-transform group-hover:scale-110 group-hover:rotate-3`}>
        {tile.icon}
      </span>
      <div className="relative w-full min-w-0">
        <p className="text-base font-extrabold tracking-tight text-[#18181b]">{tile.label}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] font-medium italic leading-snug text-[#6d28d9]">{tile.tagline}</p>
        <p className="mt-1 truncate text-[10px] text-[#475569]">{tile.summary}</p>
      </div>
      {active && (
        <span aria-hidden className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#6366f1] motion-safe:animate-pulse" />
      )}
    </button>
  );
}

// ─── Panneau Notifications : NotifChannelCard (copie inbound) ────────────────

function NotifsPanel({
  draft, set, t,
}: {
  draft: OutboundAgentDraft;
  set: (patch: Partial<OutboundAgentDraft>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[#475569]">{t("notifsHint")}</p>
      <NotifChannelCard
        label={t("notifsWhatsappLabel")}
        color="#25D366"
        on={Boolean(draft.notifications.whatsapp)}
        onToggle={(on) => set({ notifications: { ...draft.notifications, whatsapp: on ? draft.notifications.whatsapp ?? "" : "" } })}
        value={draft.notifications.whatsapp ?? ""}
        onChangeValue={(v) => set({ notifications: { ...draft.notifications, whatsapp: v } })}
        placeholder="+33…"
        inputType="tel"
        testEndpoint="/api/dashboard/notifications/whatsapp-test"
        icon={<svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20z" /></svg>}
      />
      <NotifChannelCard
        label={t("notifsEmailLabel")}
        color="#0e7490"
        on={Boolean(draft.notifications.email)}
        onToggle={(on) => set({ notifications: { ...draft.notifications, email: on ? draft.notifications.email ?? "" : "" } })}
        value={draft.notifications.email ?? ""}
        onChangeValue={(v) => set({ notifications: { ...draft.notifications, email: v } })}
        placeholder="owner@…"
        inputType="email"
        icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></svg>}
      />
    </div>
  );
}

function NotifChannelCard({
  label, icon, color, on, onToggle, value, onChangeValue, placeholder, inputType, testEndpoint,
}: {
  label: string; icon: React.ReactNode; color: string; on: boolean;
  onToggle: (v: boolean) => void; value: string; onChangeValue: (v: string) => void;
  placeholder: string; inputType: string; testEndpoint?: string;
}) {
  const tc = useTranslations("DashboardConfig");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const test = async () => {
    if (!on || status !== "idle" || !testEndpoint || !value.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch(testEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: value }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setStatus(!res.ok || !data.ok ? "error" : "sent");
      setTimeout(() => setStatus("idle"), 3500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3500);
    }
  };
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all duration-300 ${on ? "border-[#22d3ee]/40 bg-white shadow-[0_4px_20px_-8px_rgba(34,211,238,0.35)]" : "border-[#cbd5e1] bg-white hover:border-[#22d3ee]/30"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: on ? color : "#f1f5f9", color: on ? "white" : "#94a3b8" }}>{icon}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#18181b]">{label}</p>
            <p className="text-[11px] text-[#475569]">{on ? <span className="inline-flex items-center gap-1 font-medium text-[#0e7490]"><span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] motion-safe:animate-pulse" />{tc("wowChannelActive")}</span> : tc("wowChannelInactive")}</p>
          </div>
        </div>
        <button
          type="button" role="switch" aria-checked={on} aria-label={label}
          onClick={() => onToggle(!on)}
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-all duration-300 ${on ? "bg-gradient-to-r from-[#22d3ee] to-[#0e7490]" : "bg-[#94a3b8] hover:bg-[#64748b]"}`}
        >
          <span aria-hidden className="block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300" style={{ transform: on ? "translateX(20px)" : "translateX(0)" }} />
        </button>
      </div>
      <div className="flex gap-2">
        <input type={inputType} value={value} onChange={(e) => onChangeValue(e.target.value)} placeholder={placeholder} disabled={!on} className="min-w-0 flex-1 rounded-xl border border-[#e2e8f0] bg-white/80 px-3 py-2 font-mono text-xs text-[#18181b] transition-all focus:border-[#0e7490] focus:outline-none focus:ring-4 focus:ring-[#0e7490]/15 disabled:cursor-not-allowed disabled:opacity-40" />
        {testEndpoint && (
          <button
            type="button" onClick={test}
            disabled={!on || status !== "idle" || !value.trim()}
            className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${status === "sent" ? "border-[#22d3ee]/40 bg-[#ecfeff] text-[#0e7490]" : status === "error" ? "border-[#dc2626]/40 bg-[#fee2e2] text-[#991b1b]" : "border-[#0e7490]/30 bg-white text-[#0e7490] hover:border-[#0e7490] hover:bg-[#ecfeff]"}`}
          >
            {status === "sending" ? tc("wowTestSending") : status === "sent" ? tc("wowTestSent") : tc("wowTestButton")}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Panneau Canaux ─────────────────────────────────────────────────────────

function ChannelsPanel({
  draft, set, t, asUserId,
}: {
  draft: OutboundAgentDraft;
  set: (patch: Partial<OutboundAgentDraft>) => void;
  t: ReturnType<typeof useTranslations>;
  asUserId?: string;
}) {
  const [numbers, setNumbers] = useState<string[]>([]);
  useEffect(() => {
    const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
    let cancelled = false;
    fetch(`/api/dashboard/channels${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch"))))
      .then((data: { numbers?: Array<{ phoneNumber: string; channel: string }> }) => {
        if (cancelled) return;
        setNumbers((data.numbers ?? []).filter((n) => n.channel === "pstn").map((n) => n.phoneNumber));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [asUserId]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-[#475569]">{t("channelsHint")}</p>
      <div className="space-y-2">
        <ToggleRow label={t("channelsPhone")} on={draft.channels.phone !== false} onToggle={(on) => set({ channels: { ...draft.channels, phone: on } })} />
        <ToggleRow label={t("channelsWhatsappVoice")} on={draft.channels.whatsappVoice === true} onToggle={(on) => set({ channels: { ...draft.channels, whatsappVoice: on } })} />
      </div>
      {numbers.length > 0 && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#128C7E]">{t("channelsNumbersLabel")}</p>
          <ul className="space-y-1.5">
            {numbers.map((n) => (
              <li key={n} className="flex items-center gap-2 text-[13px] text-[#18181b]">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#dcfce7] text-[#128C7E]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                </span>
                <span className="font-mono" dir="ltr">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="rounded-xl bg-[#f1f5f9] px-3 py-2 text-[11px] text-[#64748b]">{t("channelsFromNumberNote")}</p>
    </div>
  );
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button type="button" onClick={() => onToggle(!on)} className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 text-left transition hover:border-[#25D366]/50">
      <span className="text-[13px] font-semibold text-[#334155]">{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${on ? "bg-[#25D366]" : "bg-[#cbd5e1]"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────


function IconMic() { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /></svg>; }
function IconBuilding() { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M9 7h.01M15 7h.01M9 11h.01M15 11h.01" /></svg>; }
function IconPerson() { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>; }
function IconTools() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
    </svg>
  );
}

function IconBell() { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>; }
function IconChat() { return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.1a8.5 8.5 0 0 1-.9-3.9 8.38 8.38 0 0 1 8.4-9 8.5 8.5 0 0 1 8.6 8.4Z" /></svg>; }

// Sous-ensemble des animations inbound (config-form les définit dans son propre
// <style> ; ici le composant est monté ailleurs → on les ré-injecte).
function AgentEditorStyles() {
  return (
    <style>{`
      @keyframes ae-fade-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
      @keyframes ae-bounce-in { 0% { opacity: 0; transform: scale(0.9); } 100% { opacity: 1; transform: scale(1); } }
      .anim-fade-up { animation: ae-fade-up 0.4s ease-out backwards; }
      .anim-bounce-in { animation: ae-bounce-in 0.45s cubic-bezier(0.34,1.56,0.64,1) backwards; }
      .fancy-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 9999px; outline: none; cursor: pointer; }
      .fancy-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 9999px; background: #fff; border: 2px solid #0891b2; box-shadow: 0 1px 4px rgba(8,145,178,0.4); cursor: pointer; transition: transform 0.15s; }
      .fancy-slider:hover::-webkit-slider-thumb { transform: scale(1.15); }
      .fancy-slider::-moz-range-thumb { width: 18px; height: 18px; border-radius: 9999px; background: #fff; border: 2px solid #0891b2; cursor: pointer; }
      @media (prefers-reduced-motion: reduce) { .anim-fade-up, .anim-bounce-in { animation: none; } }
    `}</style>
  );
}
