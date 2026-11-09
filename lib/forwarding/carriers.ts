// Israeli carriers' call-forwarding codes for the forwarding wizard.
// RULE (PM, 2026-11-05): only codes quoted on the carrier's OWN official page
// ship here, with that page's URL in `source`. No official source → codes are
// null and the wizard says "contact your carrier". Never fill a gap with
// generic GSM knowledge.

export const CARRIER_IDS = ["partner", "cellcom", "pelephone", "hot_mobile", "bezeq", "other"] as const;
export type CarrierId = (typeof CARRIER_IDS)[number];

export interface CarrierForwarding {
  id: CarrierId;
  line: "mobile" | "landline" | "unknown";
  /** Activation code template; "{number}" is replaced by the target number. */
  activate: string | null;
  cancel: string | null;
  /** How the target number must be typed in the code. */
  numberFormat: "local" | "e164";
  /** Official page the codes are quoted from (required when activate is set). */
  source: string | null;
}

export const CARRIERS: Record<CarrierId, CarrierForwarding> = {
  // Source (verified in a browser 2026-11-09), "הפניית כל השיחות (עקוב אחרי)":
  // "הפעלת השירות: * > 21 > * > (יעד נבחר) > # > מקש החיוג",
  // "ביטול השירות: # > 21 > # > מקש החיוג". Same page also lists busy *67*,
  // unreachable *62*, no answer *61*…**<seconds>#. Kosher lines can only
  // forward to kosher numbers.
  partner: {
    id: "partner",
    line: "mobile",
    activate: "*21*{number}#",
    cancel: "#21#",
    numberFormat: "local",
    source: "https://www.partner.co.il/n/partnerdigital/gsm_abbreviations",
  },
  // Source (verified in a browser 2026-11-09), "להפניית כל השיחות … יש לחייג:
  // **21*<number>#", "לביטול חייגו: ##21#" (the page renders the code RTL-
  // reversed as "031234567#*21**"). Also busy **67*, no answer **61*,
  // unreachable **62*. GSM/UMTS subscribers only.
  cellcom: {
    id: "cellcom",
    line: "mobile",
    activate: "**21*{number}#",
    cancel: "##21#",
    numberFormat: "local",
    source: "https://cellcom.co.il/production/Private/Cellular/Cellular_upgrades/follow_me/",
  },
  // Source quote: "הקישו * > 21 > * > מספר היעד כולל קידומת (לדוגמה: 0507999888) > # > SEND"
  // and to cancel "הקישו # > 21 > # > SEND". Forwarding abroad is not possible.
  pelephone: {
    id: "pelephone",
    line: "mobile",
    activate: "*21*{number}#",
    cancel: "#21#",
    numberFormat: "local",
    source: "https://www.pelephone.co.il/ds/heb/support/call-referral/",
  },
  // hotmobile.co.il only names the service ("עקוב אחריי — העברת שיחות",
  // billed as airtime) without codes; re-checked in a browser 2026-11-09,
  // still no official page with codes. → contact your carrier.
  hot_mobile: { id: "hot_mobile", line: "mobile", activate: null, cancel: null, numberFormat: "local", source: null },
  // Source: dial *72, then "הקש את המספר שאליו אתה מעוניין להפנות את השיחות",
  // wait for the recorded confirmation; cancel "חייג #72 והמתן לקבלת צליל אישור".
  // The forwarding call is billed to the line as a normal Bezeq call.
  bezeq: {
    id: "bezeq",
    line: "landline",
    activate: "*72{number}",
    cancel: "#72",
    numberFormat: "local",
    source: "https://www.bezeq.co.il/internetandphone/phone/service_on_phoneline/stars/",
  },
  other: { id: "other", line: "unknown", activate: null, cancel: null, numberFormat: "local", source: null },
};

/** The target number as the carrier expects it inside the code. */
export function targetDigits(e164: string, format: CarrierForwarding["numberFormat"]): string {
  if (format === "e164") return e164;
  const m = /^\+972(\d{8,9})$/.exec(e164);
  return m ? `0${m[1]}` : e164;
}

/** Activation code for this carrier and tenant number, or null (contact your carrier). */
export function activationCode(c: CarrierForwarding, tenantE164: string): string | null {
  if (!c.activate || !c.source) return null;
  return c.activate.replace("{number}", targetDigits(tenantE164, c.numberFormat));
}

/** Cancel code, only when sourced. */
export function cancelCode(c: CarrierForwarding): string | null {
  return c.cancel && c.source ? c.cancel : null;
}
