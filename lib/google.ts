import { eq } from "drizzle-orm";
import { google } from "googleapis";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

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

export interface TenantGoogleClients {
  calendar: ReturnType<typeof getCalendarFor>;
  sheets: ReturnType<typeof getSheetsFor>;
  calendarId: string;
  sheetId: string | null;
}

/**
 * Returns Google clients scoped to the user's own refresh token, or null if
 * they haven't connected Google yet. Never falls back to the global admin
 * credentials — callers must handle the null case (typically: render a
 * "connect Google" CTA instead of leaking the admin calendar/sheet).
 */
export async function getTenantGoogleClients(
  userId: string,
): Promise<TenantGoogleClients | null> {
  const [me] = await db
    .select({
      refreshToken: users.googleRefreshToken,
      calendarId: users.googleCalendarId,
      sheetId: users.googleSheetId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!me?.refreshToken) return null;
  return {
    calendar: getCalendarFor(me.refreshToken),
    sheets: getSheetsFor(me.refreshToken),
    calendarId: me.calendarId || "primary",
    sheetId: me.sheetId || null,
  };
}

export type AgentCallerGoogle =
  | {
      mode: "tenant";
      calendar: ReturnType<typeof getCalendarFor>;
      sheets: ReturnType<typeof getSheetsFor>;
      calendarId: string;
      sheetId: string | null;
    }
  | { mode: "user_no_google" }
  | {
      mode: "demo";
      calendar: ReturnType<typeof getCalendar>;
      sheets: ReturnType<typeof getSheets>;
      calendarId: string;
      sheetId: string | null;
    };

/**
 * Resolves the Google clients an agent route should use:
 *  - logged-in user with Google connected → their own calendar/sheet
 *  - logged-in user WITHOUT Google connected → "user_no_google" so the route
 *    can refuse rather than leaking the admin's calendar
 *  - no session (e.g. public marketing demo on Hero) → global admin credentials
 *
 * Phone-routed agent calls (SIP) aren't yet covered — they need a separate
 * mechanism (signed header + dialed number → tenant).
 */
export async function resolveAgentCallerGoogle(): Promise<AgentCallerGoogle> {
  const session = await auth();
  if (session?.user?.id) {
    const tenant = await getTenantGoogleClients(session.user.id);
    if (tenant) return { mode: "tenant", ...tenant };
    return { mode: "user_no_google" };
  }
  return {
    mode: "demo",
    calendar: getCalendar(),
    sheets: getSheets(),
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    sheetId: process.env.GOOGLE_SHEET_ID || null,
  };
}
