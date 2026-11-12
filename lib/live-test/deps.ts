// Production wiring of the live-test token handler (the route). Tests reuse
// it and replace only the session and the signer.
import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { resolveScopeUserId } from "@/lib/admin-impersonate";
import { db } from "@/lib/db";
import { outboundAgents } from "@/lib/db/schema";
import type { LiveTestDeps } from "@/lib/live-test/handler";
import { mintLiveTestToken } from "@/lib/live-test/mint";
import {
  LIVE_TEST_BUCKET,
  LIVE_TEST_GLOBAL_LIMIT,
  LIVE_TEST_PER_ACCOUNT_LIMIT,
  LIVE_TEST_WINDOW_MS,
} from "@/lib/live-test/policy";
import { logEvent } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/rate-limit-db";

const creds = () => {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
};

export const liveTestDeps: LiveTestDeps = {
  session: async () => {
    const s = await auth();
    return s?.user?.id ? { userId: s.user.id, email: s.user.email ?? null } : null;
  },
  configured: () => creds() !== null,
  resolveScope: (sessionUserId, asUserId) => resolveScopeUserId({ sessionUserId, asUserId }),
  // accountId = the scoped tenant (the ?asUserId target for admins).
  claim: (userId) =>
    consumeRateLimit({
      bucket: LIVE_TEST_BUCKET,
      accountId: userId,
      windowMs: LIVE_TEST_WINDOW_MS,
      perAccount: LIVE_TEST_PER_ACCOUNT_LIMIT,
      global: LIVE_TEST_GLOBAL_LIMIT,
    }),
  findOutboundAgent: async (agentId, userId) => {
    const [a] = await db
      .select({ id: outboundAgents.id })
      .from(outboundAgents)
      .where(and(eq(outboundAgents.id, agentId), eq(outboundAgents.userId, userId)))
      .limit(1);
    return a?.id ?? null;
  },
  mint: async (input) => {
    const c = creds();
    if (!c) throw new Error("live-test signer not configured");
    return mintLiveTestToken(c, input);
  },
  logLimiterError: (userId, e) =>
    logEvent({
      source: "web",
      level: "error",
      event: "live_test_rate_limit_failed",
      message: "Live test: rate limiter unavailable",
      userId,
      metadata: { error: e instanceof Error ? e.message.slice(0, 200) : "unknown" },
    }),
};
