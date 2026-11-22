// The sample source of a product preview (F2): a stand-in for `fetch` that
// answers the campaigns screen's READS from lib/preview-samples.ts, in
// memory. It never touches the network: no global fetch, no XHR, no socket.
// Any write (a method other than GET) is refused (403 "preview"), and so is
// any address it doesn't know; the screen's own buttons are disabled in
// preview anyway, this is the second lock.
//
// PURE and client-safe. scripts/tests/product-previews.test.ts drives every
// read the campaigns screen makes through it with global fetch stubbed.

import {
  previewCampaignContacts,
  previewCampaignResults,
  previewCampaigns,
  previewOutboundAgents,
  PREVIEW_CLIENT_AGENT,
  PREVIEW_NUMBER,
} from "./preview-samples";

export type PreviewAnswer = { status: number; body: unknown };

const REFUSED: PreviewAnswer = { status: 403, body: { error: "preview" } };

/** What the sample source answers for one request (pure). */
export function previewAnswer(lang: unknown, url: string, method = "GET"): PreviewAnswer {
  if (method.toUpperCase() !== "GET") return REFUSED;
  const path = new URL(url, "http://preview.invalid").pathname;
  const campaigns = previewCampaigns(lang);
  if (path === "/api/dashboard/campaigns") return { status: 200, body: { campaigns } };
  if (path === "/api/dashboard/channels") return { status: 200, body: { numbers: [{ phoneNumber: PREVIEW_NUMBER, channel: "pstn" }] } };
  if (path === "/api/dashboard/outbound-agents") return { status: 200, body: { agents: previewOutboundAgents(lang) } };
  const agent = /^\/api\/dashboard\/outbound-agents\/([^/]+)$/.exec(path);
  if (agent) {
    const a = previewOutboundAgents(lang).find((x) => x.id === agent[1]);
    return a ? { status: 200, body: { agent: a } } : { status: 404, body: { error: "not_found" } };
  }
  // The picked agent's capabilities (mission cards): the sample's.
  if (path === "/api/dashboard/tools") return { status: 200, body: PREVIEW_CLIENT_AGENT };
  const one = /^\/api\/dashboard\/campaigns\/([^/]+)(\/results)?$/.exec(path);
  if (one) {
    const c = campaigns.find((x) => x.id === one[1]);
    if (!c) return { status: 404, body: { error: "not_found" } };
    if (one[2]) return { status: 200, body: previewCampaignResults(lang, c.id) };
    const { stats, ...campaign } = c;
    return {
      status: 200,
      body: {
        campaign,
        contacts: previewCampaignContacts(lang, c.id),
        counts: { total: stats.total, queued: stats.queued, inFlight: stats.inFlight, done: stats.done, connected: stats.connected },
        agent: { knowledge: "" },
      },
    };
  }
  // The live console is admin-only: a tenant's preview gets what a tenant gets (nothing).
  return REFUSED;
}

/** A `fetch` look-alike over previewAnswer: in memory, never the network. */
export function previewFetcher(lang: unknown): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { status, body } = previewAnswer(lang, url, init?.method ?? "GET");
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
