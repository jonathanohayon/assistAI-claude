import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { loadConnectorsPage } from "@/lib/connectors/page";
import { connectorsWriteGate, jsonBody, respond } from "@/lib/connectors/route-gate";
import { parseConnectorCreate } from "@/lib/connectors/validate";
import { createConnector } from "@/lib/connectors/write";

export const dynamic = "force-dynamic";

// GET /api/dashboard/connectors (B1, read only) → ConnectorsPageView
// (lib/connectors/types.ts). Tenant scope; ?asUserId= for admins.
//   connectors: the account's rows, else (ZERO rows) the derived legacy card
//     from tools_config.clientAgent when it is enabled with a url;
//   limits { max, used, inTrial }; canAdd { ok, reason? };
//   legacyConversion { willConvert, numberE164 } (B4).
// The secret is never returned (secretSet only). Nothing is written.
export async function GET(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const page = await loadConnectorsPage(r.userId);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(page);
}

// POST /api/dashboard/connectors (B4, behind CONNECTORS_WRITE) — create.
//   { name, url, mode, phoneNumberId, voiceConfig?, enabled?, acknowledgeLegacyConversion? }
//   → 201 { connector, generatedSecret (ONCE), legacyConvertedId?, page }.
// Refusals: lib/connectors/write.ts createConnector (codes in the PR / below).
export async function POST(req: NextRequest) {
  const gate = await connectorsWriteGate(req);
  if (!gate.ok) return gate.response;
  const parsed = parseConnectorCreate(await jsonBody(req));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, fields: parsed.fields }, { status: 400 });
  return respond(await createConnector(gate.actor, parsed.value));
}
