// DEPRECATED path, kept as an alias for one release: the browser now calls
// the neutral /api/live-test/token (same handler, re-exported there).
//
// The dashboard live test's room token, for the signed-in tenant (or, for an
// admin, the ?asUserId tenant in the body). Rate-limited per tenant + globally
// before signing. Contract and codes: lib/live-test/handler.ts. Limits:
// lib/live-test/policy.ts. Signing: lib/live-test/mint.ts.
import { NextRequest } from "next/server";

import { liveTestDeps } from "@/lib/live-test/deps";
import { handleLiveTestToken } from "@/lib/live-test/handler";

export async function POST(req: NextRequest) {
  return handleLiveTestToken(req, liveTestDeps);
}
