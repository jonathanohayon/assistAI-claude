// ────────────────────────────────────────────────────────────────────────
// OpenAI Realtime API event builders — single source of truth.
//
// OpenAI changes the Realtime API contract regularly (Q4 2025 alone we've
// hit: session.type became required, session.temperature became unknown,
// response.temperature became unknown). Rather than scatter raw JSON across
// components, every outgoing event is built here. When OpenAI breaks a
// param, you patch ONE file.
//
// Each builder includes a `// last-verified: YYYY-MM-DD` comment with the
// date someone successfully sent that exact shape. If you see a builder
// older than ~6 months, double-check against current OpenAI docs.
//
// Naming: builders return the JSON that goes through `dc.send(JSON.stringify(...))`
// over the WebRTC data channel. Server-side fetch payloads (client_secrets)
// belong to a sibling module — keep separation client-data-channel vs
// server-rest.
// ────────────────────────────────────────────────────────────────────────

export interface RealtimeEvent {
  type: string;
  /** Optional client-side correlation id, surfaced in error responses. */
  event_id?: string;
  [key: string]: unknown;
}

let nextEventId = 1;
const newEventId = (): string => `c_${Date.now()}_${nextEventId++}`;

/**
 * `response.create` — trigger an LLM response.
 *
 * Removed params (do NOT re-add without checking docs):
 *   - temperature (rejected `unknown_parameter` since late 2025)
 *
 * last-verified: 2026-05-10
 */
export function buildResponseCreate(params: {
  instructions?: string;
  /** "auto" | "none" | "required" — keep "auto" by default */
  toolChoice?: "auto" | "none" | "required";
}): RealtimeEvent {
  const response: Record<string, unknown> = {};
  if (params.instructions != null) response.instructions = params.instructions;
  if (params.toolChoice != null) response.tool_choice = params.toolChoice;
  return {
    type: "response.create",
    event_id: newEventId(),
    response,
  };
}

/**
 * `session.update` — patch session-level config mid-conversation.
 *
 * REQUIRED: `session.type: "realtime"` (added by OpenAI Q4 2025; missing
 * triggers `missing_required_parameter session.type`).
 *
 * Removed params (do NOT re-add):
 *   - temperature  (unknown_parameter since late 2025 — moved away from
 *     session level entirely; no replacement at writing time)
 *
 * last-verified: 2026-05-10
 */
export function buildSessionUpdate(params: {
  instructions?: string;
  /**
   * Server VAD tuning. Quand fourni, ajoute
   * `session.audio.input.turn_detection` au shape GA Q4 2025.
   * `silenceMs` est calculé côté caller à partir du slider "Réactivité"
   * (1-10 → 1200..200 ms). Si OpenAI bascule vers la shape pré-GA
   * top-level pour ce modèle, le patch est à faire ici (un seul endroit).
   *
   * last-verified: 2026-05-14
   */
  turnDetection?: { silenceMs: number };
}): RealtimeEvent {
  const session: Record<string, unknown> = { type: "realtime" };
  if (params.instructions != null) session.instructions = params.instructions;
  if (params.turnDetection) {
    session.audio = {
      input: {
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: params.turnDetection.silenceMs,
          create_response: true,
          interrupt_response: true,
        },
      },
    };
  }
  return {
    type: "session.update",
    event_id: newEventId(),
    session,
  };
}

/**
 * Best-effort interpretation of an OpenAI error event into something a
 * human can act on. Returns a structured triage that the UI can render
 * without dumping raw JSON.
 */
export interface RealtimeErrorTriage {
  category: "unknown_parameter" | "missing_required_parameter" | "auth" | "other";
  /** Field that triggered the error (`session.type`, `response.temperature`). */
  param: string | null;
  /** The original event_id we sent that triggered this error, if echoed. */
  eventId: string | null;
  /** Short human-readable message, FR. */
  summary: string;
  /** What to do about it. */
  hint: string;
  /** Original payload kept for debugging. */
  raw: unknown;
}

export function triageRealtimeError(event: unknown): RealtimeErrorTriage {
  const e = event as Record<string, unknown> | null;
  const inner = (e?.error ?? e) as Record<string, unknown> | null;
  const code = (inner?.code as string | undefined) ?? "";
  const param = (inner?.param as string | undefined) ?? null;
  const message = (inner?.message as string | undefined) ?? "";
  const eventId = (e?.event_id as string | undefined) ?? null;

  if (code === "unknown_parameter") {
    return {
      category: "unknown_parameter",
      param,
      eventId,
      summary: `OpenAI a refusé le paramètre \`${param ?? "?"}\`.`,
      hint: `Patch lib/realtime-events.ts : retire \`${param}\` du builder concerné, mets à jour le commentaire "last-verified", et redéploie.`,
      raw: event,
    };
  }
  if (code === "missing_required_parameter") {
    return {
      category: "missing_required_parameter",
      param,
      eventId,
      summary: `OpenAI exige le paramètre manquant \`${param ?? "?"}\`.`,
      hint: `Patch lib/realtime-events.ts : ajoute \`${param}\` au builder concerné (regarde la doc OpenAI Realtime pour la valeur attendue).`,
      raw: event,
    };
  }
  if (
    /authentication|unauthorized|invalid.*key|bearer/i.test(message) ||
    code.startsWith("401")
  ) {
    return {
      category: "auth",
      param,
      eventId,
      summary: "Erreur d'authentification OpenAI Realtime.",
      hint: "Vérifie OPENAI_API_KEY / REALTIME_API_KEY dans l'env Railway.",
      raw: event,
    };
  }
  return {
    category: "other",
    param,
    eventId,
    summary: message || "Erreur Realtime inconnue.",
    hint: "Inspecte le JSON brut ci-dessous et la doc OpenAI Realtime.",
    raw: event,
  };
}
