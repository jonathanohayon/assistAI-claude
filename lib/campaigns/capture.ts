// Campaign field capture (M3a): after a connected campaign call, read the
// campaign's extraction_schema fields from the transcript. PURE (no DB, no
// network): the LLM, the write and the logger are injected, so every rule is
// testable. The server wiring is lib/campaigns/capture-runtime.ts.
//
// Display contract: a captured value is "relevé depuis la conversation" (what
// the prospect said, as read by a model), never a proven fact.

import type { CallOutcome, ExtractionField } from "@/lib/campaigns/constants";
import { normalizeExtractionSchema } from "@/lib/campaigns/validate";

/** Transcript characters sent to the model (same cap as analyze.ts). */
export const CAPTURE_TRANSCRIPT_CHARS = 12000;
/** Fields sent to the model: the first N of the schema. */
export const CAPTURE_MAX_FIELDS = 20;
/** A captured string is trimmed and capped at this length. */
export const CAPTURE_STRING_CHARS = 500;

// Catch-up on the campaign-dispatch cron tick (CAMPAIGN_CAPTURE on): a
// connected call that after() missed is captured later. Bounds:
/** At most this many calls claimed per tick, oldest first. */
export const CAPTURE_CATCHUP_PER_TICK = 10;
/** CUT-OFF (decided by tamaraVP: 72 h, outlasts a weekend incident): only calls created within the last N hours, so turning the switch on never bills every historical call. */
export const CAPTURE_CATCHUP_CUTOFF_HOURS = 72;
/** The per-tick log's `outsideWindow` count is bounded by this (a LIMIT in the query): "≥ N" when it equals N. */
export const CAPTURE_OUTSIDE_WINDOW_COUNT_CAP = 1000;
/** A pending claim older than this is abandoned (process killed mid-capture) and can be re-claimed. */
export const CAPTURE_CLAIM_STALE_MINUTES = 10;
/** At most this many capture attempts (LLM calls) per call, after() included; a call is never retried past it. */
export const CAPTURE_MAX_ATTEMPTS = 3;

export type Turn = { role: "user" | "assistant"; text: string };

/** Stored in campaign_calls.extracted. */
export interface CapturePayload {
  v: 1;
  source: "conversation";
  at: string;
  model: string;
  values: Record<string, string | number | boolean>;
  /** Required fields the model did not find (or that failed validation). */
  missing?: string[];
}

/**
 * Stored in campaign_calls.extracted WHILE a capture runs: the atomic claim.
 * Taken only from {} (or from an abandoned claim); the final write applies
 * only where extracted is still exactly this claim. Never shown as captured.
 */
export interface CaptureClaim {
  v: 1;
  pending: true;
  claimedAt: string;
  /** Random per claim statement, so two claims of one row never compare equal. */
  token: string;
  /** 1 for the first claim, +1 per re-claim; CAPTURE_MAX_ATTEMPTS = never re-claimed. */
  attempt: number;
}

export function isPendingClaim(x: unknown): x is CaptureClaim {
  return !!x && typeof x === "object" && (x as { pending?: unknown }).pending === true;
}

/** What the results route shows per call when the switch is on. */
export type CapturedView = {
  source: "conversation";
  values: Record<string, string | number | boolean>;
  missing?: string[];
} | null;

export type CaptureLlm = (req: { system: string; user: string }) => Promise<{ content: string; model: string } | null>;

export interface CaptureInput {
  /** campaign_calls.id of the row just inserted. */
  callRowId: string;
  campaignId: string;
  userId: string;
  outcome: CallOutcome;
  transcript: Turn[];
  /** campaigns.extraction_schema as stored (re-sanitised here). */
  schema: unknown;
}

export interface CaptureDeps {
  llm: CaptureLlm;
  /** Atomically claims that row (extracted {} → a pending claim); null when it is not {} (set, or claimed by someone else). */
  claim: (callRowId: string) => Promise<CaptureClaim | null>;
  /** Writes `payload` to that row ONLY if its extracted is still exactly `claim`; true when written. */
  writeClaimed: (callRowId: string, claim: CaptureClaim, payload: CapturePayload) => Promise<boolean>;
  /** A claimed call that turns out not capturable: its claim is marked exhausted, so it is never picked again. */
  park: (callRowId: string, claim: CaptureClaim) => Promise<void>;
  /** Metadata carries ids and counts only: never transcript text or values. */
  log: (ev: { event: string; level: "info" | "warn"; message: string; userId: string; metadata: Record<string, unknown> }) => Promise<void>;
  now?: () => Date;
}

/** already_set: the row was not {} (or the claim was lost): no LLM call, nothing written. */
export type CaptureResult = "skipped" | "written" | "already_set" | "failed";

