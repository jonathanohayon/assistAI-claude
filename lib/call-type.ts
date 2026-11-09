// Call type from its summary + transcript (shared by the Sheet call log in
// /api/calls/end and the owner's daily digest). Keyword heuristic in
// FR / HE / EN — summaries are written in the tenant's language, so a
// French-only list missed most Hebrew and English calls.
//
// Order matters: cancel > reschedule > message > booking > info (a
// cancellation call usually also mentions the appointment).
//
// Hebrew has no \b (JS word boundaries are ASCII-only) and glues
// prefixes (ל/ב/ה/ו/ש) to words, so Hebrew patterns are stems or
// multi-word phrases chosen not to occur inside unrelated words.

export type CallType = "Annulation" | "Modification" | "Message" | "RDV" | "Info";

const CANCEL = [
  /annul/, // fr
  /\bcancel/, // en (also cancel_appointment)
  /ביטול|לבטל|ביטלה|ביטל|מבטל/, // he
];

const RESCHEDULE = [
  /déplac|report|chang.*heure|chang.*date/, // fr
  /reschedul|postpone|\bmove (my|the|her|his|their) appointment|change (the|my|her|his|their) (time|date|appointment)/, // en
  /להזיז|הזזת|הזיז|לדחות|דחיית|נדחה|להקדים|שינוי מועד|לשנות את (התור|השעה|המועד)/, // he
];

const MESSAGE = [
  /take_message|laisse.*message|transmettre|rappelle/, // fr
  /\bleave (a|me a) message|\b(left|took|take) a message|call (me|him|her|them) back|\bcallback\b|\bpass (it|this) on/, // en
  /הודעה|שיחזרו|יחזרו אלי|לחזור אלי|תחזרו אלי|שיחזור אלי|שתחזור אלי/, // he
];

const BOOKING = [
  /réserv|book_appointment|rendez-vous|rdv/, // fr (lower-cased input)
  /\bbook(ed|ing)?\b|\bappointment/, // en
  /לקבוע|קביעת|נקבע|קבעתי|קבענו|תור חדש|זימון תור/, // he
];

const any = (patterns: RegExp[], text: string) => patterns.some((p) => p.test(text));

export const inferCallType = (summary: string, transcript: string[]): CallType => {
  const all = (summary + " " + transcript.join(" ")).toLowerCase();
  if (any(CANCEL, all)) return "Annulation";
  if (any(RESCHEDULE, all)) return "Modification";
  if (any(MESSAGE, all)) return "Message";
  if (any(BOOKING, all)) return "RDV";
  return "Info";
};
