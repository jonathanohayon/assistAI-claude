// Per-tenant turn limit for the public agent webhook (/api/v1/agent/[token]).
// Each POST is one OpenAI call on our bill. A real phone conversation makes at
// most ~20 turns a minute, so 60/min per tenant never limits a call but caps
// what a leaked URL can cost. In-memory, per process (see lib/rate-limit).
import { createRateLimiter } from "@/lib/rate-limit";

export const AGENT_TURNS_PER_MINUTE = 60;

export function createAgentTurnLimiter() {
  return createRateLimiter({ limit: AGENT_TURNS_PER_MINUTE, windowMs: 60_000 });
}
