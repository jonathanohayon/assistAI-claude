// Module hooks for scripts/tests/demo-sheet-db.test.ts ONLY (loaded with
// `tsx --import`). They swap @/auth for a test double, by specifier,
// everywhere in the app graph: next-auth's auth() needs a Next request scope
// that a plain script does not have.
import { registerHooks } from "node:module";

const here = (f) => new URL(f, import.meta.url).href;
const MAP = { "@/auth": here("./mock-auth.ts") };
globalThis.__demoSheetHooks = true;
registerHooks({
  resolve(specifier, context, next) {
    const url = MAP[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});
