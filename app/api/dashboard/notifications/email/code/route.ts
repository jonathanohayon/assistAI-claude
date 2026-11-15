import { NextRequest } from "next/server";

import { recapEmailCodeDeps } from "@/lib/recap-email-code/deps";
import { handleSendRecapEmailCode } from "@/lib/recap-email-code/handler";

export const dynamic = "force-dynamic";

// Sends a 6-digit confirmation code to the account's SAVED recap address
// (never an address from the request), rate-limited; neutral error codes.
// ?asUserId=<tenant> for admins. Contract: lib/recap-email-code/handler.ts.
export async function POST(req: NextRequest) {
  return handleSendRecapEmailCode(req, recapEmailCodeDeps);
}
