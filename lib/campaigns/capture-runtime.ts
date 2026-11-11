// Server wiring for campaign field capture (lib/campaigns/capture.ts):
// OpenAI caller, write-once DB update, logger, and the after-response
// scheduler. SERVER-ONLY. Only called when captureMode() is "on".

import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/lib/db";
import { campaignCalls } from "@/lib/db/schema";
import { logEvent } from "@/lib/logger";
import { runCampaignCapture, type CaptureDeps, type CaptureInput, type CaptureLlm } from "@/lib/campaigns/capture";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const LLM_TIMEOUT_MS = 30_000;

/** OpenAI JSON-mode call, same model env and key resolution as analyze.ts; null on any error. */
export const openAiCaptureLlm: CaptureLlm = async ({ system, user }) => {
  const model =
    process.env.CAMPAIGN_CAPTURE_MODEL ??
    process.env.CAMPAIGN_ANALYZE_MODEL ??
    process.env.SUMMARY_MODEL ??
    "gpt-5.4-mini";
  const apiKey = process.env.REALTIME_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return null;
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? { content, model: data.model || model } : null;
  } catch {
    return null;
  }
};

/** Write-once: only that row, only while its extracted is still {}. */
export async function writeCaptureIfEmpty(callRowId: string, payload: unknown): Promise<boolean> {
  const rows = await db
    .update(campaignCalls)
    .set({ extracted: payload as Record<string, unknown> })
    .where(and(eq(campaignCalls.id, callRowId), sql`${campaignCalls.extracted} = '{}'::jsonb`))
    .returning({ id: campaignCalls.id });
  return rows.length > 0;
}

export interface CaptureRuntime {
  llm: CaptureLlm;
  writeIfEmpty: CaptureDeps["writeIfEmpty"];
  /** Runs the task after the response is sent (next/server after()). */
  schedule: (task: () => Promise<unknown>) => void;
}

const defaultRuntime: CaptureRuntime = {
  llm: openAiCaptureLlm,
  writeIfEmpty: writeCaptureIfEmpty,
  schedule: (task) => after(task),
};
let runtime: CaptureRuntime = defaultRuntime;

/** Tests only: swap the LLM / write / scheduler. Returns a restore function. */
export function setCaptureRuntimeForTests(r: Partial<CaptureRuntime>): () => void {
  runtime = { ...defaultRuntime, ...r };
  return () => {
    runtime = defaultRuntime;
  };
}

/**
 * Schedules the capture after the response. Never throws into the route: a
 * scheduling failure is swallowed, the task itself never throws
 * (runCampaignCapture catches and logs).
 */
export function scheduleCampaignCapture(input: CaptureInput): void {
  const r = runtime;
  try {
    r.schedule(() =>
      runCampaignCapture(input, {
        llm: r.llm,
        writeIfEmpty: r.writeIfEmpty,
        log: (ev) => logEvent({ source: "web", ...ev }),
      }),
    );
  } catch {
    // after() outside a request scope, or similar: capture is best-effort.
  }
}
