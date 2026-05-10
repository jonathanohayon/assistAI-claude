import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getOAuthClient } from "@/lib/google";

// Initiate Google OAuth for the currently logged-in tenant. We embed the
// user id in the OAuth `state` so the callback can attribute the resulting
// refresh token to the right account.
//
// Redirect URI must point to /api/onboarding/google/callback and be
// whitelisted in the Google OAuth client config (Cloud Console).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Random state seeded with the user id. The callback verifies the seed
  // matches by base64-encoding the userId and comparing.
  const nonce = randomBytes(8).toString("hex");
  const state = Buffer.from(
    JSON.stringify({ uid: session.user.id, n: nonce }),
  ).toString("base64url");

  const oauth = getOAuthClient();
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force refresh_token even if already authorized once
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
    state,
  });

  return NextResponse.redirect(url);
}
