import { NextRequest, NextResponse } from "next/server";

import { resolveScopeUserId } from "@/lib/admin-impersonate";
import { requireSession } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { logEvent } from "@/lib/logger";
import { loadOwnerRecapEmail, saveOwnerRecapEmail } from "@/lib/owner-recap-email-store";

// GET /api/dashboard/notifications/email[?asUserId=<uuid>]
// PUT /api/dashboard/notifications/email[?asUserId=<uuid>]
//   body: { ownerRecapEmail?: string | null, ownerRecapEmailEnabled?: boolean }
//
// The owner's post-call recap by email: an address and an ON/OFF switch
// (default OFF). The tenant's own account, or an admin on a tenant via
// ?asUserId. Nothing here is admin-only. A field absent from the PUT body
// keeps its stored value; `ownerRecapEmail: ""` (or null) clears the address.
//
// Responses:
//   200 { ownerRecapEmail, ownerRecapEmailEnabled }  (+ changedFields on PUT)
//   400 { error: "invalid_email" | "invalid_boolean", fields: [field] } · 400 { error: "invalid_json" }
//   401 not signed in · 403 asUserId by a non-admin · 404 no agent config
async function scope(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return { response: guard.response };
  const s = await resolveScopeUserId({
    sessionUserId: guard.userId,
    asUserId: req.nextUrl.searchParams.get("asUserId"),
  });
  if ("forbidden" in s) return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { userId: s.userId, sessionUserId: guard.userId };
}

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if ("response" in s) return s.response;
  const settings = await loadOwnerRecapEmail(s.userId);
  if (!settings) return NextResponse.json({ error: "no_config" }, { status: 404 });
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const s = await scope(req);
  if ("response" in s) return s.response;
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.response;
  const result = await saveOwnerRecapEmail(s.userId, parsed.data);
  if (result.status === 200 && result.body.changedFields.length > 0) {
    // No address in the event: field names only.
    await logEvent({
      source: "web",
      event: "owner_recap_email_updated",
      message: `Owner recap email settings updated (${result.body.changedFields.join(", ")})`,
      userId: s.userId,
      metadata: { changedFields: result.body.changedFields, by: s.sessionUserId === s.userId ? "owner" : "admin" },
    });
  }
  return NextResponse.json(result.body, { status: result.status });
}
