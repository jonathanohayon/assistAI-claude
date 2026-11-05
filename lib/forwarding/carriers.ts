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
  // No official partner.co.il page with mobile forwarding codes found
  // (2026-11-05). The *74 in partner's AudioCodes office-box PDF is NOT a
  // mobile code. → contact your carrier.
  partner: { id: "partner", line: "mobile", activate: null, cancel: null, numberFormat: "local", source: null },
  // Candidate (UNVERIFIED, from search snippets of
  // https://business.cellcom.co.il/support/cellular/services/item1/Follow_Me_s/120 ):
  // "**21*<number>#" / "##21#". The page could not be read directly; a human
  // must confirm it in a browser before it ships here.
  cellcom: { id: "cellcom", line: "mobile", activate: null, cancel: null, numberFormat: "local", source: null },
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
  // billed as airtime) without codes. → contact your carrier.
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
