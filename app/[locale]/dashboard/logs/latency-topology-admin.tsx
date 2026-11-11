"use client";

/**
 * Latency chart — ADMIN-ONLY infra topology (where each component ran for
 * this call). /api/dashboard/call-metrics only sends `topology` to admins,
 * and latency-chart.tsx loads this file with next/dynamic only when a point
 * carries it, so the supplier names below never reach a tenant's browser.
 */

import { useTranslations } from "next-intl";

export type LatencyTopology = {
  twilio?: string;
  worker?: string;
  web?: string;
  livekit?: string;
  engine?: string;
};

export function LatencyTopologyAdmin({ topology }: { topology: LatencyTopology }) {
  const t = useTranslations("DashboardLogs.latency");
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
      <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-[#475569]">
        {t("topologyHeading")}
      </p>
      <dl className="grid grid-cols-1 gap-1 text-[11px]">
        {(
          [
            ["Twilio", topology.twilio, "#ec4899"],
            ["Worker", topology.worker, "#be185d"],
            ["Web", topology.web, "#22d3ee"],
            ["LiveKit", topology.livekit, "#0e7490"],
            [t("topologyEngine"), topology.engine, "#7c3aed"],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-[#475569]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="font-medium">{label}</span>
            </dt>
            <dd className="truncate font-mono text-[10px] tabular-nums text-[#18181b]">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
