import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getOAuthClient } from "@/lib/google";
import { logEvent } from "@/lib/logger";

// Google OAuth callback. Verifies the state matches the logged-in user,
// exchanges the code for a refresh token, and persists it on the user row.
// On success, redirect back to /onboarding (or /dashboard if already there).
//
// Important : derrière le reverse-proxy Railway, `req.url` rend l'URL interne
// (localhost:8080), donc on dérive l'origine publique via getAppOrigin()
// (x-forwarded-host / AUTH_URL) avant de construire les redirects.
export async function GET(req: NextRequest) {
  const origin = await getAppOrigin();
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, origin));

  const session = await auth();
  if (!session?.user?.id) {
    return redirectTo("/login");
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // Chemin de retour encodé dans le state (rt) → on revient là où l'utilisateur
  // a cliqué (ex: /dashboard/crm). Défaut /onboarding. Validé interne.
  let back = "/onboarding";
  if (state) {
    try {
      const s = JSON.parse(Buffer.from(state, "base64url").toString()) as {
        rt?: string;
      };
      if (
        typeof s.rt === "string" &&
        s.rt.startsWith("/") &&
        !s.rt.startsWith("//") &&
        !s.rt.startsWith("/\\")
      ) {
        back = s.rt;
      }
    } catch {
      /* state illisible → /onboarding */
    }
  }
  const backWith = (q: string) =>
    `${back}${back.includes("?") ? "&" : "?"}${q}`;

  if (error) {
    await logEvent({
      source: "auth",
      event: "google_oauth_denied",
      message: `Google OAuth refusé : ${error}`,
      level: "warn",
      userId: session.user.id,
      metadata: { error },
    });
    return redirectTo(backWith("google=denied"));
  }

  if (!code || !state) {
    return redirectTo(backWith("google=missing"));
  }

  // Verify state binds to this user — defends against the OAuth flow being
  // hijacked across tabs/users.
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString()) as {
      uid?: string;
    };
  } catch {
    return redirectTo(backWith("google=bad_state"));
  }
  if (parsed.uid !== session.user.id) {
    return redirectTo(backWith("google=user_mismatch"));
  }

  try {
    const oauth = getOAuthClient();
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      // No refresh token returned → user has already consented before. Tell
      // them to revoke access and retry, or we'll never get a refresh token.
      await logEvent({
        source: "auth",
        event: "google_oauth_no_refresh",
        message: "Google n'a pas renvoyé de refresh_token",
        level: "warn",
        userId: session.user.id,
      });
      return redirectTo(backWith("google=no_refresh"));
    }

    await db
      .update(users)
      .set({ googleRefreshToken: tokens.refresh_token })
      .where(eq(users.id, session.user.id));

    await logEvent({
      source: "auth",
      event: "google_oauth_connected",
      message: `Google connecté pour ${session.user.email}`,
      userId: session.user.id,
    });

    return redirectTo(backWith("google=connected"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth failed";
    await logEvent({
      source: "auth",
      event: "google_oauth_failed",
      message: `Google OAuth échoué : ${msg.slice(0, 200)}`,
      level: "error",
      userId: session.user.id,
      metadata: { error: msg },
    });
    return redirectTo(backWith(`google=error&msg=${encodeURIComponent(msg)}`));
  }
}
