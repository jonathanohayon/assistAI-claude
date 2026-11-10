// The Knowledge contract (v1). Two structures:
//   - `companySheet` belongs to the ACCOUNT: the company's facts (identity,
//     locations with hours, services and prices, location rules, free notes,
//     FAQ, sources), shared by every agent of the account;
//   - `agentKnowledge` belongs to each agent: its own instructions.
// Pure, tenant-safe (no supplier word). Per-plan admin directives and
// inheritAdminGlobals are NOT here: they stay an admin setting. The in-call
// tools that read the sheet (locations, hours, services) belong to the Tools
// brick.
//
// Every default equals TODAY's behaviour: the text sent to the agent is
// unchanged (scripts/tests/knowledge-contract.test.ts).

import { z } from "zod";

export const KNOWLEDGE_CONTRACT_VERSION = 1 as const;

export const WEEK_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const dayHours = z.object({ open: z.boolean(), openTime: z.string().max(5), closeTime: z.string().max(5) }).strict();

const location = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    address: z.string().max(240),
    hours: z.object(Object.fromEntries(WEEK_DAYS.map((d) => [d, dayHours])) as Record<(typeof WEEK_DAYS)[number], typeof dayHours>).strict(),
  })
  .strict();

const service = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    durationMinutes: z.number().int().min(0),
    priceILS: z.number().min(0),
    /** "all" or the ids of the locations offering it. */
    locationIds: z.union([z.literal("all"), z.array(z.string())]),
    description: z.string().max(1000),
  })
  .strict();

export const companySheetSchema = z
  .object({
    version: z.literal(KNOWLEDGE_CONTRACT_VERSION),
    identity: z.object({ name: z.string().max(120), tagline: z.string().max(200), email: z.string().max(160) }).strict(),
    locations: z.array(location).max(12),
    services: z.array(service).max(60),
    /** Rules per location / day ("Natanya on Wednesdays only"). */
    locationRules: z.string().max(4000),
    /** Free notes: everything that doesn't fit the sheet (expertise, selling points…). */
    notes: z.string().max(12000),
    faq: z.array(z.object({ q: z.string().min(1).max(300), a: z.string().min(1).max(2000) }).strict()).max(50),
    /** Websites learned, with the date. */
    sources: z.array(z.object({ url: z.string().max(500), learnedAt: z.string().nullable() }).strict()).max(20),
  })
  .strict();

export type CompanySheet = z.infer<typeof companySheetSchema>;
export type SheetLocation = CompanySheet["locations"][number];
export type SheetService = CompanySheet["services"][number];

export const agentKnowledgeSchema = z
  .object({
    version: z.literal(KNOWLEDGE_CONTRACT_VERSION),
    /** What this agent must do or avoid. */
    instructions: z.string(),
  })
  .strict();

export type AgentKnowledge = z.infer<typeof agentKnowledgeSchema>;

export const EMPTY_COMPANY_SHEET: CompanySheet = {
  version: KNOWLEDGE_CONTRACT_VERSION,
  identity: { name: "", tagline: "", email: "" },
  locations: [],
  services: [],
  locationRules: "",
  notes: "",
  faq: [],
  sources: [],
};

// ── Levels ──────────────────────────────────────────────────────────────
// 1 = Essential · 2 = "More settings" · 3 = developer mode (full-prompt preview).
export const KNOWLEDGE_FIELD_LEVEL = {
  "sheet.identity": 1,
  "sheet.locations": 1,
  "sheet.services": 1,
  "agent.instructions": 1,
  "sheet.notes": 2,
  "sheet.faq": 2,
  "sheet.sources": 2,
  "sheet.locationRules": 2,
} as const;

export type KnowledgeParse<T> = { ok: true; value: T } | { ok: false; error: string };

function parse<T>(schema: z.ZodType<T>, raw: unknown, prefix: string): KnowledgeParse<T> {
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${prefix}.${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}` };
}

export const parseCompanySheet = (raw: unknown) => parse(companySheetSchema, raw, "companySheet");
export const parseAgentKnowledge = (raw: unknown) => parse(agentKnowledgeSchema, raw, "knowledge");
