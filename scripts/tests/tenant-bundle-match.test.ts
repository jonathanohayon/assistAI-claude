// The tenant-bundle matcher: real supplier and tool names are caught,
// per-request base64 noise is not. Mock strings only.
// Run with:  npx tsx scripts/tests/tenant-bundle-match.test.ts

import assert from "node:assert/strict";

import { hits, inBase64Run } from "../tenant-bundle-match.mjs";

const found = (text: string) => [...(hits(text) as Map<string, string[]>).keys()];

// Supplier names, anywhere.
assert.deepEqual(found("const c=useOpenaiRealtimeCatalog();"), ["openai", "realtime"]);
assert.deepEqual(found('fetch("/api/realtime/catalog/models/openai/list/all")'), ["realtime", "openai"]);
// Technical tool names, as whole words.
assert.deepEqual(found('{"name":"book_appointment"}'), ["book_appointment"]);
assert.deepEqual(found("call transfer_call then end_call"), ["transfer_call", "end_call"]);
assert.deepEqual(found("rebook_appointments_count"), [], "not a whole word");
// Plain words in copy are fine.
assert.deepEqual(found("Prendre des rendez-vous · Transférer à une personne"), []);
// Per-request base64 noise is skipped; a chunk path never is.
const blob = "e9aGnhKzjzrdUzbLsv0Ea9ZFsLx/UqxaiMcjn1TE+tICuJzrx9n5U7Tq6+JpgOG";
assert.equal(inBase64Run(blob, blob.indexOf("xai"), 3), true);
assert.deepEqual(found(blob), []);
assert.deepEqual(found("/_next/static/chunks/app/openai-abc123DEF456ghi789.js"), ["openai"]);

console.log("ALL TENANT-BUNDLE-MATCH TESTS PASSED");
