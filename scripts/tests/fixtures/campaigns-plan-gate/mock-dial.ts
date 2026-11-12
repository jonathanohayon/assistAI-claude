// Test double for @/lib/campaigns/dial: dialContact records the attempt in
// globalThis.__campgateDials and returns; nothing reaches LiveKit or Twilio.
export * from "../../../../lib/campaigns/dial";
import type { DialResult } from "../../../../lib/campaigns/dial";

const g = globalThis as { __campgateDials?: Array<Record<string, unknown>> };
export async function dialContact(opts: {
  phoneNumber: string;
  fromNumber?: string;
  roomName: string;
  campaignId: string;
  contactId: string;
  userId: string;
}): Promise<DialResult> {
  (g.__campgateDials ??= []).push({ ...opts });
  return { roomName: opts.roomName, participantId: "PA_mock" };
}
export async function dialCallMe(): Promise<never> {
  throw new Error("dialCallMe is not available in tests");
}
