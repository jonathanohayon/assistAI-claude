// Technical tool names per capability (worker agent.ts registration), for
// the ADMIN's level-3 view only. Imported by the route only, never
// by tenant code — a tenant response or bundle never carries these names.
import type { CapabilityKey } from "@/lib/tools/contract";

export const TOOL_NAMES: Record<CapabilityKey, string[]> = {
  booking: [
    "list_available_dates",
    "check_availability",
    "book_appointment",
    "find_appointment",
    "cancel_appointment",
    "reschedule_appointment",
  ],
  contacts: ["save_contact"],
  // Registered on phone (PSTN) calls only.
  transfer: ["transfer_call"],
  orders: ["record_order"],
};
