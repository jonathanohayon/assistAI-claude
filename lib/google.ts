import { calendar as calendarApi } from "@googleapis/calendar";
import { sheets as sheetsApi } from "@googleapis/sheets";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { outboundCallerUserId } from "@/lib/call-direction";
import { openStoredSecret } from "@/lib/crypto/unreadable-secret";
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
 * Per-tenant OAuth client — call with the tenant's stored refresh_token.
 * Calendar and Sheets share scopes so a single refresh_token covers both.
 */
export function getAuthenticatedClientFor(refreshToken: string) {
  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
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
  // E1: a sealed token that can't be opened = not connected (reported once).
  const refreshToken = openStoredSecret("google", me?.refreshToken);
  if (!me || !refreshToken) return null;
  return {
    calendar: getCalendarFor(refreshToken),
    sheets: getSheetsFor(refreshToken),
    calendarId: me.calendarId || "primary",
    sheetId: me.sheetId || null,
  };
}

/**
 * Injection seam for route tests (scripts/tests/calendar-anon-401.test.ts):
 * the session reader and the two DB lookups the resolver depends on. Route
 * handlers can then run outside Next with no DB and no Google. Production
 * code never reassigns these.
 */
export const agentCallerDeps = {
  auth: () => auth(),
  getTenantGoogleClients: (userId: string) => getTenantGoogleClients(userId),
  resolveTenantByPhone: (phone: string) => resolveTenantByPhone(phone),
};

export type AgentCallerGoogle =
  | {
      mode: "tenant";
      /** Tenant user id — lets callers attribute events (e.g. book_success). */
      userId: string;
      calendar: ReturnType<typeof getCalendarFor>;
      sheets: ReturnType<typeof getSheetsFor>;
      calendarId: string;
      sheetId: string | null;
    }
  | { mode: "user_no_google" }
  | { mode: "unknown_tenant"; dialedPhone: string }
  /** Neither the worker's secret nor a session: no Google client at all. */
  | { mode: "anonymous" };

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
 *   3. **Anonymous** (neither) — `anonymous`, no client. There used to be a
 *      "demo" mode here that ran on the env GOOGLE_CALENDAR_ID calendar, so
 *      anyone could read its free/busy; the home demo now uses canned tools
 *      (app/api/demo/tools, lib/demo-tools.ts) and the routes answer 401
 *      (requireAgentCaller below).
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
    // Outbound call (T4, lib/call-direction.ts): the account id ONLY — the
    // phone is our caller id (maybe the trunk's default number), never an
    // identity. No account id, or no valid secret → refused, never a
    // session / phone fallback.
    const outboundUserId = outboundCallerUserId(req.headers);
    if (outboundUserId !== null) {
      if (!expected || secret !== expected || !outboundUserId) return { mode: "unknown_tenant", dialedPhone: "" };
      const clients = await agentCallerDeps.getTenantGoogleClients(outboundUserId);
      if (!clients) return { mode: "user_no_google" };
      return { mode: "tenant", userId: outboundUserId, ...clients };
    }
    if (expected && secret === expected) {
      // Routing : priorité x-tenant-phone (SIP). Sinon x-tenant-user-id
      // (web LiveTest, où il n'y a pas de phone dialed). Sinon
      // unknown_tenant (refused).
      const dialed = (req.headers.get("x-tenant-phone") ?? "").trim();
      const tenantUserId = (req.headers.get("x-tenant-user-id") ?? "").trim();
      if (dialed) {
        const tenant = await agentCallerDeps.resolveTenantByPhone(dialed);
        if (!tenant) return { mode: "unknown_tenant", dialedPhone: dialed };
        const clients = await agentCallerDeps.getTenantGoogleClients(tenant.user.id);
        if (!clients) return { mode: "user_no_google" };
        return { mode: "tenant", userId: tenant.user.id, ...clients };
      }
      if (tenantUserId) {
        const clients = await agentCallerDeps.getTenantGoogleClients(tenantUserId);
        if (!clients) return { mode: "user_no_google" };
        return { mode: "tenant", userId: tenantUserId, ...clients };
      }
      return { mode: "unknown_tenant", dialedPhone: "" };
    }
  }

  const session = await agentCallerDeps.auth();
  if (session?.user?.id) {
    const tenant = await agentCallerDeps.getTenantGoogleClients(session.user.id);
    if (tenant) return { mode: "tenant", userId: session.user.id, ...tenant };
    return { mode: "user_no_google" };
  }

  return { mode: "anonymous" };
}

export const AGENT_CALLER_UNAUTHORIZED_BODY = {
  error: "unauthorized",
  message: "Authentication required (x-internal-secret or a session).",
} as const;

/**
 * Gate for the agent-facing calendar / sheets routes, run FIRST in the
 * handler: a request with neither the worker's internal secret nor a
 * signed-in session gets 401 before any validation, log write or Google
 * call. Anything else passes through untouched, so the worker and session
 * paths keep their exact behaviour (resolveAgentCallerGoogle decides the
 * rest). The secret test is the resolver's own.
 */
export async function requireAgentCaller(
  req: { headers: Headers },
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const expected = process.env.INTERNAL_SECRET;
  if (expected && req.headers.get("x-internal-secret") === expected) return { ok: true };
  const session = await agentCallerDeps.auth();
  if (session?.user?.id) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(AGENT_CALLER_UNAUTHORIZED_BODY, { status: 401 }),
  };
}
