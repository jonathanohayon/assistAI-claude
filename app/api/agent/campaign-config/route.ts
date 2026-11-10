import { NextRequest } from "next/server";

import { handleCampaignConfig } from "@/lib/agent/session-config/campaign";

// Legacy worker route — a thin wrapper since A3: same code as the single
// route /api/agent/session-config, response byte-identical to before.
export async function GET(req: NextRequest) {
  return handleCampaignConfig(req);
}
