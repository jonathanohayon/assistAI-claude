// One call as GET /api/dashboard/campaigns/[id]/results returns it. Pure.
// With the capture switch OFF the object is exactly what the route returned
// before M3a (same keys, same order); `captured` is added ONLY when it is ON.

import { capturedView, type CapturedView } from "@/lib/campaigns/capture";
import type { CaptureMode } from "@/lib/campaigns/capture-mode";

export interface ResultsCallRow {
  id: string;
  phoneNumber: string;
  outcome: string;
  durationSeconds: number | null;
  disposition: string;
  sentiment: string;
  summary: string;
  transcript: unknown;
  createdAt: Date;
  extracted: unknown;
}

export function resultsCallView(c: ResultsCallRow, mode: CaptureMode) {
  const base = {
    id: c.id,
    phoneNumber: c.phoneNumber,
    outcome: c.outcome,
    durationSeconds: c.durationSeconds ?? 0,
    success: c.disposition || null,
    sentiment: c.sentiment || null,
    summary: c.summary || "",
    transcript: Array.isArray(c.transcript) ? c.transcript : [],
    createdAt: c.createdAt.toISOString(),
  };
  if (mode !== "on") return base;
  const captured: CapturedView = capturedView(c.extracted);
  return { ...base, captured };
}
