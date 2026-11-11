// A call's outcome against its mission, from the TOOL EVENTS only (the
// agent-reliability rule: what the tools did beats what the words say). Pure.
import { callTypeFromEvents, type CallToolEvent } from "@/lib/call-type";
import type { Mission, MissionOutcome } from "@/lib/mission/contract";

export function missionOutcome(mission: Mission, events: CallToolEvent[]): MissionOutcome {
  // Outbound (M2a): every sales mission has its proof in SALES_MISSION_TABLE
  // (lead sheet, booking, transfer / callback, or "estimated"), but measuring
  // it by the tools is M4b — today's campaign analysis stays.
  if (mission.recipe === "outbound") return { status: "not_measured" };
  if (mission.recipe === "receptionist" && mission.kind === "inform_and_book") {
    // Same deterministic reading as the call type (lib/call-type.ts).
    const t = callTypeFromEvents(events);
    if (t === "RDV" || t === "Modification" || t === "Annulation") {
      const by = t === "RDV" ? "book_success" : t === "Modification" ? "reschedule_success" : "cancel_success";
      return { status: "achieved", by };
    }
    return { status: "not_achieved" };
  }
  // take_messages: the message lives in the post-call summary (model text),
  // not in a tool → not measurable by tools yet. Outbound agents have no
  // tool until T4: today's campaign analysis stays (M4 revisits it).
  return { status: "not_measured" };
}
