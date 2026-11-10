import { NextRequest } from "next/server";

import { handleOutboundTestConfig } from "@/lib/agent/session-config/outbound-test";

// Legacy worker route — a thin wrapper since A3: same code as the single
// route /api/agent/session-config, response byte-identical to before.
export async function GET(req: NextRequest) {
  return handleOutboundTestConfig(req);
}
