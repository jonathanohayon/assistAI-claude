import { calendar as calendarApi } from "@googleapis/calendar";
import { sheets as sheetsApi } from "@googleapis/sheets";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { resolveTenantByPhone } from "@/lib/tenant";

// On utilise les packages éclatés `@googleapis/calendar` + `@googleapis/
// sheets` + `google-auth-library` au lieu du monolithe `googleapis` qui
// tire 200+ APIs Google. Gain : ~200 packages en moins + bundle plus
// léger côté build.

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
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: redirectUri ? explicit : (fallback ?? explicit),
  });
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
  return calendarApi({ version: "v3", auth: getAuthenticatedClient() });
}

export function getSheets() {
  return sheetsApi({ version: "v4", auth: getAuthenticatedClient() });
}

export function getCalendarFor(refreshToken: string) {
  return calendarApi({
    version: "v3",
    auth: getAuthenticatedClientFor(refreshToken),
  });
}

export function getSheetsFor(refreshToken: string) {
  return sheetsApi({
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
  | { mode: "unknown_tenant"; dialedPhone: string }
  | {
      mode: "demo";
      calendar: ReturnType<typeof getCalendar>;
      sheets: ReturnType<typeof getSheets>;
      calendarId: string;
      sheetId: string | null;
    };

/**
 * Resolves the Google clients an agent route should use, in priority order:
 *
 *   1. **SIP/LiveKit worker** — when the request carries
 *      `x-internal-secret: $INTERNAL_SECRET` and `x-tenant-phone: <E.164>`,
 *      we resolve the tenant by the dialed number via resolveTenantByPhone()
 *      and use their stored Google credentials. Refuses (`unknown_tenant` /
 *      `user_no_google`) instead of falling back to admin.
 *
 *   2. **Logged-in user** (dashboard live-test) — uses the session user's
 *      own credentials. Refuses with `user_no_google` if they haven't
 *      connected Google yet.
 *
 *   3. **Public demo** (marketing Hero, no session) — uses the global admin
 *      credentials so the homepage demo keeps working.
 *
 * `req` is optional only so callers without one (none currently) keep
 * compiling; pass it whenever available so SIP routing works.
 */
export async function resolveAgentCallerGoogle(
  req?: { headers: Headers },
): Promise<AgentCallerGoogle> {
  if (req) {
    const secret = req.headers.get("x-internal-secret");
    const expected = process.env.INTERNAL_SECRET;
    if (expected && secret === expected) {
      // Routing : priorité x-tenant-phone (SIP). Sinon x-tenant-user-id
      // (web LiveTest, où il n'y a pas de phone dialed). Sinon
      // unknown_tenant → fallback demo.
      const dialed = (req.headers.get("x-tenant-phone") ?? "").trim();
      const tenantUserId = (req.headers.get("x-tenant-user-id") ?? "").trim();
      if (dialed) {
        const tenant = await resolveTenantByPhone(dialed);
        if (!tenant) return { mode: "unknown_tenant", dialedPhone: dialed };
        const clients = await getTenantGoogleClients(tenant.user.id);
        if (!clients) return { mode: "user_no_google" };
        return { mode: "tenant", ...clients };
      }
      if (tenantUserId) {
        const clients = await getTenantGoogleClients(tenantUserId);
        if (!clients) return { mode: "user_no_google" };
        return { mode: "tenant", ...clients };
      }
      return { mode: "unknown_tenant", dialedPhone: "" };
    }
  }

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
