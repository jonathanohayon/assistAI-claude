import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { undoCompanySheetReset } from "@/lib/company-sheet-reset";
import { warmGreetingAudioForUser } from "@/lib/greeting-warm";
import { logEvent } from "@/lib/logger";
import { isUuid, parseUndoBody } from "@/lib/persona-reset-rules";

// ADMIN ONLY. POST { resetId, force? } restores the exact business, knowledge
// and company_sheet a company-sheet reset replaced. Rule
// (lib/company-sheet-reset-rules.ts): only the account's most recent
// company-sheet reset, once (409 not_latest_reset / already_undone), and only
// while those three values are still what the reset wrote: otherwise 409
// edited_since_reset { fields }, unless force: true. Persona resets are a
// separate kind and never interfere.
interface Ctx {
  params: Promise<{ userId: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { userId } = await ctx.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parseUndoBody(parsed.data);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const r = await undoCompanySheetReset(userId, body.resetId, body.force);
  if (r.status === 200) {
    await logEvent({
      source: "admin",
      event: "company_sheet_reset_undone",
      message: `Admin ${guard.admin.id} undid company sheet reset ${body.resetId} of ${userId}`,
      userId: guard.admin.id,
      metadata: { targetUserId: userId, resetId: body.resetId, by: guard.admin.id, forced: r.body.forced === true },
    });
    void warmGreetingAudioForUser(userId);
  }
  return NextResponse.json(r.body, { status: r.status });
}
