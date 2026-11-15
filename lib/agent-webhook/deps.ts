// Production wiring of the public agent webhook handler (the route).
import type { AgentWebhookDeps } from "@/lib/agent-webhook/handler";
import { resolveAgentToken } from "@/lib/agent-tokens";
import { logEvent } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/rate-limit-db";
import { resolveTenantByUserId } from "@/lib/tenant";

export const agentWebhookDeps: AgentWebhookDeps = {
  resolveToken: resolveAgentToken,
  resolveTenant: resolveTenantByUserId,
  consume: consumeRateLimit,
  openaiKey: () => process.env.OPENAI_API_KEY,
  fetch: (input, init) => fetch(input, init),
  // Error class only: a driver message could echo query parameters.
  logLimiterError: (e) => {
    void logEvent({
      source: "web",
      level: "error",
      event: "agent_webhook_rate_limit_failed",
      message: "Agent webhook: rate limiter unavailable",
      metadata: { error: e instanceof Error ? e.name : "unknown" },
    }).catch(() => {});
  },
};
