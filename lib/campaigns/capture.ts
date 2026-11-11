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
  /** Writes `payload` to that row ONLY if its extracted is still {}; true when written. */
  writeIfEmpty: (callRowId: string, payload: CapturePayload) => Promise<boolean>;
  /** Metadata carries ids and counts only: never transcript text or values. */
  log: (ev: { event: string; level: "info" | "warn"; message: string; userId: string; metadata: Record<string, unknown> }) => Promise<void>;
  now?: () => Date;
}

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

/** Stored extracted → what the results route shows; null when nothing was captured. */
export function capturedView(extracted: unknown): CapturedView {
  if (!extracted || typeof extracted !== "object") return null;
  const e = extracted as Partial<CapturePayload>;
  if (e.v !== 1 || e.source !== "conversation" || !e.values || typeof e.values !== "object") return null;
  if (Object.keys(e.values).length === 0) return null;
  return {
    source: "conversation",
    values: e.values,
    ...(Array.isArray(e.missing) && e.missing.length ? { missing: e.missing } : {}),
  };
}

/** Never throws. Writes only to input.callRowId and only if its extracted is still {}. */
export async function runCampaignCapture(input: CaptureInput, deps: CaptureDeps): Promise<CaptureResult> {
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
    if (!shouldCapture(input)) return "skipped";
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
    const written = await deps.writeIfEmpty(input.callRowId, payload);
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
