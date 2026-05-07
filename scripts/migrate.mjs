// Run drizzle migrations + sync admin user from env on every startup.
// Idempotent: skips if DATABASE_URL missing, always resets the admin password
// to ADMIN_PASSWORD (so changing env + redeploy = password reset).

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

// Sync admin user from ADMIN_EMAIL + ADMIN_PASSWORD on every deploy.
// Always re-hashes the password so changing the env var = password reset.
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
          insert into users (email, password_hash)
          values (${email}, ${hash})
          returning id
        `;
        userId = inserted[0].id;
        console.log(`[seed] created admin ${email}`);
      } else {
        userId = existing[0].id;
        await sql`
          update users set password_hash = ${hash} where id = ${userId}
        `;
        console.log(`[seed] synced password for ${email}`);
      }

      // Ensure an initial agent_config exists for this user.
      const cfg = await sql`
        select id from agent_configs where user_id = ${userId} limit 1
      `;
      if (cfg.length === 0) {
        const initialInstructions = `Tu es l'assistant vocal du centre. Réponds chaleureusement et brièvement.`;
        const initialGreeting = `Salue chaleureusement l'appelant et demande comment l'aider.`;
        await sql`
          insert into agent_configs (user_id, instructions, greeting_instructions)
          values (${userId}, ${initialInstructions}, ${initialGreeting})
        `;
        console.log("[seed] created initial agent_config");
      }
    } finally {
      await sql.end();
    }
  } catch (e) {
    console.error("[seed] failed:", e?.message ?? e);
  }
}
