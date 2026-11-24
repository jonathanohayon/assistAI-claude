import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { loadConnectorsPage } from "@/lib/connectors/page";

export const dynamic = "force-dynamic";

// GET /api/dashboard/connectors (B1, read only) → ConnectorsPageView
// (lib/connectors/types.ts). Tenant scope; ?asUserId= for admins.
//   connectors: the account's rows, else (ZERO rows) the derived legacy card
//     from tools_config.clientAgent when it is enabled with a url;
//   limits { max, used, inTrial }; canAdd { ok, reason? }.
// The secret is never returned (secretSet only). Nothing is written.
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const page = await loadConnectorsPage(r.userId);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(page);
}
