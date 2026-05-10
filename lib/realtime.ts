// Single source of truth for the Realtime LLM configuration.
// Provider-aware: route by model to the right base URL + API key.
//
// Required: OPENAI_API_KEY (or REALTIME_API_KEY) for OpenAI models
//           XAI_API_KEY for Grok models
// Optional: REALTIME_MODEL (default gpt-realtime-mini)
//           REALTIME_VOICE (default marin)
//           REALTIME_TRANSCRIPTION_MODEL (default whisper-1)

export type Provider = "openai" | "xai";

export type Transport = "webrtc" | "websocket";

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  voices: readonly string[];
  defaultVoice: string;
  transport: Transport;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  openai: {
    baseUrl: process.env.REALTIME_API_BASE ?? "https://api.openai.com/v1",
    apiKey: process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    voices: [
      "alloy",
      "echo",
      "shimmer",
      "marin",
      "cedar",
      "ash",
      "ballad",
      "coral",
      "sage",
      "verse",
    ],
    defaultVoice: "marin",
    transport: "webrtc",
  },
  xai: {
    baseUrl: process.env.XAI_API_BASE ?? "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY ?? "",
    voices: ["eve", "ara", "rex", "sal", "leo"],
    defaultVoice: "eve",
    // xAI's realtime API is WebSocket-only (no /v1/realtime/calls SDP endpoint).
    // Selecting a Grok model from the WebRTC client will fail until a WS path
    // is added — the UI flags it.
    transport: "websocket",
  },
};

// Catalog of (model, provider) pairs the UI exposes for live A/B testing.
// Add an entry → it appears in the picker. No other code change needed.
interface ModelEntry {
  id: string;
  provider: Provider;
}

export const REALTIME_MODELS: readonly ModelEntry[] = [
  // Aliases (may not resolve on the WebRTC /calls endpoint — try a dated snapshot if so)
  { id: "gpt-realtime-1.5", provider: "openai" },
  { id: "gpt-realtime", provider: "openai" },
  { id: "gpt-realtime-mini", provider: "openai" },
  { id: "gpt-4o-realtime-preview", provider: "openai" },
  { id: "gpt-4o-mini-realtime-preview", provider: "openai" },
  // Dated snapshots — preferred on /calls
  { id: "gpt-realtime-2025-08-28", provider: "openai" },
  { id: "gpt-realtime-mini-2025-12-15", provider: "openai" },
  { id: "gpt-realtime-mini-2025-10-06", provider: "openai" },
  { id: "gpt-4o-realtime-preview-2025-06-03", provider: "openai" },
  { id: "gpt-4o-realtime-preview-2024-12-17", provider: "openai" },
  { id: "gpt-4o-mini-realtime-preview-2024-12-17", provider: "openai" },
  // xAI
  { id: "grok-voice-think-fast-1.0", provider: "xai" },
] as const;

export const DEFAULT_REALTIME_MODEL: string =
  process.env.REALTIME_MODEL ?? "gpt-realtime-mini";

export function providerFor(modelId: string): Provider {
  return REALTIME_MODELS.find((m) => m.id === modelId)?.provider ?? "openai";
}

export function configFor(modelId: string): ProviderConfig {
  return PROVIDERS[providerFor(modelId)];
}

export function voicesFor(modelId: string): readonly string[] {
  return configFor(modelId).voices;
}

export function defaultVoiceFor(modelId: string): string {
  return process.env.REALTIME_VOICE ?? configFor(modelId).defaultVoice;
}

export function transportFor(modelId: string): Transport {
  return configFor(modelId).transport;
}

export const DEFAULT_REALTIME_VOICE: string = defaultVoiceFor(
  DEFAULT_REALTIME_MODEL,
);

