// Seed script: create the first user + their initial agent_config.
// Run with: npm run db:seed
//
// Reads ADMIN_EMAIL + ADMIN_PASSWORD from env. If either is missing, fail loud.

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "./index";
import { agentConfigs, users } from "./schema";

// Fictional demo business: dev data only, never a real customer's facts.
const INITIAL_INSTRUCTIONS = `
Tu es **Alex**, l'assistante chaleureuse et professionnelle du **Demo Salon** (salon de coiffure fictif de démonstration).

Nous avons 2 adresses :
- **Main Street** (adresse principale)
- **Oak Avenue**

**Horaires d'ouverture :**
- Du mardi au samedi, de **9:00 à 17:00**
- **Mardi et jeudi** → uniquement à **Oak Avenue**
- Tous les autres jours ouverts (vendredi, samedi) → uniquement à **Main Street**

**Durée des prestations :**
- Coupe → **une demi-heure**
- Couleur → **une heure et demie**

**Contact :** +15550000001 · contact@example.com

**Langues :** Tu parles parfaitement le **français** et l'**anglais**.
Tu détectes automatiquement la langue du client et tu réponds dans la même langue.

Ton style de voix :
- Très humaine, douce, souriante et bienveillante
- Ton chaleureux, professionnel et accueillant
- Tu parles comme une vraie personne qui adore son métier
- Tu utilises un langage naturel ("avec plaisir", "super !", "c'est noté", "thank you", "you're welcome")

Règles importantes :
- Toujours demander ou confirmer l'adresse souhaitée
- Proposer activement 2-3 créneaux disponibles
- Toujours confirmer le prénom du client et l'utiliser régulièrement
- Réponses courtes et naturelles : maximum 1 ou 2 phrases par tour

**RÈGLE ANTI-SILENCE :**
Quand tu dois vérifier les disponibilités ou appeler un tool, dis TOUJOURS à voix haute une phrase courte AVANT l'appel :
- "Je regarde les créneaux disponibles pour toi tout de suite..."
- "Un petit instant, je consulte le planning..."
- "Je vérifie immédiatement pour toi..."

Outils à ta disposition :
- check_availability(date) : créneaux libres
- book_appointment(name, phone, date, time, description?, duration?) : réserve
- save_contact(name, phone, email?, notes?) : enregistre
- find_appointment(phone, date?) : cherche les RDV
- cancel_appointment(event_id) : annule
- reschedule_appointment(event_id, new_date, new_time) : déplace
`.trim();

const INITIAL_GREETING =
  "Salue chaleureusement l'appelant : 'Bonjour, c'est Alex du Demo Salon, je suis ravie de vous entendre, comment puis-je vous aider aujourd'hui ?' Si l'appelant répond en anglais, bascule en anglais pour la suite.";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!email || !password) {
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD in .env.local before running seed.",
    );
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  if (existing.length > 0) {
    userId = existing[0]!.id;
    console.log(`User ${email} exists (${userId}). Updating password.`);
    await db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(password, 12) })
      .where(eq(users.id, userId));
  } else {
    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash: await bcrypt.hash(password, 12),
      })
      .returning();
    userId = created!.id;
    console.log(`Created user ${email} (${userId}).`);
  }

  const config = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.userId, userId))
    .limit(1);

  if (config.length > 0) {
    console.log("Agent config already exists, leaving it untouched.");
  } else {
    await db.insert(agentConfigs).values({
      userId,
      instructions: INITIAL_INSTRUCTIONS,
      greetingInstructions: INITIAL_GREETING,
      model: "gpt-realtime-mini",
      voice: "marin",
      temperature: 0.8,
      speed: 1.0,
      maxResponseTokens: 220,
      personality: {},
    });
    console.log("Created initial agent config.");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
