// Build-time guard (runs first in `npm run build`): every export of
// lib/dev-only.mjs must evaluate to false under NODE_ENV=production, the
// value `next build` bundles server code with. Exit 1 otherwise.
//
//   node scripts/check-dev-only.mjs [modulePath]   (default: lib/dev-only.mjs)
import path from "node:path";
import { pathToFileURL } from "node:url";

const target = path.resolve(process.argv[2] ?? "lib/dev-only.mjs");
process.env.NODE_ENV = "production"; // set before the import: the module reads it at load time
const mod = await import(pathToFileURL(target).href);

const entries = Object.entries(mod);
const bad = entries.filter(([, v]) => v !== false);
if (entries.length === 0) {
  console.error(`check-dev-only: ${target} exports nothing`);
  process.exit(1);
}
if (bad.length > 0) {
  for (const [k, v] of bad) console.error(`check-dev-only: ${k} is ${JSON.stringify(v)} under NODE_ENV=production (must be false)`);
  process.exit(1);
}
console.log(`check-dev-only: ${entries.length} dev-only flag(s) off in production`);
