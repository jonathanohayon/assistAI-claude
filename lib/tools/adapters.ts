// Today's settings → the Tools contract (T1). Pure.
//   receptionist: the CRM tile toggles (lib/tile-toggles.ts) for booking,
//     contacts and orders; transfer has no switch today (on whenever a
//     number is set) → enabled.
//   outbound: no switches and no tools today (until T4).
import type { PlanFeatures } from "@/lib/plan-features";
import type { TileToggles } from "@/lib/tile-toggles";
import { TOOLS_VERSION, type EffectiveCapabilities, type Tools } from "@/lib/tools/contract";

export function toolsFromTileToggles(t: TileToggles): Tools {
  return {
    version: TOOLS_VERSION,
    booking: { enabled: t.calendar, defaultDurationMinutes: null, minNoticeMinutes: null },
    contacts: { enabled: t.customers },
    transfer: { enabled: true, when: "always" },
    orders: { enabled: t.orders, ask: "" },
  };
}

export const OUTBOUND_TOOLS: Tools = {
  version: TOOLS_VERSION,
  booking: { enabled: false, defaultDurationMinutes: null, minNoticeMinutes: null },
  contacts: { enabled: false },
  transfer: { enabled: false, when: "always" },
  orders: { enabled: false, ask: "" },
};

// ── Capabilities → today's payload fields (the call side) ──────────────

/** Receptionist: `features` (plan map with calendar/crm overridden) + `ordersEnabled`. */
export function receptionistCallFields(caps: EffectiveCapabilities, plan: PlanFeatures) {
  return {
    features: { ...plan, calendar: caps.booking.active, crm: caps.contacts.active },
    ordersEnabled: caps.orders.active,
  };
}

/** Outbound: no calendar / CRM / WhatsApp on an outbound call (unchanged). */
export function outboundCallFeatures(caps: EffectiveCapabilities) {
  return {
    calendar: caps.booking.active,
    crm: caps.contacts.active,
    whatsapp_confirm: false,
    whatsapp_recap: false,
    outbound_campaigns: true,
  };
}
