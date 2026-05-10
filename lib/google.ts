import { google } from "googleapis";

const ONBOARDING_REDIRECT_PATH = "/api/onboarding/google/callback";

const inferAppOrigin = (): string => {
  // Prefer AUTH_URL (canonical public URL set on Railway), fall back to
  // APP_URL, then localhost. Used to compute the exact redirect URI we
  // pass to Google when initiating OAuth — must match what's whitelisted
  // in Google Cloud Console.
  const url =
    process.env.AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  return url.replace(/\/$/, "");
};

export function getOAuthClient(redirectUri?: string) {
  const fallback = process.env.GOOGLE_REDIRECT_URI;
  const explicit = redirectUri ?? `${inferAppOrigin()}${ONBOARDING_REDIRECT_PATH}`;
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri ? explicit : (fallback ?? explicit),
  );
}

/**
 * Legacy global client — uses GOOGLE_REFRESH_TOKEN from env. Used by the
 * agent's calendar/sheets tools when a tenant hasn't connected their own
 * Google account yet.
 */
export function getAuthenticatedClient() {
  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

/**
 * Per-tenant OAuth client — call with the tenant's stored refresh_token.
 * Calendar and Sheets share scopes so a single refresh_token covers both.
 */
export function getAuthenticatedClientFor(refreshToken: string) {
  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

export function getCalendar() {
  return google.calendar({ version: "v3", auth: getAuthenticatedClient() });
}

export function getSheets() {
  return google.sheets({ version: "v4", auth: getAuthenticatedClient() });
}

export function getCalendarFor(refreshToken: string) {
  return google.calendar({
    version: "v3",
    auth: getAuthenticatedClientFor(refreshToken),
  });
}

export function getSheetsFor(refreshToken: string) {
  return google.sheets({
    version: "v4",
    auth: getAuthenticatedClientFor(refreshToken),
  });
}
