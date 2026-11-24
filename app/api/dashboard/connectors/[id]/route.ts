import { NextRequest, NextResponse } from "next/server";

import { connectorsWriteGate, jsonBody, respond } from "@/lib/connectors/route-gate";
import { parseConnectorPatch } from "@/lib/connectors/validate";
import { patchConnector } from "@/lib/connectors/write";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// B4, behind CONNECTORS_WRITE (off → 404 connectors_write_off). Tenant
// scope; ?asUserId= for admins. [id] = a connector uuid, or "legacy" (the
// derived card: a PATCH converts it into a real row first).
//
// PATCH { name?, url?, mode?, voiceConfig?, enabled?, rotateSecret?, acknowledgeLegacyConversion? }
//   omitted = kept; the number can't be changed (400 number_not_editable).
//   → 200 { connector, generatedSecret? (rotateSecret only), legacyConvertedId?, page }.
// No DELETE here (Next answers 405): the soft delete lands in its own PR.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await connectorsWriteGate(req);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = parseConnectorPatch(await jsonBody(req));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, fields: parsed.fields }, { status: 400 });
  return respond(await patchConnector(gate.actor, id, parsed.value));
}
