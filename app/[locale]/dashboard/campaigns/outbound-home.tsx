"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";

import { AgentsWorkspace } from "./agents/agents-workspace";
import { CampaignsWorkspace } from "./campaigns-workspace";

type View = "hub" | "agents" | "campaigns";

/**
 * Accueil « Appels sortants » — deux boxes : Agents (identités IA
 * réutilisables) et Campagnes (associent un agent + des numéros). Chaque box
 * ouvre son workspace en mode page (inline sous la nav). Vue pilotée par état
 * interne plutôt que par sous-routes → plus simple, pas de gating à dupliquer.
 */
export function OutboundHome({ asUserId }: { asUserId?: string }) {
  const t = useTranslations("DashboardCampaigns");
  const [view, setView] = useState<View>("hub");
  const [counts, setCounts] = useState<{ agents: number; campaigns: number }>({
    agents: 0,
    campaigns: 0,
  });

  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/dashboard/outbound-agents${qs}`)
        .then((r) => (r.ok ? r.json() : { agents: [] }))
        .catch(() => ({ agents: [] })),
      fetch(`/api/dashboard/campaigns${qs}`)
        .then((r) => (r.ok ? r.json() : { campaigns: [] }))
        .catch(() => ({ campaigns: [] })),
    ]).then(([a, c]) => {
      if (cancelled) return;
      setCounts({
        agents: (a.agents ?? []).length,
        campaigns: (c.campaigns ?? []).length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [qs, view]);

  if (view === "agents")
    return (
      <AgentsWorkspace asUserId={asUserId} onBack={() => setView("hub")} />
    );

  if (view === "campaigns")
    return (
      <CampaignsWorkspace
        open
        variant="page"
        asUserId={asUserId}
        onClose={() => setView("hub")}
      />
    );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mb-6 text-center"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#94a3b8]">
          {t("homeKicker")}
        </p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-[#18181b] sm:text-3xl">
          {t("homeTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] text-[#64748b]">
          {t("homeSubtitle")}
        </p>
      </motion.div>

      <AnimatePresence>
        <div className="grid gap-4 sm:grid-cols-2">
          <HubCard
            index={0}
            onClick={() => setView("agents")}
            accent="from-[#6366f1] to-[#8b5cf6]"
            soft="bg-[#ede9fe] text-[#6d28d9]"
            kicker={t("agentsBoxStep")}
            title={t("agentsBoxTitle")}
            desc={t("agentsBoxDesc")}
            cta={t("agentsBoxCta")}
            count={t("agentsCount", { count: counts.agents })}
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="8" width="16" height="11" rx="3" />
                <path d="M12 8V4M9 13h.01M15 13h.01M2 12v3M22 12v3" />
              </svg>
            }
          />
          <HubCard
            index={1}
            onClick={() => setView("campaigns")}
            accent="from-[#f97316] to-[#db2777]"
            soft="bg-[#ffedd5] text-[#c2410c]"
            kicker={t("campaignsBoxStep")}
            title={t("campaignsBoxTitle")}
            desc={t("campaignsBoxDesc")}
            cta={t("campaignsBoxCta")}
            count={t("campaignsCount", { count: counts.campaigns })}
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11v3a1 1 0 0 0 1 1h3l4 4V7L7 11H4a1 1 0 0 0-1 0ZM16 8a5 5 0 0 1 0 8M19.5 5a9 9 0 0 1 0 14" />
              </svg>
            }
          />
        </div>
      </AnimatePresence>

      <p className="mt-5 text-center text-[12px] text-[#94a3b8]">
        {t("homeFlowHint")}
      </p>
    </div>
  );
}

function HubCard({
  index,
  onClick,
  accent,
  soft,
  kicker,
  title,
  desc,
  cta,
  count,
  icon,
}: {
  index: number;
  onClick: () => void;
  accent: string;
  soft: string;
  kicker: string;
  title: string;
  desc: string;
  cta: string;
  count: string;
  icon: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, type: "spring", stiffness: 300, damping: 28 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-3xl border border-[#e2e8f0] bg-white p-6 text-left shadow-sm transition hover:shadow-xl"
    >
      <div
        className={`pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${accent} opacity-10 blur-2xl transition group-hover:opacity-20`}
      />
      <div className="relative flex items-center justify-between">
        <span className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${accent} text-white shadow-md`}>
          {icon}
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${soft}`}>
          {count}
        </span>
      </div>
      <p className="relative mt-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">
        {kicker}
      </p>
      <h3 className="relative mt-0.5 text-lg font-extrabold tracking-tight text-[#18181b]">
        {title}
      </h3>
      <p className="relative mt-1.5 text-[13px] leading-relaxed text-[#64748b]">
        {desc}
      </p>
      <span
        className={`relative mt-4 inline-flex items-center gap-1.5 self-start rounded-full bg-gradient-to-br ${accent} px-4 py-2 text-[13px] font-bold text-white shadow-sm transition group-hover:gap-2.5`}
      >
        {cta}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </motion.button>
  );
}
