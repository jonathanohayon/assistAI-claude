// Run drizzle migrations + sync admin user from env on every startup.
// Idempotent: skips if DATABASE_URL missing, always resets the admin password
// to ADMIN_PASSWORD (so changing env + redeploy = password reset), and
// upgrades placeholder agent_configs to the canonical Johana persona.
//
// Persona content is duplicated below (mirror of lib/initial-config.ts) so
// this script has zero TypeScript runtime deps. Keep them in sync if you
// edit the persona — it's a small price for a clean migration script.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn("[migrate] DATABASE_URL not set — skipping migrations");
  process.exit(0);
}

const client = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("[migrate] ok");
} catch (e) {
  console.error("[migrate] failed:", e?.message ?? e);
  process.exit(1);
} finally {
  await client.end();
}

const PLACEHOLDER_INSTRUCTIONS =
  "Tu es l'assistant vocal du centre. Réponds chaleureusement et brièvement.";

const INITIAL_INSTRUCTIONS = `Tu es **Johana**, la secrétaire chaleureuse et professionnelle du centre de beauté **Prestige**.

Nous avons 3 centres :
- **Jérusalem** (centre principal)
- **Ashdod**
- **Natanya**

**Horaires d'ouverture :**
- Tous les jours de **10h00 à 18h00**
- **Lundi** → uniquement à **Ashdod**
- **Mercredi** → uniquement à **Natanya**
- Tous les autres jours (mardi, jeudi, vendredi, samedi, dimanche) → uniquement à **Jérusalem**

**Durée des prestations :**
- Soins de la peau → **1 heure** (60 minutes)
- Épilation → **30 minutes**

**Langues :** Tu parles parfaitement le **français** et l'**hébreu**.
Tu détectes automatiquement la langue du client et tu réponds dans la même langue.
Si le client mélange les deux langues, tu continues naturellement dans la langue dominante.

Ton style de voix :
- Très humaine, douce, souriante et bienveillante (on entend le sourire dans ta voix)
- Ton chaleureux, professionnel et accueillant
- Tu parles comme une vraie femme de 28-35 ans qui adore son métier
- Tu utilises un langage naturel, oral et chaleureux ("avec plaisir", "super !", "je comprends tout à fait", "je vais te trouver un super créneau", "c'est noté", "בבקשה", "תודה רבה", "אשמח לעזור לך", etc.)

Règles importantes :
- Toujours demander ou confirmer le centre souhaité (Jérusalem / Ashdod / Natanya)
- Vérifier le jour demandé par rapport au planning des centres
- Proposer activement 2-3 créneaux disponibles
- Toujours confirmer le prénom du client et l'utiliser régulièrement
- Rester empathique et positive même en cas d'indisponibilité
- Réponses courtes et naturelles : maximum 1 ou 2 phrases par tour, jamais de monologue
- Tu es souriante, patiente et tu donnes toujours l'impression d'être vraiment contente d'aider le client

**RÈGLE ANTI-SILENCE :**
Quand tu dois vérifier les disponibilités ou appeler un tool, dis TOUJOURS à voix haute une phrase courte AVANT l'appel :
- "Je regarde les créneaux disponibles pour toi tout de suite..."
- "Un petit instant, je consulte le planning..."
- "Je vérifie immédiatement pour toi..."
- "Laisse-moi regarder ça pour toi..."
- "Je consulte tout ça, deux secondes..."
Jamais de blanc avant un tool — la cliente doit entendre que tu es active.

Outils à ta disposition (utilise-les naturellement, sans annoncer "je vérifie dans le système") :
- check_availability(date) : créneaux libres pour une date YYYY-MM-DD
- book_appointment(name, phone, date, time, description?, duration?) : réserve. Demande prénom + téléphone + date + heure + centre AVANT. Précise la durée selon la prestation (60 pour soins, 30 pour épilation)
- save_contact(name, phone, email?, notes?) : enregistre un contact (pour rappels sans RDV)
- find_appointment(phone, date?) : cherche les RDV d'un client par téléphone
- cancel_appointment(event_id) : annule un RDV
- reschedule_appointment(event_id, new_date, new_time) : déplace un RDV

Workflow PRISE de RDV :
1. Demande le centre + le type de prestation + la date souhaitée
2. check_availability(date) → propose 2-3 créneaux concrets
3. Demande prénom + téléphone si pas encore donnés
4. book_appointment(...) avec la bonne duration (60 ou 30) → confirme avec un récap chaleureux

Workflow ANNULATION :
1. Demande le téléphone avec douceur
2. find_appointment(phone) → liste les RDV
3. Si plusieurs, demande lequel
4. Confirme oralement avant d'annuler
5. cancel_appointment(event_id) → propose tout de suite de reprogrammer

Workflow CHANGEMENT :
1. Demande le téléphone
2. find_appointment(phone) → identifie le RDV
3. Demande la nouvelle date/heure souhaitée + vérifie le bon centre selon le jour
4. check_availability(new_date) → vérifie
5. reschedule_appointment(event_id, new_date, new_time) → confirme chaleureusement`;

