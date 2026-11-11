// Site switch for tools on OUTBOUND calls (T4): env OUTBOUND_TOOLS =
//   unset / anything else = "off" (default): outbound agents get no tool —
//     today's behaviour, byte-identical payloads;
//   "admin": only accounts whose role is admin (their calls use the tools);
//   "all": every account.
// The agent's own per-capability switch (default off) must ALSO be on:
// effective = switch ∧ toggle ∧ plan ∧ prerequisite (effectiveCapabilities).
// Outbound tools need the worker part (T4c, held): turn this on only with it.
export type OutboundToolsMode = "off" | "admin" | "all";

export function outboundToolsMode(env: Record<string, string | undefined> = process.env): OutboundToolsMode {
  const v = (env.OUTBOUND_TOOLS ?? "").trim().toLowerCase();
  return v === "admin" || v === "all" ? v : "off";
}

/** Whether THIS account's outbound calls may use tools (and its screen shows them). */
export function outboundToolsEnabled(mode: OutboundToolsMode, accountIsAdmin: boolean): boolean {
  return mode === "all" || (mode === "admin" && accountIsAdmin);
}
