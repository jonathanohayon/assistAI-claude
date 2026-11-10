import { NextRequest } from "next/server";

import { handleInboundConfig } from "@/lib/agent/session-config/inbound";

// Legacy worker route — a thin wrapper since A3: same code as the single
// route /api/agent/session-config, response byte-identical to before.
export async function GET(req: NextRequest) {
  return handleInboundConfig(req);
}
