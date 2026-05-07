import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Users own one or more agent_configs. Phase 1 = single user, single config.
// Schema is multi-tenant ready so phase 2 only adds rows, no migration.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const agentConfigs = pgTable("agent_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // Persona + voice config — exposed in dashboard.
  instructions: text("instructions").notNull(),
  greetingInstructions: text("greeting_instructions").notNull(),
  model: text("model").notNull().default("gpt-realtime-mini"),
  voice: text("voice").notNull().default("marin"),
  temperature: real("temperature").notNull().default(0.8),
  speed: real("speed").notNull().default(1.0),
  maxResponseTokens: integer("max_response_tokens").notNull().default(220),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;
