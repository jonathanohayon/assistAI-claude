import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
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
  // 'admin' = global ops (manage tenants, assign numbers); 'user' = standard tenant.
  role: text("role").notNull().default("user"),
  // Optional human label shown in /admin (e.g. salon name).
  displayName: text("display_name").notNull().default(""),

  // Subscription state — drives trial gating & dashboard banners.
  // 'trialing' (default for new signups, 7 days), 'active' (paid),
  // 'expired' (trial ended without subscribing), 'cancelled' (was active).
  subscriptionStatus: text("subscription_status").notNull().default("trialing"),
  // Chosen plan key — see lib/plans.ts. Captured at signup (?plan=…) and
  // updatable from /dashboard/billing.
  subscriptionPlan: text("subscription_plan").notNull().default("essential"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

  // Per-tenant Google integration. When refresh_token is null the agent
  // tools fall back to the global Google credentials in env. Calendar +
  // Sheets share the same OAuth scopes so one refresh_token covers both.
  googleRefreshToken: text("google_refresh_token"),
  googleCalendarId: text("google_calendar_id").notNull().default("primary"),
  googleSheetId: text("google_sheet_id").notNull().default(""),

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

  // WhatsApp number of the salon owner — receives a recap after every call.
  // Stored E.164 (e.g. +972585001007); empty = WhatsApp recap disabled.
  ownerWhatsapp: text("owner_whatsapp").notNull().default(""),

  // Default greeting language. The agent will use this for the very first
  // message of each call, then auto-detect and adapt to the caller. Values:
  // 'fr' | 'he' | 'en'.
  primaryLanguage: text("primary_language").notNull().default("fr"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Log of every call handled by the agent. Stores raw transcript + AI summary
// + WhatsApp delivery sids so we can audit / re-send if needed.
export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  fromNumber: text("from_number").notNull().default(""),
  transcript: jsonb("transcript")
    .$type<Array<{ role: "user" | "assistant"; text: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  summary: text("summary").notNull().default(""),

  whatsappClientSid: text("whatsapp_client_sid"),
  whatsappOwnerSid: text("whatsapp_owner_sid"),
  whatsappError: text("whatsapp_error"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// One row per tenant-owned phone number. The agent looks up the called
// number on each inbound call to know which tenant's persona to load.
export const phoneNumbers = pgTable("phone_numbers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // E.164 — globally unique. Index ensures fast lookup on every call.
  phoneNumber: text("phone_number").notNull().unique(),
  // Optional friendly label ("Cabinet principal", "Salon Tel Aviv", etc.).
  label: text("label").notNull().default(""),
  // Twilio resource SID so we can release the number when the tenant cancels.
  // Empty for legacy numbers attached manually before auto-provisioning.
  twilioSid: text("twilio_sid").notNull().default(""),
  // ISO country code for billing/UI ("US", "IL", ...).
  countryCode: text("country_code").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Append-only event log. Surfaced live in /dashboard/logs so the operator
// can see end-to-end call/tool/whatsapp activity without grepping Railway logs.
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  // 'info' | 'warn' | 'error' — drives the badge colour in the dashboard.
  level: text("level").notNull().default("info"),
  // 'agent' | 'web' | 'calendar' | 'sheets' | 'whatsapp' | 'auth' | 'tenant'
  source: text("source").notNull(),
  // Stable machine-readable event name, e.g. 'call_received', 'tool_invoked'.
  event: text("event").notNull(),
  // Human-readable one-line summary.
  message: text("message").notNull(),
  // Free-form structured payload (call ids, durations, errors, etc.)
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Singleton key-value store for app-wide settings (system prompt that
// every tenant inherits, default Twilio config, etc.). Read-mostly so a
// single row per key is fine.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type NewPhoneNumber = typeof phoneNumbers.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
