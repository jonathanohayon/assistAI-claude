// The real support number must never serve as an "E.164 example" in API or
// library code: examples use the mock +972500000000. The public site's
// contact pages (outside app/api and lib) keep the real number on purpose.
// Run with:  npx tsx scripts/tests/no-real-number-as-example.test.ts

import assert from "node:assert/strict";

import { assertScanRead, scanSources } from "./helpers/source-scan";

// Built by concatenation so this file never contains the literal itself.
const REAL_SUPPORT_NUMBER = "972" + "585001007";
const SENTINEL = "app/api/dashboard/config/route.ts";

const scan = scanSources(["app/api", "lib"], { ext: /\.(ts|tsx|js|mjs|json)$/ });

// The scan must have read the real tree, or "no match" proves nothing.
assertScanRead(scan, "no-real-number", { minFiles: 200, minPerRoot: 20, sentinels: [SENTINEL] });

// The sentinel still carries the mock example, so the scan reads current content.
assert.match(scan.text.get(SENTINEL) ?? "", /\+972500000000/, `${SENTINEL}: uses the mock E.164 example`);

const offenders = scan.files.filter((f) => scan.text.get(f)!.includes(REAL_SUPPORT_NUMBER));
assert.deepEqual(offenders, [], "no file under app/api or lib contains the real support number");

console.log(`ok: ${scan.files.length} files scanned, real support number absent from app/api and lib`);
