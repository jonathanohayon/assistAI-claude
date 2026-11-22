// The ONE source of sample data for product previews (F2): a product the
// account does not own opens its real screen read-only, filled from here.
// Modelled on lib/demo-place.ts: one fictional place (the demo's downtown
// salon), numbers +97250000000x, e-mails and addresses *@example.test /
// *.example.test, first names only. No real business, person, street or
// town. Texts per language (fr/en/he); everything else is shared.
//
// PURE and client-safe: no DB, no env, no I/O. The previews read it through
// lib/preview-fetch.ts (the campaigns screen) or as props (reception, Votre
// agent). scripts/tests/product-previews.test.ts checks it is fictional
// (first-customer names, tenant words, number and e-mail shapes).

import type { DashboardStats } from "@/app/[locale]/dashboard/config/types";
import type { TestWords, ToolsResponse } from "@/components/bricks/tools/tools-ui";
import type { CampaignListItem, CampaignStats } from "@/lib/campaigns/types";
import { DEMO_PLACE, DEMO_SLOTS, demoLang, type DemoLang } from "@/lib/demo-place";
import type { OutboundAgentListItem } from "@/lib/outbound-agents/types";
import type { CapabilityState, EffectiveCapabilities } from "@/lib/tools/contract";
import { VOICE_ORDER } from "@/lib/voice/public";

export type PreviewLang = DemoLang;
export const previewLang = demoLang;

/** The sample account's own number (the hero, the caller id). */
export const PREVIEW_NUMBER = "+972500000001";
/** Sample contacts' numbers: +972500000002 … +972500000006. */
export const PREVIEW_CONTACT_NUMBERS = ["+972500000002", "+972500000003", "+972500000004", "+972500000005", "+972500000006"] as const;
/** The sample "your own agent" address (never called: previews make no request). */
export const PREVIEW_AGENT_URL = "https://agent.example.test/ask";
export const PREVIEW_EMAIL = "contact@example.test";
/** The sample voice: the first of the catalogue (shown as "Voice 1 · …"). */
export const PREVIEW_VOICE = VOICE_ORDER[0];

const L = <T>(v: Record<PreviewLang, T>) => v;
const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 9, day, hour, 0, 0)).toISOString();

// ── Réception ──────────────────────────────────────────────────────────────

/** The overview's figures: a live agent with a month of calls (measured stats). */
export const PREVIEW_RECEPTION_STATS: DashboardStats = {
  callsToday: 14,
  conversion: 38,
  avgSeconds: 154,
  rdv: 27,
  rdvSince: "2026-10-01",
  minutesThisMonth: 312,
  agentState: { state: "live", reason: null },
};

export const PREVIEW_PLAN_LABEL = L({ fr: "Exemple", en: "Sample", he: "דוגמה" });

/** The live test's sample conversation (a static mock: never a session). */
export function previewLiveTranscript(lang: unknown): Array<{ role: "user" | "assistant"; text: string }> {
  const l = previewLang(lang);
  const [a, b] = DEMO_SLOTS;
  const lines = {
    fr: [
      ["assistant", `Bonjour, ${DEMO_PLACE.fr}, je vous écoute.`],
      ["user", "Bonjour, je voudrais une coupe demain matin."],
      ["assistant", `Bien sûr. Demain, j'ai ${a} ou ${b}. Lequel vous convient ?`],
      ["user", `${b}, parfait.`],
      ["assistant", `C'est noté pour demain à ${b}. Vous recevrez une confirmation par message.`],
    ],
    en: [
      ["assistant", `Hello, ${DEMO_PLACE.en}, how can I help?`],
      ["user", "Hi, I'd like a haircut tomorrow morning."],
      ["assistant", `Of course. Tomorrow I have ${a} or ${b}. Which suits you?`],
      ["user", `${b}, great.`],
      ["assistant", `Booked for tomorrow at ${b}. You'll get a confirmation by message.`],
    ],
    he: [
      ["assistant", `שלום, ${DEMO_PLACE.he}, במה אפשר לעזור?`],
      ["user", "שלום, אני רוצה תספורת מחר בבוקר."],
      ["assistant", `בשמחה. מחר יש ${a} או ${b}. מה מתאים לך?`],
      ["user", `${b}, מעולה.`],
      ["assistant", `נקבע למחר ב-${b}. תקבלו אישור בהודעה.`],
    ],
  } as const;
  return lines[l].map(([role, text]) => ({ role, text }));
}

// ── Ventes (the campaigns screen) ─────────────────────────────────────────

const AGENT_ID = "preview-agent-1";
const CAMPAIGN_IDS = ["preview-campaign-1", "preview-campaign-2", "preview-campaign-3"] as const;

