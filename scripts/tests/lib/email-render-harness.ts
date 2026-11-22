// Test harness: runs the REAL lib/email.ts send functions in-process with
//   - "resend" replaced by a fake client that only records each payload
//     (nothing is ever sent), and
//   - "next-intl/server" replaced by next-intl's own createTranslator over
//     messages/<locale>.json (getTranslations needs the Next request scope).
// Import it FIRST in a test file, before lib/email.ts loads.
import Module from "node:module";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url).pathname;
const FAKES: Record<string, string> = {
  resend: join(ROOT, "scripts/tests/lib/email-fake-resend.ts"),
  "next-intl/server": join(ROOT, "scripts/tests/lib/email-fake-next-intl-server.ts"),
};

const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
const resolve = M._resolveFilename;
M._resolveFilename = function (req: string, ...rest: unknown[]) {
  return FAKES[req] ?? resolve.call(this, req, ...rest);
};

// A key is required for lib/email.ts to build a client: the fake one sees it.
process.env.RESEND_API_KEY = "mock-not-a-key";
process.env.EMAIL_FROM = "Tamara <noreply@example.test>";
globalThis.fetch = (async () => {
  throw new Error("network is disabled in this test");
}) as typeof fetch;

export { sentEmails } from "./email-fake-resend";
