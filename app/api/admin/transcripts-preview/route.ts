import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { isCallSubject } from "@/lib/call-subject";
import { normalizePhoneForDedup } from "@/lib/phone-utils";
import { queryTranscripts } from "@/lib/transcripts";

import { parseTranscriptDate } from "../../v1/transcripts/route";

/**
 * Preview admin de l'API publique v1 — réutilise EXACTEMENT queryTranscripts()
 * pour que l'admin voie ce que /api/v1/transcripts renverrait, mais en ciblant
 * n'importe quel tenant (param userId) sans avoir besoin de sa clé API.
 * Admin-gated (session + rôle admin).
 *
 * GET /api/admin/transcripts-preview?userId=...&phone=...&direction=...&subject=...
 *      &from=...&to=...&order=...&limit=...&offset=...
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const userId = (sp.get("userId") ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId_required" }, { status: 400 });
  }
  const phone = (sp.get("phone") ?? "").trim();
  if (!phone || normalizePhoneForDedup(phone).length < 6) {
    return NextResponse.json({ error: "phone_required" }, { status: 400 });
  }
  const direction = (sp.get("direction") ?? "all").toLowerCase();
  if (!["all", "inbound", "outbound"].includes(direction)) {
    return NextResponse.json({ error: "invalid_direction" }, { status: 400 });
  }
  const subjectParam = sp.get("subject");
  if (subjectParam && !isCallSubject(subjectParam)) {
    return NextResponse.json({ error: "invalid_subject" }, { status: 400 });
  }
  const from = parseTranscriptDate(sp.get("from"));
  const to = parseTranscriptDate(sp.get("to"), true);
  const order =
    (sp.get("order") ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const limit = Math.min(
    200,
    Math.max(1, parseInt(sp.get("limit") ?? "50", 10) || 50),
  );
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);

  const { count, items } = await queryTranscripts(userId, {
    phone,
    direction: direction as "all" | "inbound" | "outbound",
    subject: isCallSubject(subjectParam) ? subjectParam : null,
    from,
    to,
    order,
    limit,
    offset,
  });

  return NextResponse.json({ phone, count, limit, offset, items });
}
