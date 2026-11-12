// Public landing demo agent: what /api/session (demo:true, or any anonymous
// caller) still takes from the demo account configured in /admin. A demo
// caller can't supply its own instructions, and nothing here is sent to the
// browser (lib/demo-session.ts).
//
// The home demo is public, so NO stored text of the demo account reaches its
// prompt: not its instructions, agent name or greeting, not its business
// (centres, centresRules, services, hours, prices). The prompt is the fixed
// demo persona and the fictional place sheet, both in code
// (lib/demo-instructions.ts, lib/demo-place.ts). Only two non-textual
// choices are read: the voice and the model the session runs on. An
// admin-editable demo script may come back later as an explicit field.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { getDemoUserId } from "@/lib/settings";

// Re-exported for callers that imported it from here.
export { DEMO_SESSION_OPENING } from "@/lib/demo-instructions";

export interface DemoAgent {
  voice: string | null;
  model: string | null;
}

export async function loadDemoAgent(): Promise<DemoAgent | null> {
  const demoUserId = await getDemoUserId();
  if (!demoUserId) return null;
  const [cfg] = await db
    .select({ voice: agentConfigs.voice, model: agentConfigs.model })
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, demoUserId))
    .limit(1);
  if (!cfg) return null;
  return { voice: cfg.voice ?? null, model: cfg.model ?? null };
}
