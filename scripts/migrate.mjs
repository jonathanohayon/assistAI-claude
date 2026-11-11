// Run drizzle migrations + sync the admin user from env on every startup
// (prod included). Idempotent: a second run writes nothing.
//
// Writes besides migrations (and ONLY these):
//   1. users: insert the admin (ADMIN_EMAIL) if missing.
//   2. users: on an existing admin, set password_hash only when it doesn't
//      match ADMIN_PASSWORD (changing env + redeploy = password reset), and
//      role = 'admin' only when it isn't already.
//   3. agent_configs: insert the admin's config ONLY when no row exists,
//      with the neutral persona (scripts/neutral-persona-fr.mjs). An
//      existing agent_configs row is NEVER updated.
//   4. phone_numbers: insert TWILIO_PHONE_NUMBER for the admin if that
//      number has no row yet.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { NEUTRAL_FR_GREETING, NEUTRAL_FR_INSTRUCTIONS } from "./neutral-persona-fr.mjs";

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

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  try {
    const { default: bcrypt } = await import("bcryptjs");
    const sql = postgres(url, { max: 1, prepare: false });
    try {
      const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
      const existing = await sql`
        select id, password_hash, role from users where email = ${email} limit 1
      `;

      let userId;
      if (existing.length === 0) {
        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
        const inserted = await sql`
          insert into users (email, password_hash, role, display_name)
          values (${email}, ${hash}, 'admin', 'Admin')
          returning id
        `;
        userId = inserted[0].id;
        console.log(`[seed] created admin ${email}`);
      } else {
        userId = existing[0].id;
        // Keep the password in sync with ADMIN_PASSWORD and the admin role,
        // writing only what differs (a fresh bcrypt salt would otherwise
        // rewrite the row on every startup).
        const samePassword = await bcrypt
          .compare(process.env.ADMIN_PASSWORD, existing[0].password_hash ?? "")
          .catch(() => false);
        if (!samePassword) {
          const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
          await sql`update users set password_hash = ${hash} where id = ${userId}`;
          console.log(`[seed] synced password for ${email}`);
        }
        if (existing[0].role !== "admin") {
          await sql`update users set role = 'admin' where id = ${userId}`;
          console.log(`[seed] restored admin role for ${email}`);
        }
      }

      // Create the admin's config only when it has none. An existing row is
      // never written, whatever its content.
      const cfg = await sql`
        select id from agent_configs
        where user_id = ${userId} limit 1
      `;
      if (cfg.length === 0) {
        await sql`
          insert into agent_configs (user_id, instructions, greeting_instructions)
          values (${userId}, ${NEUTRAL_FR_INSTRUCTIONS}, ${NEUTRAL_FR_GREETING})
        `;
        console.log("[seed] created the admin agent_config (neutral persona)");
      } else {
        console.log("[seed] admin agent_config exists, leaving it untouched");
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