const CONTACT_NAMES = L({
  fr: ["Camille", "Noa", "Léo", "Inès", "Adam"],
  en: ["Sam", "Noa", "Alex", "Robin", "Adam"],
  he: ["נועה", "אורי", "מאיה", "איתי", "שירה"],
});

const CAMPAIGN_TEXT = L({
  fr: [
    { name: "Relance des devis de novembre", objective: "Rappeler les clients qui ont demandé un devis et proposer un rendez-vous." },
    { name: "Clients sans visite depuis 6 mois", objective: "Prendre des nouvelles et proposer l'offre du mois." },
    { name: "Nouveaux contacts du salon", objective: "Présenter le salon et réserver une première visite." },
  ],
  en: [
    { name: "November quote follow-up", objective: "Call back customers who asked for a quote and offer an appointment." },
    { name: "No visit in 6 months", objective: "Check in and offer this month's deal." },
    { name: "New salon contacts", objective: "Introduce the salon and book a first visit." },
  ],
  he: [
    { name: "מעקב הצעות מחיר נובמבר", objective: "לחזור ללקוחות שביקשו הצעת מחיר ולהציע תור." },
    { name: "לקוחות שלא ביקרו חצי שנה", objective: "לשאול מה שלומם ולהציע את מבצע החודש." },
    { name: "אנשי קשר חדשים לסלון", objective: "להציג את הסלון ולקבוע ביקור ראשון." },
  ],
});

const STATS: readonly CampaignStats[] = [
  { total: 120, queued: 46, inFlight: 2, done: 72, connected: 51, conversion: 34 },
  { total: 80, queued: 0, inFlight: 0, done: 80, connected: 58, conversion: 22 },
  { total: 40, queued: 40, inFlight: 0, done: 0, connected: 0, conversion: 0 },
];
const STATUSES = ["running", "completed", "paused"] as const;
const PRESETS = ["follow_up", "marketing", "book_for_seller"] as const;

export function previewCampaigns(lang: unknown): CampaignListItem[] {
  const l = previewLang(lang);
  return CAMPAIGN_IDS.map((id, i) => ({
    id,
    userId: "preview",
    name: CAMPAIGN_TEXT[l][i].name,
    goalPreset: PRESETS[i],
    objective: CAMPAIGN_TEXT[l][i].objective,
    status: STATUSES[i],
    fromNumber: PREVIEW_NUMBER,
    agentId: AGENT_ID,
    successCriteria: "",
    extractionSchema: [],
    concurrency: 3,
    retryRules: { maxAttempts: 2, retryOn: ["no_answer", "busy"], backoffMinutes: 60 },
    callWindow: { timezone: "Asia/Jerusalem", days: [0, 1, 2, 3, 4], startHour: 9, endHour: 18, respectDnc: true },
    createdAt: at(1 + i * 5),
    updatedAt: at(2 + i * 5),
    startedAt: STATUSES[i] === "paused" ? null : at(3 + i * 5),
    completedAt: STATUSES[i] === "completed" ? at(9) : null,
    stats: STATS[i],
  }));
}

export function previewOutboundAgents(lang: unknown): OutboundAgentListItem[] {
  const l = previewLang(lang);
  return [
    {
      id: AGENT_ID,
      userId: "preview",
      name: L({ fr: "Agent de relance", en: "Follow-up agent", he: "סוכן מעקב" })[l],
      agentName: L({ fr: "Maya", en: "Maya", he: "מאיה" })[l],
      voice: PREVIEW_VOICE,
      language: l,
      instructions: "",
      greeting: "",
      knowledge: "",
      knowledgeSources: [],
      notifications: { email: PREVIEW_EMAIL },
      channels: { phone: true },
      personality: {},
      noiseReductionLevel: 0,
      createdAt: at(1),
      updatedAt: at(1),
      campaignCount: 3,
    },
  ];
}

const CONTACT_STATUSES = [
  ["completed", "completed", "no_answer", "calling", "queued"],
  ["completed", "completed", "completed", "voicemail", "completed"],
  ["queued", "queued", "queued", "queued", "queued"],
] as const;

export function previewCampaignContacts(lang: unknown, campaignId: string) {
  const l = previewLang(lang);
  const i = Math.max(0, CAMPAIGN_IDS.indexOf(campaignId as (typeof CAMPAIGN_IDS)[number]));
  return PREVIEW_CONTACT_NUMBERS.map((phoneNumber, k) => ({
    id: `${campaignId}-contact-${k + 1}`,
    phoneNumber,
    contactName: CONTACT_NAMES[l][k],
    status: CONTACT_STATUSES[i][k],
  }));
}

