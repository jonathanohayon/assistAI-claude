// SSRF guard on the legacy external-agent webhook (agentWebhook). Pure
// decisions, the URL check injected (lib/net/safe-url.ts checkAgentUrl).
//   SAVE  (PUT /api/dashboard/agent-brain): a new or changed url is admin-only
//         until the "ask your agent" tool ships; any url being saved or
//         enabled must pass the check.
//   SERVE (/api/agent/config): a webhook whose url fails the check is not
//         served — the call gets the normal Tamara.

import { checkAgentUrl, SAFE_URL_MESSAGE, type CheckOptions, type UnsafeUrlCode } from "@/lib/net/safe-url";

export type BrainSaveDecision =
  | { ok: true }
  | { ok: false; status: 403; body: { error: "admin_only"; fields: ["url"] } }
  | { ok: false; status: 400; body: { error: "address_required" } }
  | { ok: false; status: 400; body: { error: "unsafe_url"; message: string } };

/**
 * THE normalisation of an own-agent address, used by the route (urlToSave,
 * agentBrainSaveDecision) and by the store (lib/agent-brain.ts
 * planAgentBrainEntry), so they can't disagree. Pure.
 *   - trimmed (as before);
 *   - the SCHEME and the HOST are lower-cased ("HTTPS://Agent.Example.com"
 *     → "https://agent.example.com"); path, query and fragment keep their
 *     case; userinfo (refused by the check anyway) is left untouched;
 *   - anything without a "scheme://" prefix is returned trimmed, unchanged
 *     (the SSRF check then refuses it exactly as before).
 * It only lower-cases what WHATWG URL already treats case-insensitively, so
 * checkAgentUrl decides the same thing before and after it.
 * A url stored before this rule existed is read as is (no migration); it is
 * normalised only when it is saved again.
 */
export function normaliseAgentUrl(raw: string): string {
  const url = raw.trim();
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([\s\S]*)$/.exec(url);
  if (!m) return url;
  const [, scheme, authority, rest] = m;
  const at = authority.lastIndexOf("@");
  const host = at === -1 ? authority.toLowerCase() : authority.slice(0, at + 1) + authority.slice(at + 1).toLowerCase();
  return `${scheme.toLowerCase()}://${host}${rest}`;
}

/**
 * THE rule for "this brain has an address the store can switch on": trimmed,
 * starts with "http", in ANY case — the same rule as the dashboard toggle
 * (tamaraHenry's fix/brain-toggle-clickable). The store normalises the scheme
 * to lower case before storing (normaliseAgentUrl), so "HTTPS://…" is usable
 * and stored as "https://…".
 */
export function brainAddressUsable(url: string): boolean {
  return /^http/i.test(url.trim());
}

export async function agentBrainSaveDecision(args: {
  /** The stored url ("" = none). */
  currentUrl: string;
  /** The url in the PUT body, trimmed ("" = none). */
  url: string;
  /** The enabled value the save would STORE (enabledToSave), not the raw body field. */
  wantsEnabled: boolean;
  isAdmin: boolean;
  check?: CheckOptions;
}): Promise<BrainSaveDecision> {
  // Normalised before the comparison and the SSRF check (idempotent: the
  // route already passes urlToSave's normalised value).
  const url = normaliseAgentUrl(args.url);
  const changed = url !== normaliseAgentUrl(args.currentUrl);
  if (changed && !args.isAdmin) return { ok: false, status: 403, body: { error: "admin_only", fields: ["url"] } };
  // Turning the webhook on with no address at all: its own code, before the
  // SSRF check (an empty address isn't "unsafe", it is missing). No message:
  // the copy belongs to the screen.
  if (args.wantsEnabled && !url.trim()) return { ok: false, status: 400, body: { error: "address_required" } };
  // A url being saved, or a webhook being turned on, must be safe. Turning it
  // off (or clearing the url) always passes.
  if ((changed && url) || args.wantsEnabled) {
    const r = await checkAgentUrl(url, args.check);
    if (!r.ok) return { ok: false, status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE } };
  }
  // A non-empty address that passes the SSRF check but not the store's rule
  // can't be used: unsafe_url, as any other non-empty address that can't be
  // used (defensive: since normaliseAgentUrl, every address the check accepts
  // is usable).
  if (args.wantsEnabled && !brainAddressUsable(url)) {
    return { ok: false, status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE } };
  }
  return { ok: true };
}

export type ServedWebhook<W extends { url: string }> = { webhook: W | undefined; refused: UnsafeUrlCode | null };

/** The webhook to serve: unchanged when its url is safe, omitted otherwise. */
export async function servedAgentWebhook<W extends { url: string }>(
  candidate: W | undefined,
  check?: CheckOptions,
): Promise<ServedWebhook<W>> {
  if (!candidate) return { webhook: undefined, refused: null };
  const r = await checkAgentUrl(candidate.url, check);
  return r.ok ? { webhook: candidate, refused: null } : { webhook: undefined, refused: r.code };
}

/**
 * The url a PUT saves. A tenant can't see the url (it is admin-managed until
 * the "ask your agent" tool ships), so for a non-admin an ABSENT or EMPTY url
 * keeps the stored one — only a real, different url is a change (→ 403 in
 * agentBrainSaveDecision). For an admin: absent keeps it, "" clears it.
 */
export function urlToSave(bodyUrl: unknown, currentUrl: string, isAdmin: boolean): string {
  if (typeof bodyUrl !== "string") return currentUrl.trim();
  // A url in the body is normalised (scheme + host lower case) before the
  // check and the store; a kept one is passed on as stored.
  const url = normaliseAgentUrl(bodyUrl);
  return url === "" && !isAdmin ? currentUrl.trim() : url;
}

/**
 * The enabled flag a PUT saves. Only an explicit boolean changes it; an
 * absent (or non-boolean) `enabled` keeps the stored value — a partial save
 * (`{ secret }`, an admin's `{ url }`) must not switch the customer's agent off.
 */
export function enabledToSave(bodyEnabled: unknown, currentEnabled: boolean): boolean {
  return typeof bodyEnabled === "boolean" ? bodyEnabled : currentEnabled;
}

/**
 * What GET / PUT return. The secret's VALUE and the url only to an admin;
 * a tenant gets `secretSet` / `urlSet` (url kept as "" so the current screen
 * still renders).
 */
export function brainView(
  brain: { enabled: boolean; url: string; secret?: string; secretUnreadable?: true },
  isAdmin: boolean,
) {
  return {
    enabled: brain.enabled,
    url: isAdmin ? brain.url : "",
    urlSet: Boolean(brain.url),
    // E1: a stored-but-unreadable secret is still "set" (it IS stored; the
    // admins were alerted). Its value is never shown, not even to an admin.
    secretSet: Boolean(brain.secret) || brain.secretUnreadable === true,
    ...(isAdmin && brain.secret ? { secret: brain.secret } : {}),
  };
}
