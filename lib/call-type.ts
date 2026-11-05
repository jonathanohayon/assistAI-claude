// Call type from its summary + transcript (shared by the Sheet call log in
// /api/calls/end and the owner's daily digest). Keyword heuristic, moved
// verbatim from /api/calls/end.

export type CallType = "Annulation" | "Modification" | "Message" | "RDV" | "Info";

export const inferCallType = (summary: string, transcript: string[]): CallType => {
  const all = (summary + " " + transcript.join(" ")).toLowerCase();
  if (/annul|cancel/.test(all)) return "Annulation";
  if (/déplac|report|reschedule|chang.*heure|chang.*date/.test(all))
    return "Modification";
  if (/take_message|laisse.*message|transmettre|rappelle/.test(all))
    return "Message";
  if (/réserv|book_appointment|rendez-vous|RDV/i.test(all)) return "RDV";
  return "Info";
};
