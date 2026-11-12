// Signs the live-test room token — SERVER-ONLY. Moved verbatim from the route
// (same identity, room name, metadata, grants, TTL and agent dispatch); the
// credentials are passed in, so tests sign with dummy keys.
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";

import type { LiveTestTokenResponse } from "@/lib/live-test/handler";

/**
 * Name of the agent registered by the worker (`config.ts:AGENT_NAME` in the
 * worker repo). Web rooms have no SIP dispatch rule, so the token forces the
 * dispatch through roomConfig.agents.
 */
export const WORKER_AGENT_NAME = "appointment-agent";

export async function mintLiveTestToken(
  creds: { url: string; apiKey: string; apiSecret: string },
  input: { userId: string; email: string | null; testAgentId: string | null },
): Promise<LiveTestTokenResponse> {
  const { userId, email, testAgentId } = input;
  // The worker reads participant.metadata to resolve the tenant (or the tested
  // outbound agent, routed to /api/agent/outbound-test-config).
  const sessionMeta = testAgentId
    ? JSON.stringify({ source: "outbound_test", agentId: testAgentId, userId })
    : JSON.stringify({ source: "web", userId });
  // One room per test session: no collision across tabs or devices.
  const roomName = `livetest-${userId}-${Date.now().toString(36)}`;
  const identity = `web-${userId}-${Math.random().toString(36).slice(2, 8)}`;

  const at = new AccessToken(creds.apiKey, creds.apiSecret, {
    identity,
    name: email ?? identity,
    metadata: sessionMeta,
    ttl: 15 * 60, // 15 minutes: plenty for a live test
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: WORKER_AGENT_NAME, metadata: sessionMeta })],
  });

  const token = await at.toJwt();
  return { url: creds.url, token, roomName, identity };
}
