import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getOAuthClient } from "@/lib/google";
import { logEvent } from "@/lib/logger";

// Google OAuth callback. Verifies the state matches the logged-in user,
// exchanges the code for a refresh token, and persists it on the user row.
// On success, redirect back to /onboarding (or /dashboard if already there).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    await logEvent({
      source: "auth",
      event: "google_oauth_denied",
      message: `Google OAuth refusé : ${error}`,
      level: "warn",
      userId: session.user.id,
      metadata: { error },
    });
    return NextResponse.redirect(new URL("/onboarding?google=denied", req.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/onboarding?google=missing", req.url));
  }

  // Verify state binds to this user — defends against the OAuth flow being
  // hijacked across tabs/users.
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString()) as {
      uid?: string;
    };
  } catch {
    return NextResponse.redirect(
      new URL("/onboarding?google=bad_state", req.url),
    );
  }
  if (parsed.uid !== session.user.id) {
    return NextResponse.redirect(
      new URL("/onboarding?google=user_mismatch", req.url),
    );
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
      return NextResponse.redirect(
        new URL("/onboarding?google=no_refresh", req.url),
      );
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

    return NextResponse.redirect(
      new URL("/onboarding?google=connected", req.url),
    );
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
    return NextResponse.redirect(
      new URL(`/onboarding?google=error&msg=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
