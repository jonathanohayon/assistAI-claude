// Tests purs du builder d'opener (texte d'accueil pré-généré).
// Run : npx tsx scripts/tests/opener.test.ts
import assert from "node:assert/strict";

import {
  buildOpenerText,
  openerHash,
  DEFAULT_OPENING_QUESTION,
} from "../../lib/opener";

let passed = 0;
const failures: string[] = [];
const group = (label: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`[${label}] ${e instanceof Error ? e.message : e}`);
  }
};

// 1. greeting finissant par "?" → verbatim, pas d'append
group("ends with ? → verbatim", () => {
  assert.strictEqual(
    buildOpenerText("Bonjour, c'est Johana, comment puis-je vous aider ?", "fr"),
    "Bonjour, c'est Johana, comment puis-je vous aider ?",
  );
});
// 2. greeting sans question → append localisé FR
group("no question fr → append", () => {
  assert.strictEqual(
    buildOpenerText("Bonjour, c'est Johana.", "fr"),
    "Bonjour, c'est Johana. " + DEFAULT_OPENING_QUESTION.fr,
  );
});
// 3. HE + EN
group("he/en append", () => {
  assert.ok(
    buildOpenerText("שלום, כאן יוהנה.", "he").endsWith(DEFAULT_OPENING_QUESTION.he),
  );
  assert.ok(
    buildOpenerText("Hello, this is Johana.", "en").endsWith(
      DEFAULT_OPENING_QUESTION.en,
    ),
  );
});
// 4. locale inconnue → fallback fr
group("unknown locale → fr", () => {
  assert.ok(buildOpenerText("Hola.", "de").endsWith(DEFAULT_OPENING_QUESTION.fr));
});
// 5. trailing guillemets/espaces ignorés pour la détection du "?"
group("trailing quote tolerated", () => {
  assert.strictEqual(buildOpenerText('Bonjour ? "', "fr"), 'Bonjour ? "');
});
// 6. hash stable + sensible au texte
group("hash", () => {
  assert.strictEqual(openerHash("a"), openerHash("a"));
  assert.notStrictEqual(openerHash("a"), openerHash("b"));
  assert.match(openerHash("a"), /^[a-f0-9]{16,64}$/);
});
// 7. vide → vide (pas d'opener à pré-render)
group("empty stays empty", () => {
  assert.strictEqual(buildOpenerText("   ", "fr"), "");
});

if (failures.length) {
  console.error(`${failures.length} FAILED:`);
  failures.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log(`ALL ${passed} TESTS PASSED`);
