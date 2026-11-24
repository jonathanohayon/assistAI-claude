// Unit tests for lib/company-sheet-reset-rules.ts (the admin "clear the
// company sheet" rules) and the routes' sources. The DB side is
// scripts/tests/company-sheet-reset-db.test.ts (bash scripts/company-sheet-reset-db.sh).
// Run with:  npx tsx scripts/tests/company-sheet-reset.test.ts
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_BUSINESS, sanitizeBusinessConfig } from "../../lib/business";
import { clearedSheet, isSheetSnapshot, RESET_KIND, SHEET_FIELDS, sheetEditedSinceReset } from "../../lib/company-sheet-reset-rules";
import { displayNameKeptLine } from "../../lib/company-sheet-reset-copy";
import { knowledgeFromInbound } from "../../lib/knowledge/adapters";
import { inboundKnowledgeBlock } from "../../lib/knowledge/render";
import { parseUndoBody } from "../../lib/persona-reset-rules";
import { FIRST_CUSTOMER_FACTS } from "./first-customer-facts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

// What a reset writes: the code default business and no legacy entries.
const c = clearedSheet();
assert.deepEqual(c, { business: DEFAULT_BUSINESS, knowledge: [] });
assert.equal("companySheet" in c, false, "companySheet absent = the column becomes NULL");
assert.deepEqual(sanitizeBusinessConfig(null), DEFAULT_BUSINESS, "DEFAULT_BUSINESS is the sanitizer's fallback");
assert.doesNotMatch(JSON.stringify(c), FIRST_CUSTOMER_FACTS);
c.business.identity.name = "mutated";
assert.equal(DEFAULT_BUSINESS.identity.name, "", "clearedSheet returns a copy");
assert.equal(RESET_KIND, "company_sheet");

// The reason the legacy array is cleared too: with the cleared business, the
// inbound knowledge block falls back to the legacy entries.
const legacy = [{ businessName: "Mock Legacy Salon", openingHours: "9-18", description: "Mock legacy details" }];
assert.match(inboundKnowledgeBlock(knowledgeFromInbound({ business: DEFAULT_BUSINESS, instructions: "", knowledge: legacy })), /Mock Legacy Salon/);
assert.equal(inboundKnowledgeBlock(knowledgeFromInbound({ business: clearedSheet().business, instructions: "", knowledge: clearedSheet().knowledge })), "");

// The undo rule: a field counts as edited unless it is exactly what was written.
assert.deepEqual(SHEET_FIELDS, ["business", "knowledge", "companySheet"]);
assert.deepEqual(sheetEditedSinceReset({ business: true, knowledge: true, companySheet: true }), []);
assert.deepEqual(sheetEditedSinceReset({ business: false, knowledge: true, companySheet: null }), ["business", "companySheet"]);
assert.deepEqual(sheetEditedSinceReset({ business: undefined, knowledge: undefined, companySheet: undefined }), [...SHEET_FIELDS]);

// A stored snapshot must hold business + knowledge to be restored.
assert.equal(isSheetSnapshot({ business: DEFAULT_BUSINESS, knowledge: [] }), true);
assert.equal(isSheetSnapshot({ business: DEFAULT_BUSINESS, knowledge: [], companySheet: { version: 1 } }), true);
assert.equal(isSheetSnapshot({ business: DEFAULT_BUSINESS }), false);
assert.equal(isSheetSnapshot({ business: [], knowledge: [] }), false);
assert.equal(isSheetSnapshot({ instructions: "I", greetingInstructions: "G", agentName: "N" }), false, "a persona snapshot is not a sheet snapshot");
assert.equal(isSheetSnapshot(null), false);

// The undo body (shared with the persona undo).
const ID = "00000000-0000-4000-8000-000000000001";
assert.deepEqual(parseUndoBody({ resetId: ID, force: true }), { ok: true, resetId: ID, force: true });
assert.deepEqual(parseUndoBody({ resetId: ID, force: 1 }), { ok: false, error: "invalid_force" });
assert.deepEqual(parseUndoBody({}), { ok: false, error: "invalid_reset_id" });
assert.deepEqual(parseUndoBody("x"), { ok: false, error: "invalid_body" });

