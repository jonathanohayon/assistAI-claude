// The single route's ?origin= parameters → a call origin (A3). Pure.
import type { CallOrigin } from "@/lib/agent/contract";

export type OriginParse = { ok: true; origin: CallOrigin } | { ok: false; error: string };

export function originFromParams(p: URLSearchParams): OriginParse {
  const kind = p.get("origin") ?? "";
  const need = (...names: string[]) => names.every((n) => (p.get(n) ?? "").length > 0);
  switch (kind) {
    case "phone":
      // userId would take priority in the inbound handler: refuse the mix.
      if (!need("phone") || p.has("userId")) return { ok: false, error: "bad_origin_params" };
      return { ok: true, origin: { kind: "phone", calledNumber: p.get("phone")! } };
    case "web":
    case "call_me":
      if (!need("userId") || p.has("phone")) return { ok: false, error: "bad_origin_params" };
      return { ok: true, origin: { kind, userId: p.get("userId")! } };
    case "campaign":
      if (!need("campaignId", "contactId")) return { ok: false, error: "bad_origin_params" };
      return { ok: true, origin: { kind: "campaign", campaignId: p.get("campaignId")!, contactId: p.get("contactId")! } };
    case "outbound_test":
      if (!need("agentId")) return { ok: false, error: "bad_origin_params" };
      return { ok: true, origin: { kind: "outbound_test", agentId: p.get("agentId")! } };
    case "vox":
      return { ok: false, error: "external_origin" };
    default:
      return { ok: false, error: "unknown_origin" };
  }
}