/** Schema fields actually used: sanitised, unique keys, enums with options, at most CAPTURE_MAX_FIELDS. */
export function captureFields(schema: unknown): ExtractionField[] {
  const seen = new Set<string>();
  const out: ExtractionField[] = [];
  for (const f of normalizeExtractionSchema(schema)) {
    if (seen.has(f.key)) continue;
    if (f.type === "enum" && !(f.options && f.options.length)) continue;
    seen.add(f.key);
    out.push(f);
    if (out.length >= CAPTURE_MAX_FIELDS) break;
  }
  return out;
}

/** The dialog sent to the model, capped. */
export function captureDialog(transcript: Turn[]): string {
  return transcript
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => `${t.role === "user" ? "Prospect" : "Agent"}: ${t.text}`)
    .join("\n")
    .slice(0, CAPTURE_TRANSCRIPT_CHARS);
}

/** Run only for a connected call with a non-empty transcript and a non-empty schema. */
export function shouldCapture(input: Pick<CaptureInput, "outcome" | "transcript" | "schema">): boolean {
  if (input.outcome !== "connected") return false;
  if (!Array.isArray(input.transcript) || !captureDialog(input.transcript).trim()) return false;
  return captureFields(input.schema).length > 0;
}

/** System prompt: language-agnostic, prospect-only, null when unsure. */
export function capturePrompt(fields: ExtractionField[]): string {
  const spec = fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    ...(f.type === "enum" ? { options: f.options } : {}),
  }));
  return `You read the transcript of a phone call between an AI agent ("Agent") and a prospect ("Prospect") and extract a few fields.

Rules:
- Extract ONLY what the PROSPECT explicitly said in this call. Never take a value from the Agent's lines.
- Never guess, infer, estimate or fill a default. If the prospect did not clearly say it, or you are unsure, the value is null.
- The call may be in any language. Keep free text in the language it was spoken; do not translate it.
- "number": a JSON number. "boolean": true or false, only if the prospect clearly said yes or no. "enum": exactly one of the given options, otherwise null. "string": a short value in the prospect's words.

Fields (JSON):
${JSON.stringify(spec)}

Reply with JSON ONLY, exactly these keys: {"values": {"<key>": <value or null>}}`;
}

function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[\s  _]/g, "");
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** One value checked against its field type; null means absent. */
export function validateValue(field: ExtractionField, v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  switch (field.type) {
    case "number":
      return parseNumber(v);
    case "boolean":
      return typeof v === "boolean" ? v : null;
    case "enum": {
      if (typeof v !== "string") return null;
      const s = v.trim().toLowerCase();
      return field.options?.find((o) => o.trim().toLowerCase() === s) ?? null;
    }
    case "string": {
      const s = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
      if (s === null) return null;
      const t = s.trim().slice(0, CAPTURE_STRING_CHARS).trim();
      return t ? t : null;
    }
  }
}

/** The model's raw JSON → schema keys only, validated; anything else is absent. */
export function validateCaptured(
  fields: ExtractionField[],
  raw: unknown,
): { values: Record<string, string | number | boolean>; missing: string[] } {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const src = obj.values && typeof obj.values === "object" && !Array.isArray(obj.values)
    ? (obj.values as Record<string, unknown>)
    : {};
  const values: Record<string, string | number | boolean> = {};
  const missing: string[] = [];
  for (const f of fields) {
    const v = Object.prototype.hasOwnProperty.call(src, f.key) ? validateValue(f, src[f.key]) : null;
    if (v !== null) values[f.key] = v;
    else if (f.required) missing.push(f.key);
  }
  return { values, missing };
}

/**
 * Stored extracted → what the results route shows. null ONLY when no attempt
 * was recorded ({}, a pending claim, anything else). An attempt that found
 * nothing shows `values: {}` (+ the required fields still missing).
 */
export function capturedView(extracted: unknown): CapturedView {
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) return null;
  if (isPendingClaim(extracted)) return null;
  const e = extracted as Partial<CapturePayload>;
  if (e.v !== 1 || e.source !== "conversation" || !e.values || typeof e.values !== "object" || Array.isArray(e.values)) return null;
  return {
    source: "conversation",
    values: e.values,
    ...(Array.isArray(e.missing) && e.missing.length ? { missing: e.missing } : {}),
  };
}

/**
 * Never throws. Writes only to input.callRowId, and only through a claim: its
 * own (taken here from {}), or `held`, one the caller already took (the cron
 * catch-up). The LLM is called only once the claim is held, so two capturers
 * of one call (after() and a tick, two ticks) never both call it. On failure
 * the claim stays: it is re-claimed once abandoned, up to CAPTURE_MAX_ATTEMPTS.
 */
