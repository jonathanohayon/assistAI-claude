const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL);

// Clause à insérer en tête de chaque RÈGLE ANTI-SILENCE par plan. Garde
// le comportement filler-avant-tool pour les personae avec tools, mais
// interdit explicite quand le LLM n'a rien à appeler.
const NEGATIVE_CLAUSE = `
⚠️ **RÈGLE ZÉRO-FILLER (prioritaire sur l'anti-silence ci-dessous) :**
Si tu n'as PAS d'outil à appeler pour cette demande précise, NE dis JAMAIS de
filler type "je vérifie", "un moment", "laisse-moi regarder", "אני בודק",
"רגע אחד", "let me check", "one moment". Réponds DIRECTEMENT.
Le filler n'a de sens QUE si tu enchaînes immédiatement avec un vrai tool call
qui prend du temps (check_availability, book_appointment, etc.). Sinon il
crée juste un silence gênant après la fausse promesse de "vérification".

`;

(async () => {
  try {
    const [row] = await sql`SELECT value::text AS value FROM app_settings WHERE key = 'global_instructions_by_plan'`;
    if (!row) {
      console.error("global_instructions_by_plan introuvable");
      return;
    }
    const parsed = JSON.parse(row.value);
    const plans = Object.keys(parsed);
    let modified = 0;
    for (const plan of plans) {
      const txt = typeof parsed[plan] === "string" ? parsed[plan] : "";
      // Skip si déjà présent (idempotent)
      if (txt.includes("RÈGLE ZÉRO-FILLER")) {
        console.log(`[${plan}] déjà présent, skip`);
        continue;
      }
      // Insère AVANT le bloc RÈGLE ANTI-SILENCE existant. Si pas trouvé,
      // prepend au début.
      const anchor = "**RÈGLE ANTI-SILENCE :**";
      if (txt.includes(anchor)) {
        parsed[plan] = txt.replace(anchor, NEGATIVE_CLAUSE.trim() + "\n\n" + anchor);
      } else {
        parsed[plan] = NEGATIVE_CLAUSE.trim() + "\n\n" + txt;
      }
      modified++;
      console.log(`[${plan}] modifié (${parsed[plan].length} chars)`);
    }
    if (modified === 0) {
      console.log("Aucun plan modifié");
      return;
    }
    await sql`UPDATE app_settings SET value = ${JSON.stringify(parsed)}::jsonb WHERE key = 'global_instructions_by_plan'`;
    console.log(`✓ ${modified} plan(s) mis à jour`);
  } catch (e) {
    console.error(e.message);
  } finally {
    await sql.end();
  }
})();
