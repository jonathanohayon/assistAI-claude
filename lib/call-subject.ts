/**
 * Dérive un "sujet" stable pour un appel à partir de son résumé (et, à défaut,
 * de son transcript). Valeurs renvoyées = enum stable, indépendant de la langue,
 * pour que le consommateur de l'API puisse filtrer par sujet de façon fiable :
 *
 *   "appointment" | "cancellation" | "reschedule" | "message" | "info" | "other"
 *
 * Heuristique mots-clés FR/HE/EN (le résumé est dans la langue du tenant). Si
 * un jour on stocke un sujet extrait par LLM, le contrat de l'API ne change pas
 * (toujours un champ `subject: string`).
 */
export type CallSubject =
  | "appointment"
  | "cancellation"
  | "reschedule"
  | "message"
  | "info"
  | "other";

export const CALL_SUBJECTS: CallSubject[] = [
  "appointment",
  "cancellation",
  "reschedule",
  "message",
  "info",
  "other",
];

export function deriveSubject(
  summary: string,
  transcript?: Array<{ text: string }>,
): CallSubject {
  const hay = `${summary} ${(transcript ?? []).map((t) => t.text).join(" ")}`
    .toLowerCase();

  // Annulation
  if (/\bannul|cancel|ביטול|לבטל/.test(hay)) return "cancellation";
  // Report / modification d'horaire
  if (/déplac|report|reschedul|chang.*(heure|date|rendez)|לדחות|לשנות.*תור/.test(hay))
    return "reschedule";
  // Prise de RDV
  if (/rendez-?vous|\brdv\b|book|appointment|réserv|reserv|לקבוע.*תור|תור\b/.test(hay))
    return "appointment";
  // Message à transmettre / rappel
  if (/laisse.*message|transmettre|rappel|message|call.?back|להתקשר|הודעה/.test(hay))
    return "message";
  // Demande d'information
  if (/horaire|prix|tarif|info|question|adresse|מחיר|שעות|כתובת|מידע/.test(hay))
    return "info";

  return "other";
}

export function isCallSubject(v: string | null | undefined): v is CallSubject {
  return !!v && (CALL_SUBJECTS as string[]).includes(v);
}
