import { NextRequest } from "next/server";

import { DEV_OAUTH_HELPER_ENABLED } from "@/lib/dev-only.mjs";
import { handleDevOAuthCallback } from "@/lib/dev-oauth-callback";

// Local dev only (see lib/dev-only.mjs): 404 in production, and lib/google is
// not even loaded there, so no OAuth client is ever built.
export async function GET(req: NextRequest) {
  return handleDevOAuthCallback(req, {
    enabled: DEV_OAUTH_HELPER_ENABLED,
    loadOAuthClient: async () => (await import("@/lib/google")).getOAuthClient(),
  });
}
