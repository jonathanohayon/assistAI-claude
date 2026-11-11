// Pure helpers for the "Who answers the phone" section (agent-brain-section).
// No React, no fetch: the mapping from the server's answer to what the screen
// may show, and from a refused save to plain words.
//
// Rules (SSRF follow-up to #253):
//   - the webhook url is shown only when the server says `urlEditable`
//     (an admin); a tenant only learns whether one is configured;
//   - the signing secret is write-only: the view keeps "set / not set",
//     never the value;
//   - a refused save maps to one of three message keys, never to the
//     server's own `message` or error code.

/** The GET / PUT /api/dashboard/agent-brain answer, as received (untrusted shape). */
export type BrainResponse = {
  brain?: { enabled?: unknown; url?: unknown; secret?: unknown } | null;
  urlEditable?: unknown;
  error?: unknown;
  message?: unknown;
  fields?: unknown;
};

/** What the screen may render. No url for a tenant, never the secret. */
export type BrainView = {
  enabled: boolean;
  /** true only when the server says so (an admin). Missing = false. */
  urlEditable: boolean;
  /** A webhook url is stored (shown as "configured", not as the url, to a tenant). */
  urlConfigured: boolean;
  /** A signing secret is stored. The value itself never reaches the view. */
  secretSet: boolean;
  /** The url to edit: "" unless urlEditable. */
  url: string;
};

export const EMPTY_BRAIN_VIEW: BrainView = {
  enabled: false,
  urlEditable: false,
  urlConfigured: false,
  secretSet: false,
  url: "",
};

export type BrainState = {
  view: BrainView;
  /**
   * The stored url, kept out of the view. A tenant's save must send it back
   * unchanged (the server treats a different or missing url as a change and
   * answers 403 admin_only); it is never rendered.
   */
  storedUrl: string;
};

export function toBrainState(d: BrainResponse | null | undefined): BrainState {
  const b = d?.brain ?? null;
  const storedUrl = typeof b?.url === "string" ? b.url.trim() : "";
  const urlEditable = d?.urlEditable === true;
  return {
    storedUrl,
    view: {
      enabled: b?.enabled === true,
      urlEditable,
      urlConfigured: storedUrl !== "",
      secretSet: typeof b?.secret === "string" && b.secret !== "",
      url: urlEditable ? storedUrl : "",
    },
  };
}

/**
 * The PUT body. A tenant always sends the stored url back (no change); an
 * admin sends what they typed. A secret is sent only when one was typed.
 */
export function brainPutBody(
  state: BrainState,
  next: { enabled: boolean; url?: string; secret?: string },
): { enabled: boolean; url: string; secret?: string } {
  const url = state.view.urlEditable && typeof next.url === "string" ? next.url.trim() : state.storedUrl;
  const secret = next.secret?.trim();
  return { enabled: next.enabled, url, ...(secret ? { secret } : {}) };
}

export type BrainErrorKey = "adminOnly" | "unsafeUrl" | "generic";

/**
 * A refused save → the message key to show. null when the save went through.
 * The server's `message` is deliberately ignored.
 */
export function brainSaveError(status: number, body: BrainResponse | null | undefined): BrainErrorKey | null {
  const code = typeof body?.error === "string" ? body.error : null;
  if (status >= 200 && status < 300 && !code) return null;
  if (status === 403 && code === "admin_only") return "adminOnly";
  if (status === 400 && code === "unsafe_url") return "unsafeUrl";
  return "generic";
}
