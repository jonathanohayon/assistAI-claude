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
  | { ok: false; status: 400; body: { error: "unsafe_url"; message: string } };

export async function agentBrainSaveDecision(args: {
  /** The stored url ("" = none). */
  currentUrl: string;
  /** The url in the PUT body, trimmed ("" = none). */
  url: string;
  wantsEnabled: boolean;
  isAdmin: boolean;
  check?: CheckOptions;
}): Promise<BrainSaveDecision> {
  const changed = args.url !== args.currentUrl.trim();
  if (changed && !args.isAdmin) return { ok: false, status: 403, body: { error: "admin_only", fields: ["url"] } };
  // A url being saved, or a webhook being turned on, must be safe. Turning it
  // off (or clearing the url) always passes.
  if ((changed && args.url) || args.wantsEnabled) {
    const r = await checkAgentUrl(args.url, args.check);
    if (!r.ok) return { ok: false, status: 400, body: { error: "unsafe_url", message: SAFE_URL_MESSAGE } };
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
