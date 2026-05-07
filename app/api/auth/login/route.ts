import { NextResponse } from "next/server";
import { getOAuthClient } from "@/lib/google";

export async function GET() {
  const auth = getOAuthClient();

  const url = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });

  return NextResponse.redirect(url);
}