const CALLS = L({
  fr: [
    { summary: "Intéressée, rendez-vous pris jeudi à 11:30.", user: "Oui, je voulais justement rappeler.", agent: "Je vous propose jeudi à 11:30, cela vous va ?" },
    { summary: "Souhaite être rappelé la semaine prochaine.", user: "Pas cette semaine, rappelez-moi lundi.", agent: "C'est noté, je vous rappelle lundi." },
    { summary: "Pas intéressé pour le moment.", user: "Non merci, pas pour l'instant.", agent: "Entendu, merci pour votre temps." },
  ],
  en: [
    { summary: "Interested, booked Thursday at 11:30.", user: "Yes, I was going to call back.", agent: "How about Thursday at 11:30?" },
    { summary: "Wants a call back next week.", user: "Not this week, call me Monday.", agent: "Noted, I'll call you Monday." },
    { summary: "Not interested for now.", user: "No thanks, not right now.", agent: "Understood, thanks for your time." },
  ],
  he: [
    { summary: "מעוניינת, נקבע תור ליום חמישי ב-11:30.", user: "כן, בדיוק רציתי לחזור אליכם.", agent: "מה דעתך על יום חמישי ב-11:30?" },
    { summary: "מבקש שיחזרו אליו בשבוע הבא.", user: "לא השבוע, תחזרו אליי ביום שני.", agent: "רשמתי, אחזור אליך ביום שני." },
    { summary: "לא מעוניין כרגע.", user: "לא תודה, לא עכשיו.", agent: "הבנתי, תודה על הזמן." },
  ],
});
const CALL_SHAPES = [
  { outcome: "connected", success: "success", sentiment: "positive", durationSeconds: 142 },
  { outcome: "connected", success: "partial", sentiment: "neutral", durationSeconds: 96 },
  { outcome: "connected", success: "fail", sentiment: "negative", durationSeconds: 48 },
] as const;

/** GET /api/dashboard/campaigns/{id}/results, as the analytics screen reads it. */
export function previewCampaignResults(lang: unknown, campaignId: string) {
  const l = previewLang(lang);
  const c = previewCampaigns(l).find((x) => x.id === campaignId) ?? previewCampaigns(l)[0];
  const started = c.stats.done > 0;
  const calls = started
    ? CALL_SHAPES.map((s, k) => ({
        id: `${c.id}-call-${k + 1}`,
        phoneNumber: PREVIEW_CONTACT_NUMBERS[k],
        ...s,
        summary: CALLS[l][k].summary,
        transcript: [
          { role: "assistant" as const, text: CALLS[l][k].agent },
          { role: "user" as const, text: CALLS[l][k].user },
        ],
        createdAt: at(4 + k, 11),
      }))
    : [];
  const done = c.stats.done;
  const connected = c.stats.connected;
  return {
    campaign: { id: c.id, name: c.name, objective: c.objective, successCriteria: "" },
    aggregates: {
      total: done,
      connected,
      success: Math.round((connected * c.stats.conversion) / 100),
      partial: started ? Math.round(connected * 0.2) : 0,
      successRate: c.stats.conversion,
      avgDurationSec: started ? 118 : 0,
      totalMinutes: started ? Math.round((done * 118) / 60) : 0,
      byOutcome: started ? { connected, no_answer: Math.round((done - connected) * 0.6), voicemail: done - connected - Math.round((done - connected) * 0.6) } : {},
      bySentiment: started ? { positive: Math.round(connected * 0.5), neutral: Math.round(connected * 0.35), negative: connected - Math.round(connected * 0.5) - Math.round(connected * 0.35) } : {},
      perDay: started ? [3, 4, 5, 6, 7].map((d, k) => ({ date: `2026-10-0${d}`, count: [12, 18, 15, 14, 13][k] })) : [],
      analyzedNow: 0,
      pendingAnalysis: 0,
    },
    calls,
  };
}

// ── Votre agent (the client-agent brick) ──────────────────────────────────

const ON: CapabilityState = { requested: true, planIncluded: true, prerequisite: { met: true, missing: null }, active: true };

/** GET /api/dashboard/tools as the client-agent brick reads it: switched on, a sample address. */
export const PREVIEW_CLIENT_AGENT: ToolsResponse = {
  tools: {
    version: 1,
    booking: { enabled: true, defaultDurationMinutes: null, minNoticeMinutes: null },
    contacts: { enabled: true },
    transfer: { enabled: false, when: "always" },
    orders: { enabled: false, ask: "" },
    clientAgent: { enabled: true, url: PREVIEW_AGENT_URL, mode: "lead", secretSet: true },
  },
  capabilities: { booking: ON, contacts: ON, transfer: ON, orders: ON, clientAgent: ON } satisfies EffectiveCapabilities,
  account: { googleConnected: true, transferNumberSet: false, transferNumber: null },
  upgrade: {},
  clientAgentTool: { visible: true },
};

/** The sample "Test the connection" result (shown, never run). */
export const PREVIEW_CLIENT_AGENT_TEST: TestWords = { key: "ok", ms: 412 };