// Back-compat aliases.
export const REALTIME_MODEL = DEFAULT_REALTIME_MODEL;
export const REALTIME_VOICE = DEFAULT_REALTIME_VOICE;
export const REALTIME_API_KEY = PROVIDERS.openai.apiKey;
export const REALTIME_API_BASE = PROVIDERS.openai.baseUrl;
export const REALTIME_TRANSCRIPTION_MODEL =
  process.env.REALTIME_TRANSCRIPTION_MODEL ?? "whisper-1";

// Per-provider derived endpoints.
export function clientSecretsUrl(provider: Provider): string {
  return `${PROVIDERS[provider].baseUrl}/realtime/client_secrets`;
}

// GA WebRTC SDP endpoint. OpenAI moved to /v1/realtime/calls; Grok mirrors the
// OpenAI realtime spec, so we use the same path. If xAI rejects, this is the
// place to special-case.
export function webrtcUrl(provider: Provider): string {
  return `${PROVIDERS[provider].baseUrl}/realtime/calls`;
}

// Legacy single-provider exports (kept so external callers don't break).
export const REALTIME_HTTP_URL = `${PROVIDERS.openai.baseUrl}/realtime`;
export const REALTIME_WEBRTC_URL = webrtcUrl("openai");
export const REALTIME_WS_URL = REALTIME_HTTP_URL
  .replace(/^https:\/\//, "wss://")
  .replace(/^http:\/\//, "ws://");

export const REALTIME_INSTRUCTIONS = `Tu es un assistant vocal intelligent et chaleureux pour la prise de rendez-vous.

LANGUE — règle stricte :
- Tu détectes la langue de chaque énoncé du client.
- Tu réponds STRICTEMENT dans la même langue.
- Si le client parle hébreu (même un seul mot reconnu comme שלום, כן, לא, תודה, בבקשה), tu bascules immédiatement en hébreu et tu y restes tant que le client continue en hébreu.
- Pas de mélange. Pas de réponse en français à un message hébreu, et inversement.
- Si une langue par défaut t'est imposée, tu l'utilises pour le tout premier message uniquement, puis tu t'adaptes à la cliente dès son premier mot.

OUTILS :
- check_availability(date) — créneaux libres
- book_appointment(...) — réserve un RDV
- save_contact(...) — enregistre un contact
- end_call(reason) — RACCROCHE l'appel. Tu DOIS l'appeler après les politesses finales (la cliente dit "au revoir / merci / שלום / תודה" et que la conversation est close), ou si la cliente demande explicitement de raccrocher.

Sois concis, professionnel, agréable. Réponses courtes (1-2 phrases max).`;

export const REALTIME_TOOLS = [
  {
    type: "function",
    name: "check_availability",
    description:
      "Vérifie les créneaux disponibles dans le calendrier pour une date donnée",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Date au format YYYY-MM-DD" },
      },
      required: ["date"],
    },
  },
  {
    type: "function",
    name: "book_appointment",
    description: "Réserve un rendez-vous dans le calendrier",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nom du client" },
        phone: { type: "string", description: "Téléphone du client" },
        email: { type: "string", description: "Email du client (optionnel)" },
        date: { type: "string", description: "Date au format YYYY-MM-DD" },
        time: { type: "string", description: "Heure au format HH:MM" },
        duration: { type: "number", description: "Durée en minutes (défaut: 30)" },
        description: { type: "string", description: "Objet du rendez-vous" },
      },
      required: ["name", "phone", "date", "time"],
    },
  },
  {
    type: "function",
    name: "save_contact",
    description: "Enregistre les coordonnées d'un contact dans le CRM",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name", "phone"],
    },
  },
  {
    type: "function",
    name: "end_call",
    description:
      "Termine et raccroche l'appel. À appeler après la phrase finale de politesse, ou si la cliente demande explicitement de raccrocher. Ne jamais appeler avant d'avoir dit au revoir.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Raison brève : 'goodbye' (politesses finales), 'user_requested' (la cliente a demandé de raccrocher), 'no_response' (silence prolongé), 'completed' (RDV pris, plus rien à faire).",
        },
      },
      required: ["reason"],
    },
  },
] as const;