export async function runCampaignCapture(input: CaptureInput, deps: CaptureDeps, held?: CaptureClaim): Promise<CaptureResult> {
  const meta = { campaignId: input.campaignId, campaignCallId: input.callRowId };
  const fail = async (reason: string): Promise<CaptureResult> => {
    try {
      await deps.log({
        event: "campaign_capture_failed",
        level: "warn",
        message: "Relevé des champs de campagne impossible",
        userId: input.userId,
        metadata: { ...meta, reason },
      });
    } catch {
      // logging must never throw into the caller
    }
    return "failed";
  };
  try {
    if (!shouldCapture(input)) {
      if (held) await deps.park(input.callRowId, held);
      return "skipped";
    }
    const claim = held ?? (await deps.claim(input.callRowId));
    if (!claim) return "already_set";
    const fields = captureFields(input.schema);
    const res = await deps.llm({ system: capturePrompt(fields), user: `Transcript:\n\n${captureDialog(input.transcript)}` });
    if (!res) return await fail("llm_unavailable");
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.content);
    } catch {
      return await fail("bad_json");
    }
    const { values, missing } = validateCaptured(fields, parsed);
    const payload: CapturePayload = {
      v: 1,
      source: "conversation",
      at: (deps.now ?? (() => new Date()))().toISOString(),
      model: String(res.model).slice(0, 100),
      values,
      ...(missing.length ? { missing } : {}),
    };
    const written = await deps.writeClaimed(input.callRowId, claim, payload);
    try {
      await deps.log({
        event: "campaign_capture_done",
        level: "info",
        message: written ? "Champs relevés depuis la conversation" : "Champs déjà relevés, rien réécrit",
        userId: input.userId,
        metadata: { ...meta, written, captured: Object.keys(values).length, missing: missing.length, fields: fields.length },
      });
    } catch {
      // ignore
    }
    return written ? "written" : "already_set";
  } catch (e) {
    return await fail(e instanceof Error ? `error:${e.name}` : "error");
  }
}

/** The catch-up's time bounds at `now`, as ISO strings (pure). */
export interface CatchUpWindow {
  nowIso: string;
  /** Calls created before this are never picked. */
  cutoffIso: string;
  /** Pending claims taken before this are abandoned. */
  staleBeforeIso: string;
}

export function catchUpWindow(now: Date): CatchUpWindow {
  const t = now.getTime();
  return {
    nowIso: now.toISOString(),
    cutoffIso: new Date(t - CAPTURE_CATCHUP_CUTOFF_HOURS * 3_600_000).toISOString(),
    staleBeforeIso: new Date(t - CAPTURE_CLAIM_STALE_MINUTES * 60_000).toISOString(),
  };
}

/** One call claimed by the catch-up, with the claim it holds. */
export interface HeldCapture {
  input: CaptureInput;
  claim: CaptureClaim;
}

export interface CatchUpDeps extends CaptureDeps {
  /**
   * Atomically claims up to `limit` capturable calls created after
   * window.cutoffIso (oldest first): extracted {} or an abandoned claim with
   * attempts left. Calls claimed by someone else are skipped, never waited on.
   */
  claimBatch: (limit: number, window: CatchUpWindow) => Promise<HeldCapture[]>;
  /**
   * Calls that would be eligible but are older than window.cutoffIso
   * (connected, transcript, schema, extracted {}), counted up to
   * CAPTURE_OUTSIDE_WINDOW_COUNT_CAP.
   */
  countOutsideWindow: (window: CatchUpWindow) => Promise<number>;
  /** The per-tick log: COUNTS ONLY (no ids, transcripts or values). */
  logTick: (metadata: CatchUpTickLog) => Promise<void>;
}

/** Metadata of the `campaign_capture_catchup` event: exactly these two numbers. */
export interface CatchUpTickLog {
  picked: number;
  outsideWindow: number;
}

/** What the cron tick reports when the switch is on: COUNTS only. */
export interface CatchUpCounts {
  claimed: number;
  written: number;
  skipped: number;
  failed: number;
}

/** One catch-up pass. Never throws (a failing claim query counts as nothing claimed). */
export async function runCaptureCatchUp(deps: CatchUpDeps): Promise<CatchUpCounts> {
  const counts: CatchUpCounts = { claimed: 0, written: 0, skipped: 0, failed: 0 };
  const window = catchUpWindow((deps.now ?? (() => new Date()))());
  let held: HeldCapture[];
  try {
    held = await deps.claimBatch(CAPTURE_CATCHUP_PER_TICK, window);
  } catch (e) {
    console.error("[capture] catch-up claim failed:", e instanceof Error ? e.name : "error");
    return counts;
  }
  counts.claimed = held.length;
  // One counts-only event per tick, and only when there is something to say.
  try {
    const outsideWindow = Math.min(Math.max(Math.trunc(await deps.countOutsideWindow(window)) || 0, 0), CAPTURE_OUTSIDE_WINDOW_COUNT_CAP);
    if (held.length > 0 || outsideWindow > 0) await deps.logTick({ picked: held.length, outsideWindow });
  } catch {
    // observability must never block the capture
  }
  const results = await Promise.all(held.map((h) => runCampaignCapture(h.input, deps, h.claim)));
  for (const r of results) {
    if (r === "written") counts.written++;
    else if (r === "failed") counts.failed++;
    else counts.skipped++;
  }
  return counts;
}
