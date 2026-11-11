// Row written to campaign_calls by POST /api/agent/campaign-result.
// Pure (no DB) so the request → stored value mapping is testable.

import { getTableColumns } from "drizzle-orm";

import { callIdFromRequest } from "@/lib/call-id";
import type { CallOutcome } from "@/lib/campaigns/constants";
import { campaignCalls } from "@/lib/db/schema";

export interface CampaignCallInput {
  campaignId: string;
  contactId: string;
  userId: string;
  phoneNumber: string;
  outcome: CallOutcome;
  transcript: Array<{ role: "user" | "assistant"; text: string }>;
  durationSeconds: number;
}

/**
 * Insert values for one campaign call. `workerCallId` is the worker's call id
 * from the x-call-id header (validated by lib/call-id.ts), or null when the
 * header is absent or malformed.
 */
export function campaignCallRow(
  input: CampaignCallInput,
  req: { headers: { get(name: string): string | null } },
): CampaignCallInput & { workerCallId: string | null } {
  return { ...input, workerCallId: callIdFromRequest(req) };
}

// campaign_calls columns the dashboard returns (GET /api/dashboard/campaigns/[id]):
// every column except worker_call_id, an internal join key to tool events.
// Same columns, same order as a bare select() before that column existed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { workerCallId: _internal, ...publicColumns } = getTableColumns(campaignCalls);
export const campaignCallPublicColumns = publicColumns;
