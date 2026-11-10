// Reports a default-tenant fallback (A3, observation only): one error event
// per occurrence + one admin alert per origin per hour. Never throws.
import { alertAdmins } from "@/lib/alerts";
import { logEvent } from "@/lib/logger";
import { tenantFallbackReport, type TenantFallback } from "@/lib/tenant-resolution";

export async function reportTenantFallback(f: TenantFallback): Promise<void> {
  const r = tenantFallbackReport(f);
  try {
    await logEvent(r.event);
  } catch (e) {
    console.error("[tenant] fallback event failed:", (e as Error).message);
  }
  await alertAdmins(r.alert); // never throws
}
