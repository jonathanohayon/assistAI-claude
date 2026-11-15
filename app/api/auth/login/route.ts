import { DEV_OAUTH_HELPER_ENABLED } from "@/lib/dev-only.mjs";
import { handleDevOAuthLogin } from "@/lib/dev-oauth-callback";

// Local dev only (see lib/dev-only.mjs): 404 in production, and lib/google is
// not even loaded there, so no OAuth client is built and no redirect is sent.
// Same flag as /api/auth/callback on purpose: login and callback are the two
// halves of one dev OAuth helper flow, so they are switched on and off together
// (and the build guard in scripts/check-dev-only.mjs already covers the flag).
export async function GET() {
  return handleDevOAuthLogin({
    enabled: DEV_OAUTH_HELPER_ENABLED,
    loadOAuthClient: async () => (await import("@/lib/google")).getOAuthClient(),
  });
}
