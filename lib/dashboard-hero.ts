// The dashboard hero's server data: the home KPIs (lib/dashboard-stats.ts,
// unchanged) plus agentState (lib/agent-state/compute.ts). Shared by
// /dashboard and the admin tenant view. SERVER-ONLY.

import type { DashboardStats } from "@/app/[locale]/dashboard/config/types";
import { computeAgentState } from "@/lib/agent-state/compute";
import { computeDashboardStats } from "@/lib/dashboard-stats";

export async function computeHeroStats(userId: string): Promise<DashboardStats> {
  const [stats, agentState] = await Promise.all([computeDashboardStats(userId), computeAgentState(userId)]);
  return { ...stats, agentState };
}
