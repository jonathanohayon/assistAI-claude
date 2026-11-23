// Pure helpers for the "Who answers the phone" section (agent-brain-section).
// No React, no fetch: the mapping from the server's answer to what the screen
// may show, and from a refused save to plain words.
//
// Rules (SSRF follow-up to #253):
//   - the webhook url is shown only when the server says `urlEditable`
//     (an admin); a tenant only learns whether one is configured;
//   - the signing secret is write-only: the view keeps "set / not set",
//     never the value;
//   - a refused save maps to one of our message keys, never to the
//     server's own `message` or error code.

/** The GET / PUT /api/dashboard/agent-brain answer, as received (untrusted shape). */
export type BrainResponse = {
  brain?: { enabled?: unknown; url?: unknown; urlSet?: unknown; secretSet?: unknown; secret?: unknown } | null;
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

export type BrainState = { view: BrainView };

/**
 * Server shape since #254: a tenant gets `{ enabled, url: "", urlSet,
 * secretSet }`; an admin the same plus `url` and `secret`. The url is read
 * only when `urlEditable`; the secret value is never read at all.
 */
export function toBrainState(d: BrainResponse | null | undefined): BrainState {
  const b = d?.brain ?? null;
  const urlEditable = d?.urlEditable === true;
  const url = urlEditable && typeof b?.url === "string" ? b.url.trim() : "";
  return {
    view: {
      enabled: b?.enabled === true,
      urlEditable,
      urlConfigured: b?.urlSet === true || url !== "",
      secretSet: b?.secretSet === true,
      url,
    },
  };
}

/**
 * The PUT body. A tenant never sends `url` (absent keeps the stored one on
 * the server; a different one would be a 403); an admin sends what they
 * typed. A secret is sent only when one was typed.
 */
export function brainPutBody(
  state: BrainState,
  next: { enabled: boolean; url?: string; secret?: string },
): { enabled: boolean; url?: string; secret?: string } {
  const secret = next.secret?.trim();
  return {
    enabled: next.enabled,
    ...(state.view.urlEditable && typeof next.url === "string" ? { url: next.url.trim() } : {}),
    ...(secret ? { secret } : {}),
  };
}

export type BrainErrorKey = "addressRequired" | "adminOnly" | "unsafeUrl" | "unsafeUrlTenant" | "generic";

/** The control a message belongs to: it is shown right next to it, never at the bottom of the card. */
export type BrainErrorAt = "toggle" | "url" | "secret";

export type BrainError = { at: BrainErrorAt; key: BrainErrorKey };

const ADDRESS_FIRST: BrainError = { at: "toggle", key: "addressRequired" };

/**
 * Whether an address can carry the agent: trimmed, starts with "http", the
 * scheme in any case ("HTTPS://…" is usable). The server's rule lives in
 * server-only modules (node:crypto, dns), so it can't be imported here.
 */
export function brainUrlUsable(url: string | undefined): boolean {
  return typeof url === "string" && url.trim().toLowerCase().startsWith("http");
}

/**
 * What a save would do, decided before any request. An admin saving the
 * agent ON with no usable address in the field gets the "address first" line
 * under the switch and NO request. A tenant never carries a url (the server
 * keeps the stored one), so their save always goes out.
 */
export function brainSavePlan(
  state: BrainState,
  next: { enabled: boolean; url?: string; secret?: string },
): { put: ReturnType<typeof brainPutBody> } | { refuse: BrainError } {
  if (next.enabled && state.view.urlEditable && !brainUrlUsable(next.url)) return { refuse: ADDRESS_FIRST };
  return { put: brainPutBody(state, next) };
}

/**
 * A save's answer -> the message to show and next to which control. null
 * when the save went through. The server's `message` is deliberately ignored.
 *
 *   - 400 address_required, or 400 unsafe_url on an EMPTY address (what the
 *     server answered before address_required): "address first", under the
 *     switch;
 *   - 400 unsafe_url on a real address: an admin can fix it, so the short
 *     line under the address field; a tenant can't see or edit it, so the
 *     long line (who can, or turn the agent off) under the control they used;
 *   - 200 that stored the agent OFF when we asked ON (the server dropped
 *     it): "address first" under the switch, never a silent snap-back;
 *   - anything else: the generic line under the control used.
 */
export function brainSaveError(
  status: number,
  body: BrainResponse | null | undefined,
  opts: { urlEditable: boolean; from: BrainErrorAt; sent: { enabled: boolean; url?: string } },
): BrainError | null {
  const code = typeof body?.error === "string" ? body.error : null;
  if (status >= 200 && status < 300 && !code) {
    return opts.sent.enabled && !toBrainState(body).view.enabled ? ADDRESS_FIRST : null;
  }
  if (status === 400 && code === "address_required") return ADDRESS_FIRST;
  if (status === 400 && code === "unsafe_url") {
    if (!opts.urlEditable) return { at: opts.from, key: "unsafeUrlTenant" };
    if (!opts.sent.url?.trim()) return ADDRESS_FIRST;
    return { at: "url", key: "unsafeUrl" };
  }
  if (status === 403 && code === "admin_only") return { at: opts.urlEditable ? "url" : opts.from, key: "adminOnly" };
  return { at: opts.from, key: "generic" };
}
