// Site switch for "Ask your agent" (T5): env CLIENT_AGENT =
//   unset / anything else = "off" (default): turning the tool on is refused,
//     the screen hides it, and no call payload changes — byte-identical;
//   "admin": only accounts whose OWNER has role admin;
//   "all": every account.
// Same shape as OUTBOUND_TOOLS (lib/tools/outbound-switch.ts) and CALL_ME.
// The worker part (T5c, held) reads the served `clientAgent` key: turn this
// on only with it.
export type ClientAgentSwitch = "off" | "admin" | "all";

export function clientAgentMode(env: Record<string, string | undefined> = process.env): ClientAgentSwitch {
  const v = (env.CLIENT_AGENT ?? "").trim().toLowerCase();
  return v === "admin" || v === "all" ? v : "off";
}

/** Whether THIS account may use the client agent (and its screen shows it). */
export function clientAgentEnabled(mode: ClientAgentSwitch, accountIsAdmin: boolean): boolean {
  return mode === "all" || (mode === "admin" && accountIsAdmin);
}
