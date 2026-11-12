// The live test's failure codes. The panel shows OUR sentence for a code,
// never the server's text or the SDK's message (which can name a supplier
// or a configuration detail). Pure and SDK-free: the panel imports it
// statically, and scripts/tests/live-test-errors.test.ts probes it.

export type LiveTestErrorCode =
  | "not_configured"
  | "rate_limited"
  | "unavailable"
  | "unauthorized"
  | "forbidden"
  | "plan_required"
  | "connect_failed"
  | "failed";

export class LiveTestError extends Error {
  readonly code: LiveTestErrorCode;
  /** Minutes to wait (rate_limited only), null when the server gave none. */
  readonly minutes: number | null;

  constructor(code: LiveTestErrorCode, minutes: number | null = null) {
    // The message is the code only: it is never shown to anyone.
    super(code);
    this.name = "LiveTestError";
    this.code = code;
    this.minutes = minutes;
  }
}

/**
 * Retry-After (delta-seconds form) to whole minutes, rounded up, at least 1.
 * Null when the header is missing, empty, or in HTTP-date form.
 * Local copy: the same helper lives on the unmerged fe/owner-email-card branch.
 */
export function retryAfterMinutes(header: string | null | undefined): number | null {
  if (header == null) return null;
  const v = header.trim();
  if (!/^\d+$/.test(v)) return null;
  const seconds = Number(v);
  if (!Number.isFinite(seconds)) return null;
  return Math.max(1, Math.ceil(seconds / 60));
}

/** The `error` field of a JSON body, else the raw text. */
function errorField(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const e = (parsed as { error: unknown }).error;
      if (typeof e === "string") return e;
    }
  } catch {
    // not JSON: fall through to the raw text
  }
  return bodyText;
}

/** Maps a failed token response (status, body, Retry-After) to a code. */
export function liveTestErrorFromResponse(
  status: number,
  bodyText: string,
  retryAfter: string | null | undefined,
): LiveTestError {
  const error = errorField(bodyText ?? "");
  // PR #305's body is { error: "not_configured" }; main today still says it
  // in words ("... not configured"), so keep that fallback.
  if (error === "not_configured" || /\bnot configured\b/i.test(error)) {
    return new LiveTestError("not_configured");
  }
  if (status === 429 || error === "rate_limited") {
    return new LiveTestError("rate_limited", retryAfterMinutes(retryAfter));
  }
  if (status === 503 || error === "unavailable") return new LiveTestError("unavailable");
  if (error === "plan_feature_required") return new LiveTestError("plan_required");
  if (status === 401) return new LiveTestError("unauthorized");
  if (status === 403) return new LiveTestError("forbidden");
  return new LiveTestError("failed");
}

/** Anything thrown by the live test, as a LiveTestError. */
export function toLiveTestError(e: unknown): LiveTestError {
  return e instanceof LiveTestError ? e : new LiveTestError("failed");
}

/** The LiveTest.errors.* key (and its values) for an error. */
export function liveTestErrorMessage(err: LiveTestError): {
  key: string;
  values?: { minutes: number };
} {
  switch (err.code) {
    case "not_configured":
      return { key: "errors.notConfigured" };
    case "rate_limited":
      return err.minutes != null
        ? { key: "errors.rateLimited", values: { minutes: err.minutes } }
        : { key: "errors.rateLimitedNoTime" };
    case "unavailable":
      return { key: "errors.unavailable" };
    case "plan_required":
      return { key: "errors.planRequired" };
    case "unauthorized":
      return { key: "errors.unauthorized" };
    case "connect_failed":
      return { key: "errors.connectFailed" };
    case "forbidden":
    case "failed":
    default:
      return { key: "errors.failed" };
  }
}
