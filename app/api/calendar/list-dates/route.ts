import { NextRequest, NextResponse } from "next/server";

import { requireInternalSecret } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { CENTERS, type Center, labelFor, nextDatesForCenter } from "@/lib/schedule";

// Returns the next N valid dates for a given center per the schedule rules.
// Deterministic, no Google round-trip — the agent calls this instead of
// computing "next Tuesday" itself, eliminating an entire class of LLM
// arithmetic errors.
//
// Auth: same INTERNAL_SECRET gate as the other agent-facing endpoints, so
// only the worker can hit it. No tenant lookup needed (schedule is shared).
export async function POST(req: NextRequest) {
  const guard = requireInternalSecret(req);
  if (!guard.ok) return guard.response;

  const parsed = await parseJsonBody<{
    center?: string;
    count?: number;
    after?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const { center, count, after } = parsed.data;

  if (!center || !CENTERS.includes(center as Center)) {
    return NextResponse.json(
      {
        error: `center invalide. Valeurs : ${CENTERS.join(", ")}`,
        valid_centers: CENTERS,
      },
      { status: 400 },
    );
  }

  const n = Math.max(1, Math.min(10, Number(count) || 3));
  const afterDate = typeof after === "string" && /^\d{4}-\d{2}-\d{2}$/.test(after)
    ? after
    : undefined;

  try {
    const dates = nextDatesForCenter(center as Center, n, afterDate);
    return NextResponse.json({
      center,
      label: labelFor(center as Center),
      dates,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
