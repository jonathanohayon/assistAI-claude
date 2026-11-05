// Pure production-monitoring rules (no DB, no network). Unit-tested in
// scripts/tests/monitoring-rules.test.ts.

export type AlertSeverity = "critical" | "warning";

/**
 * Quiet hours: 23:00–07:00 Israel time. Warnings wait; critical alerts
 * (no call can be answered) always go out.
 */
export function isQuietHours(now: Date, startHour = 23, endHour = 7): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

export function shouldDeliver(severity: AlertSeverity, now: Date): boolean {
  return severity === "critical" || !isQuietHours(now);
}

/** What the worker reports every few minutes (POST /api/agent/heartbeat). */
export interface WorkerHeartbeat {
  at: number; // epoch ms, set by the web on receipt
  agentName: string;
  version: string;
  /** Read-only key checks run by the worker (it holds the keys). */
  keys?: Partial<Record<"openai" | "gemini" | "xai", "ok" | "invalid" | "unreachable" | "missing">>;
}

/** No heartbeat for this long = the worker is down or can't reach the web. */
export const HEARTBEAT_STALE_MS = 12 * 60 * 1000;

export function heartbeatProblem(hb: WorkerHeartbeat | null, now: number): string | null {
  if (!hb) return "The worker has never sent a heartbeat.";
  const ageMin = Math.round((now - hb.at) / 60_000);
  if (now - hb.at > HEARTBEAT_STALE_MS) {
    return (
      `No worker heartbeat for ${ageMin} min (last: ${new Date(hb.at).toISOString()}).\n` +
      "Either the worker is down, or its INTERNAL_SECRET no longer matches the web " +
      "(then every call runs on the default persona). No call may be answered correctly."
    );
  }
  return null;
}

/**
 * Keys the worker reports as unusable. "unreachable" is a network blip, not
 * a dead key: not alerted on its own.
 */
export function deadKeys(hb: WorkerHeartbeat | null): string[] {
  if (!hb?.keys) return [];
  return Object.entries(hb.keys)
    .filter(([, v]) => v === "invalid")
    .map(([k]) => k);
}

/** Worker events that mean calls are failing, and how loud to be. */
export const EVENT_ALERTS: Record<
  string,
  { severity: AlertSeverity; dedupMs: number; subject: (code: string) => string; hint: string }
> = {
  realtime_fatal_error: {
    severity: "critical",
    dedupMs: 6 * 3600_000,
    subject: (code) => `Voice agent: fatal model error (${code})`,
    hint: "Every call on this engine fails the same way until fixed (dead key, no quota, unknown model).",
  },
  provider_key_missing: {
    severity: "critical",
    dedupMs: 6 * 3600_000,
    subject: (code) => `Voice agent: engine key missing (${code})`,
    hint: "A tenant's engine has no API key on the worker: its calls fall back to OpenAI.",
  },
  gemini_silent_gen: {
    severity: "warning",
    dedupMs: 6 * 3600_000,
    subject: () => "Voice agent: Gemini went silent mid-call",
    hint: "Known upstream bug (agents-js #1450); the reply was re-issued. Frequent = move the tenant off Gemini.",
  },
  realtime_zombie_detected: {
    severity: "warning",
    dedupMs: 24 * 3600_000,
    subject: () => "Voice agent: model session survived the call",
    hint: "A realtime WebSocket kept running after the call ended (billing risk); it was closed again.",
  },
};

export interface DigestInput {
  calls: number;
  callSeconds: number;
  bookings: number;
  errors: number;
  topErrors: Array<{ event: string; n: number }>;
  heartbeatAgeMin: number | null;
  synthetic: { config: number | "error"; greeting: number | "error" } | null;
}

/** The daily WhatsApp digest (plain text, short). */
export function formatDigest(d: DigestInput): string {
  const lines = [
    "aitamara: last 24 h",
    `Calls: ${d.calls} (${Math.round(d.callSeconds / 60)} min)`,
    `Bookings: ${d.bookings}`,
    `Errors: ${d.errors}${d.topErrors.length ? ` (${d.topErrors.map((t) => `${t.event} ${t.n}`).join(", ")})` : ""}`,
    `Worker heartbeat: ${d.heartbeatAgeMin == null ? "none" : `${d.heartbeatAgeMin} min ago`}`,
  ];
  if (d.synthetic) {
    const ok = d.synthetic.config === 200 && (d.synthetic.greeting === 200 || d.synthetic.greeting === 204);
    lines.push(
      `Synthetic check: ${ok ? "OK" : "FAILED"} (config ${d.synthetic.config}, greeting ${d.synthetic.greeting})`,
    );
  }
  return lines.join("\n");
}
