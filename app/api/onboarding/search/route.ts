import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { searchAvailableNumbers } from "@/lib/twilio-numbers";

// GET /api/onboarding/search?country=US&area=212&limit=5
// Returns a list of available numbers the user can pick from.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const country = (req.nextUrl.searchParams.get("country") ?? "US").toUpperCase();
  const area = req.nextUrl.searchParams.get("area")?.trim() || undefined;
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? "5"), 1),
    20,
  );

  try {
    const numbers = await searchAvailableNumbers({
      countryCode: country,
      areaCode: area,
      limit,
      voiceEnabled: true,
    });
    return NextResponse.json({ numbers, countryCode: country });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "search failed" },
      { status: 500 },
    );
  }
}
