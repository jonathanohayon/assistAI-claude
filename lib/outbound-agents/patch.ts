// PATCH /api/dashboard/outbound-agents/[id]: the raw parsed body → the
// columns to store. Moved out of the route handler (M2a) so the gate tests
// feed the SAME function the handler runs. Pure (no DB).

import { agentMissionUpdates, type MissionWriteError } from "@/lib/mission/store";
import { outboundPersonaAfterLegacy, outboundPersonaUpdates } from "@/lib/persona/store";
import type { OutboundAgent } from "@/lib/db/schema";
import { outboundVoiceConfigAfterLegacy, outboundVoiceConfigUpdates } from "@/lib/voice/route-writes";
import { normalizeAgentFields } from "@/lib/outbound-agents/validate";

export type AgentPatchError = { status: number; body: unknown };

export function planOutboundAgentPatch(
  body: Record<string, unknown>,
  agent: OutboundAgent,
  isAdmin: boolean,
): { error: AgentPatchError | MissionWriteError } | { set: Record<string, unknown> } {
  // `voiceConfig` / `personaConfig` / `mission` are not legacy agent columns
  // for normalizeAgentFields: keep them out.
  const { voiceConfig: _vc, personaConfig: _pc, mission: _m, ...legacyBody } = body;
  void [_vc, _pc, _m];
  const fields = normalizeAgentFields({ ...agent, ...legacyBody });

  // Voice contract (V5, write-alongside), same rules as the receptionist.
  const voiceWrite = outboundVoiceConfigUpdates(body, agent, isAdmin);
  if (voiceWrite && "error" in voiceWrite) return { error: voiceWrite.error };
  const voiceFields = voiceWrite ? voiceWrite.updates : { voiceConfig: outboundVoiceConfigAfterLegacy(agent, fields) };
  // Persona contract (P3, write-alongside), same rules as the receptionist.
  const personaWrite = outboundPersonaUpdates(body, agent, isAdmin);
  if (personaWrite && "error" in personaWrite) return { error: personaWrite.error };
  const personaFields = personaWrite
    ? personaWrite.updates
    : { personaConfig: outboundPersonaAfterLegacy(agent, fields) };
  // Mission (M2a): absent = the stored value is kept (no key written).
  const missionWrite = agentMissionUpdates(body);
  if (missionWrite && "error" in missionWrite) return { error: missionWrite.error };
  const missionFields = missionWrite ? missionWrite.updates : {};

  return { set: { ...fields, ...voiceFields, ...personaFields, ...missionFields } };
}
