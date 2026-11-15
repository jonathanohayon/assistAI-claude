import { NextRequest } from "next/server";

import { recapEmailCodeDeps } from "@/lib/recap-email-code/deps";
import { handleConfirmRecapEmailCode } from "@/lib/recap-email-code/handler";

export const dynamic = "force-dynamic";

// Confirms the saved recap address with the code it received: body { code }.
// ?asUserId=<tenant> for admins. Contract: lib/recap-email-code/handler.ts.
export async function POST(req: NextRequest) {
  return handleConfirmRecapEmailCode(req, recapEmailCodeDeps);
}
