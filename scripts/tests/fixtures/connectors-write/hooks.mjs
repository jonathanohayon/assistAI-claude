// Module hooks for scripts/tests/connectors-write-db.test.ts ONLY (loaded
// with `tsx --import`). They swap three modules for test doubles, by
// specifier, everywhere in the app graph:
//   @/auth                              → a session the test sets
//   @/lib/connectors/tamaravox-numbers  → the mock tamaravox numbers the test sets
//   @/lib/tools/client-agent-test       → records the test call, never reaches a URL
import { registerHooks } from "node:module";

const here = (f) => new URL(f, import.meta.url).href;
const MAP = {
  "@/auth": new URL("../campaigns-plan-gate/mock-auth.ts", import.meta.url).href,
  "@/lib/connectors/tamaravox-numbers": here("./mock-vox.ts"),
  "@/lib/tools/client-agent-test": here("./mock-client-agent-test.ts"),
};
globalThis.__campgateHooks = true;
globalThis.__connectorsWriteHooks = true;
registerHooks({
  resolve(specifier, context, next) {
    const url = MAP[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});
