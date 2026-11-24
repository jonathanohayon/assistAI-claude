// The requests behind the connectors list's live actions (C1b). Client-safe.
// Every one is an EXISTING route; nothing here is new on the server:
//   toggle  → PUT  /api/dashboard/tools (the brick's own save request, only the switch)
//   test    → POST /api/dashboard/tools/client-agent/test (stored address + secret)
//   refresh → GET  /api/dashboard/connectors (after the editor saved)
// `asUserId` (the admin tenant view) goes on EVERY request. `fetchImpl` is
// injected so the tests can record what is sent.

import {
  clientAgentSavedAnswer,
  clientAgentSaveRefusal,
  clientAgentStoredTestRequest,
  clientAgentSwitchRequest,
  clientAgentTestWords,
  type ClientAgentRefusal,
  type TestWords,
  type ToolsResponse,
} from "@/components/bricks/tools/tools-ui";
import type { ConnectorsPageView } from "@/lib/connectors/types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * `generated`: the secret the server made when this save switched the agent
 * on without one (#437, `generatedSecret`, once), read exactly as the brick
 * reads it (clientAgentSavedAnswer); null otherwise.
 */
export type ToggleResult = { ok: true; generated: string | null } | { ok: false; refused: ClientAgentRefusal | null };

const qs = (asUserId: string | null | undefined) => (asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "");

export function connectorActions(fetchImpl: FetchLike, asUserId: string | null = null) {
  return {
    async toggle(enabled: boolean): Promise<ToggleResult> {
      const req = clientAgentSwitchRequest(enabled, asUserId);
      try {
        const res = await fetchImpl(req.url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: req.body });
        const data = (await res.json().catch(() => null)) as ToolsResponse | null;
        if (!res.ok || !data?.tools) return { ok: false, refused: clientAgentSaveRefusal(res.status, data) };
        return { ok: true, generated: clientAgentSavedAnswer(data).generated };
      } catch {
        return { ok: false, refused: null };
      }
    },
    async test(): Promise<TestWords> {
      const req = clientAgentStoredTestRequest(asUserId);
      try {
        const res = await fetchImpl(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: req.body });
        return clientAgentTestWords(res.status, await res.json().catch(() => null));
      } catch {
        return { key: "generic" };
      }
    },
    async refresh(): Promise<ConnectorsPageView | null> {
      try {
        const res = await fetchImpl(`/api/dashboard/connectors${qs(asUserId)}`, { cache: "no-store" });
        return res.ok ? ((await res.json()) as ConnectorsPageView) : null;
      } catch {
        return null;
      }
    },
  };
}
