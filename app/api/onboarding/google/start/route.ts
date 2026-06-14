import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api/auth-guards";
import { getOAuthClient } from "@/lib/google";

// Chemin de retour sûr : interne uniquement (commence par "/" mais pas "//"
// ni "/\\") → évite un open-redirect via le param returnTo.
function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/onboarding";
  }
  return raw;
}

// Initiate Google OAuth for the currently logged-in tenant. We embed the
// user id in the OAuth `state` so the callback can attribute the resulting
// refresh token to the right account. `returnTo` (optionnel) = chemin où
// revenir après le callback (ex: depuis la tuile CRM → "/dashboard/crm").
//
// Redirect URI must point to /api/onboarding/google/callback and be
// whitelisted in the Google OAuth client config (Cloud Console).
export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));

  // Random state seeded with the user id. The callback verifies the seed
  // matches by base64-encoding the userId and comparing.
  const nonce = randomBytes(8).toString("hex");
  const state = Buffer.from(
    JSON.stringify({ uid: guard.userId, n: nonce, rt: returnTo }),
  ).toString("base64url");

  const oauth = getOAuthClient();
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force refresh_token even if already authorized once
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    state,
  });

  return NextResponse.redirect(url);
}
