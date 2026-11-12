// Module hooks for scripts/tests/campaigns-plan-gate-db.test.ts ONLY (loaded
// with `tsx --import`). They swap three modules for test doubles, by
// specifier, everywhere in the app graph:
//   @/auth                 → a session the test sets (no next-auth request scope)
//   @/lib/campaigns/dial   → records the dial, never reaches LiveKit/Twilio
//   @/lib/plan-features    → can lift the 2026-11 force-off, to simulate a plan
//                            that HAS outbound_campaigns (none does today)
import { registerHooks } from "node:module";

const here = (f) => new URL(f, import.meta.url).href;
const MAP = {
  "@/auth": here("./mock-auth.ts"),
  "@/lib/campaigns/dial": here("./mock-dial.ts"),
  "@/lib/plan-features": here("./mock-plan-features.ts"),
};
globalThis.__campgateHooks = true;
registerHooks({
  resolve(specifier, context, next) {
    const url = MAP[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});
