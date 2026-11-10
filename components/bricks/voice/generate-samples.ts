// Admin "Generate voice samples" loop (V7) — pure, testable. Calls the capped
// endpoint (POST /api/admin/voice-samples/generate?limit=6) until nothing is
// left, reporting progress. Idempotent on the server, so re-running is safe.

export interface GenerateResponse {
  generated: number;
  failed: Array<{ voiceId: string; style: string; language: string; error: string }>;
  remaining: number;
}

export interface GenerateProgress {
  done: number;
  total: number;
  failed: GenerateResponse["failed"];
  /** "done" = nothing left; "stuck" = a pass made no progress (only failures). */
  status: "running" | "done" | "stuck" | "error";
  error?: string;
}

/**
 * `existing()` = keys ("voice/style/language") of the samples that exist now
 * (the reloaded list). A failure is shown only while its sample is still
 * missing. Stops when remaining is 0, when a pass generates nothing (so
 * failures can't loop forever), on an HTTP error, or after `maxPasses`.
 */
export async function generateAllSamples(opts: {
  total: number;
  existing: () => Promise<ReadonlySet<string>>;
  post: () => Promise<{ ok: boolean; status: number; body: GenerateResponse | null }>;
  onProgress: (p: GenerateProgress) => void;
  maxPasses?: number;
}): Promise<GenerateProgress> {
  const key = (f: { voiceId: string; style: string; language: string }) => `${f.voiceId}/${f.style}/${f.language}`;
  const failedByKey = new Map<string, GenerateResponse["failed"][number]>();
  let have = await opts.existing();
  const report = (status: GenerateProgress["status"], error?: string): GenerateProgress => {
    for (const k of [...failedByKey.keys()]) if (have.has(k)) failedByKey.delete(k);
    const p = { done: have.size, total: opts.total, failed: [...failedByKey.values()], status, ...(error ? { error } : {}) };
    opts.onProgress(p);
    return p;
  };
  report("running");
  for (let pass = 0; pass < (opts.maxPasses ?? 40); pass++) {
    const r = await opts.post();
    if (!r.ok || !r.body) return report("error", `HTTP ${r.status}`);
    for (const f of r.body.failed) failedByKey.set(key(f), f);
    have = await opts.existing();
    if (r.body.remaining === 0) return report("done");
    if (r.body.generated === 0) return report("stuck");
    report("running");
  }
  return report("stuck");
}
