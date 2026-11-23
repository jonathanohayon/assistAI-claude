// Module hooks for scripts/tests/schedule-change-db.test.ts ONLY (loaded with
// `tsx --import`). Swaps @/auth for a test double whose session the test sets.
import { registerHooks } from "node:module";

const MAP = { "@/auth": new URL("./mock-auth.ts", import.meta.url).href };
globalThis.__schedHooks = true;
registerHooks({
  resolve(specifier, context, next) {
    const url = MAP[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});