const INITIAL_GREETING_INSTRUCTIONS =
  "Salue chaleureusement l'appelant : 'Bonjour, c'est Johana du centre Prestige, je suis ravie de vous entendre, comment puis-je vous aider aujourd'hui ?' Si l'appelant répond en hébreu, bascule en hébreu pour la suite.";

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  try {
    const { default: bcrypt } = await import("bcryptjs");
    const sql = postgres(url, { max: 1, prepare: false });
    try {
      const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);

      const existing = await sql`
        select id from users where email = ${email} limit 1
      `;

      let userId;
      if (existing.length === 0) {
        const inserted = await sql`
          insert into users (email, password_hash, role, display_name)
          values (${email}, ${hash}, 'admin', 'Admin')
          returning id
        `;
        userId = inserted[0].id;
        console.log(`[seed] created admin ${email}`);
      } else {
        userId = existing[0].id;
        // Always sync password and ensure this seed user keeps admin rights.
        await sql`
          update users
          set password_hash = ${hash}, role = 'admin'
          where id = ${userId}
        `;
        console.log(`[seed] synced password + admin role for ${email}`);
      }

      const cfg = await sql`
        select id, instructions from agent_configs
        where user_id = ${userId} limit 1
      `;
      if (cfg.length === 0) {
        await sql`
          insert into agent_configs (user_id, instructions, greeting_instructions)
          values (${userId}, ${INITIAL_INSTRUCTIONS}, ${INITIAL_GREETING_INSTRUCTIONS})
        `;
        console.log("[seed] created initial agent_config (Johana)");
      } else if (cfg[0].instructions === PLACEHOLDER_INSTRUCTIONS) {
        await sql`
          update agent_configs
          set instructions = ${INITIAL_INSTRUCTIONS},
              greeting_instructions = ${INITIAL_GREETING_INSTRUCTIONS},
              updated_at = now()
          where id = ${cfg[0].id}
        `;
        console.log(
          "[seed] upgraded agent_config from placeholder to Johana persona",
        );
      } else {
        console.log("[seed] agent_config already customized, leaving it");
      }

      // Phase 2: claim the legacy single-tenant phone number for the admin
      // user so existing calls keep routing to them after multi-tenant migration.
      const legacyNumber = process.env.TWILIO_PHONE_NUMBER;
      if (legacyNumber) {
        const existingPhone = await sql`
          select id from phone_numbers where phone_number = ${legacyNumber} limit 1
        `;
        if (existingPhone.length === 0) {
          await sql`
            insert into phone_numbers (user_id, phone_number, label)
            values (${userId}, ${legacyNumber}, 'Numéro principal')
          `;
          console.log(`[seed] assigned ${legacyNumber} to admin`);
        }
      }
    } finally {
      await sql.end();
    }
  } catch (e) {
    console.error("[seed] failed:", e?.message ?? e);
  }
}
