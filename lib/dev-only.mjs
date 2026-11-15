// Dev-only switches. Every export here MUST be false in a production build:
// scripts/check-dev-only.mjs imports this module under NODE_ENV=production
// and fails `npm run build` if any export is not exactly false.
// Plain .mjs (not .ts) so that check runs with bare node, no tsx needed.

/**
 * GET /api/auth/login + GET /api/auth/callback: the old helper that sends you
 * to Google's consent screen, then swaps the auth code for a refresh_token and
 * prints it for .env.local. Both routes share this one flag (one flow).
 * Local dev only; 404 otherwise.
 * @type {boolean}
 */
export const DEV_OAUTH_HELPER_ENABLED = process.env.NODE_ENV !== "production";