// The routes: admin-gated first; the event carries ids only.
const routes = ["app/api/admin/users/[userId]/reset-company-sheet/route.ts", "app/api/admin/users/[userId]/reset-company-sheet/undo/route.ts"];
for (const f of routes) {
  const src = read(f);
  const handlers = [...src.matchAll(/export async function (GET|POST)[^{]*\{\s*([^\n]*)\n\s*([^\n]*)/g)];
  assert.ok(handlers.length >= 1, f);
  for (const m of handlers) {
    assert.equal(m[2].trim(), "const guard = await requireAdmin();", `${f} ${m[1]}: requireAdmin first`);
    assert.equal(m[3].trim(), "if (!guard.ok) return guard.response;", `${f} ${m[1]}`);
  }
  assert.match(src, /source: "admin"/, f);
  assert.match(src, /metadata: \{ targetUserId: userId, resetId: [^,]+, by: guard\.admin\.id(, forced: [^}]+)? \}/, `${f}: ids only`);
  assert.match(src, /warmGreetingAudioForUser\(userId\)/, `${f}: greeting re-warmed`);
}
assert.match(read(routes[0]), /event: "company_sheet_reset"/);

// Every persona_resets read is scoped to its kind, on both sides.
// (A reset id is only ever found through these two kind-scoped lookups.)
const sheetLib = read("lib/company-sheet-reset.ts");
assert.match(sheetLib, /SELECT id, previous, undone_at FROM persona_resets\s+WHERE id = \$\{resetId\} AND user_id = \$\{userId\} AND kind = \$\{RESET_KIND\}/);
assert.match(sheetLib, /SELECT id FROM persona_resets WHERE user_id = \$\{userId\} AND kind = \$\{RESET_KIND\}/);
assert.match(sheetLib, /INSERT INTO persona_resets \(user_id, kind, [^)]*\)\s+SELECT \$\{userId\}, \$\{RESET_KIND\}/);
const personaLib = read("lib/persona-reset.ts");
assert.equal((personaLib.match(/\.from\(personaResets\)/g) ?? []).length, 3);
assert.equal((personaLib.match(/PERSONA\)\)/g) ?? []).length, 3, "the three persona reads filter kind = 'persona'");
assert.match(personaLib, /kind: "persona"/);

// The migration: add-only, idempotent.
const mig = read("drizzle/0064_persona_resets_kind.sql");
assert.match(mig, /ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'persona' NOT NULL/);
assert.match(mig, /CHECK \("persona_resets"\."kind" IN \('persona', 'company_sheet'\)\)/);
assert.match(mig, /EXCEPTION WHEN duplicate_object THEN NULL/);
assert.doesNotMatch(mig, /\b(UPDATE|DELETE|INSERT|DROP)\b/i, "no data step");

// The dialog's display-name line: users.display_name is kept, and said so.
assert.equal(displayNameKeptLine("Mock Salon"), "Le nom affiché reste : Mock Salon");
assert.equal(displayNameKeptLine("  Mock Salon "), "Le nom affiché reste : Mock Salon");
assert.equal(displayNameKeptLine(""), null, "empty → no line");
assert.equal(displayNameKeptLine("   "), null, "blank → no line");
assert.equal(displayNameKeptLine(null), null);
assert.equal(displayNameKeptLine(undefined), null);
// Rendered as a React text node, so markup in a name is escaped.
{
  const html = renderToStaticMarkup(createElement("p", null, displayNameKeptLine(`<img src=x onerror="alert(1)">`)));
  assert.equal(html, "<p>Le nom affiché reste : &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
}
const control = read("app/admin/users/[userId]/CompanySheetResetControl.tsx");
assert.match(control, /const keptName = displayNameKeptLine\(displayName\);/);
assert.match(control, /\{keptName && <p className="mb-2">\{keptName\}<\/p>\}/, "the line is shown only when there is a name, as text");
assert.doesNotMatch(control, /dangerouslySetInnerHTML/);
assert.match(read("app/admin/users/[userId]/layout.tsx"), /<CompanySheetResetControl userId=\{target\.id\} displayName=\{target\.displayName\} \/>/, "the current users.display_name is passed");
// The copy module imports nothing (client bundle).
assert.doesNotMatch(read("lib/company-sheet-reset-copy.ts"), /^import /m);
// The reset never writes display_name.
assert.doesNotMatch(read("lib/company-sheet-reset.ts"), /display_name|displayName/);

console.log("ALL COMPANY-SHEET-RESET TESTS PASSED");
