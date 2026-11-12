import { NextRequest } from "next/server";

import { emailTestDeps } from "@/lib/email-test/deps";
import { handleEmailTest } from "@/lib/email-test/handler";

export const dynamic = "force-dynamic";

// Sends a branded test email to the account's OWN address only, rate-limited
// per account and globally; neutral error codes. Contract and codes:
// lib/email-test/handler.ts. Rules and limits: lib/email-test/policy.ts.
// ?asUserId=<tenant> for admins (sends to that tenant's own address).
// Locale: ?locale=fr|he|en, else Accept-Language, else fr.
export async function POST(req: NextRequest) {
  return handleEmailTest(req, emailTestDeps);
}
