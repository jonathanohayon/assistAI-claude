// Run drizzle migrations + optionally seed the admin user on startup.
// Skips silently if DATABASE_URL is missing — the app will surface a clear
// error at first DB call.

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

// Auto-seed if ADMIN_EMAIL + ADMIN_PASSWORD are set and the user doesn't
// exist yet. Idempotent — safe to run on every deploy.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  try {
    const { default: bcrypt } = await import("bcryptjs");
    const seedClient = postgres(url, { max: 1, prepare: false });
    try {
      const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
      const existing = await seedClient`
        select id from users where email = ${email} limit 1
      `;
      if (existing.length === 0) {
        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
        const inserted = await seedClient`
          insert into users (email, password_hash)
          values (${email}, ${hash})
          returning id
        `;
        const userId = inserted[0].id;
        const initialInstructions = `Tu es l'assistant vocal du centre. Réponds chaleureusement et brièvement.`;
        const initialGreeting = `Salue chaleureusement l'appelant et demande comment l'aider.`;
        await seedClient`
          insert into agent_configs (user_id, instructions, greeting_instructions)
          values (${userId}, ${initialInstructions}, ${initialGreeting})
        `;
        console.log(`[seed] created admin user ${email}`);
      } else {
        console.log("[seed] admin user already exists, skipping");
      }
    } finally {
      await seedClient.end();
    }
  } catch (e) {
    console.error("[seed] failed:", e?.message ?? e);
  }
}
