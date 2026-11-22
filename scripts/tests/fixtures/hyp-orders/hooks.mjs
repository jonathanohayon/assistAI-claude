// Module hooks for scripts/tests/hyp-orders-db.test.ts ONLY (loaded with
// `tsx --import`). They swap two modules for test doubles, by specifier,
// everywhere in the app graph:
//   @/auth  → a session the test sets (the campaigns-plan-gate double)
//   resend  → records every email, never sends
//   next-intl/server → getTranslations over messages/*.json (the production
//                      translator), since tsx is not an RSC runtime
// HYP itself is never reached: the test replaces globalThis.fetch
// (mock-hyp.ts), which refuses any URL that is not the mock HYP host.
import { registerHooks } from "node:module";

const here = (f) => new URL(f, import.meta.url).href;
const MAP = {
  "@/auth": here("../campaigns-plan-gate/mock-auth.ts"),
  resend: here("./mock-resend.ts"),
  "next-intl/server": here("./mock-next-intl-server.ts"),
};
globalThis.__campgateHooks = true;
globalThis.__hypOrdersHooks = true;
registerHooks({
  resolve(specifier, context, next) {
    const url = MAP[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});
