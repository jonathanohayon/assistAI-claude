// Which product a call is billed against (calls.product, migration 0056).
// PURE (client-safe, zero imports beyond types).
//
// What /api/calls/end can know TODAY, without a worker change (worker
// origin/main, 2026-11-22):
//   - the body: fromNumber, toNumber, userId, channel (pstn | whatsapp),
//     transcript, durationSeconds, realtimeProvider/Model, callId. Nothing
//     says who answered (Tamara alone, or Tamara asking the client's agent).
//   - the call's events (stamped with the hashed room name): call_started
//     carries origin.kind sip | web | unknown, and config_loaded {model,
//     voice}. A tamaravox call is origin "sip" like any phone call; the
//     client-agent tool (ask_client_agent) exists only on an unmerged worker
//     branch. No event marks a connect call.
//   - campaign calls never reach calls/end (they go to campaign_calls), so
//     "sales" never comes from here.
// So today every call is NULL (= reception). This is the hook for the day
// the worker reports the fact: `clientAgent: true` in the calls/end body
// when the session ran with the client's agent (the served `clientAgent`
// key enabled, i.e. the ask_client_agent tool registered). calls/end does
// NOT parse that field yet: it passes `{ channel }` only.

import type { ProductEntry } from "./product-values";

export type CallProduct = ProductEntry;
export const CALL_PRODUCTS: readonly CallProduct[] = ["reception", "sales", "connect"] as const;

export type CallProductInput = {
  channel: "pstn" | "whatsapp";
  /** Not sent by the worker yet. true = the client's agent took part. */
  clientAgent?: unknown;
};

/** The calls.product value: "connect" for a client-agent call, else null (= reception). */
export function productForCall(input: CallProductInput): CallProduct | null {
  if (input.clientAgent === true) return "connect";
  return null;
}
