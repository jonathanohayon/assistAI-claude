// Site switch for connector WRITES (B4): env CONNECTORS_WRITE =
//   unset / anything else = "off" (default): every write route answers
//     404 { error: "connectors_write_off" } and writes nothing; the GET is
//     unchanged;
//   "admin": only a signed-in ADMIN session may write (on its own account or
//     on a tenant's via ?asUserId), requireAdmin semantics;
//   "on": every account.
// Same shape as CLIENT_AGENT (lib/tools/client-agent-switch.ts). Zero imports.
export type ConnectorsWriteSwitch = "off" | "admin" | "on";

export function connectorsWriteMode(env: Record<string, string | undefined> = process.env): ConnectorsWriteSwitch {
  const v = (env.CONNECTORS_WRITE ?? "").trim().toLowerCase();
  return v === "admin" || v === "on" ? v : "off";
}

/** Whether a write is allowed for this SESSION (admin = the signed-in user is an admin). */
export function connectorsWriteAllowed(mode: ConnectorsWriteSwitch, sessionIsAdmin: boolean): boolean {
  return mode === "on" || (mode === "admin" && sessionIsAdmin);
}

/** The stable refusal when the switch is closed for this session. */
export const CONNECTORS_WRITE_OFF = { status: 404, body: { error: "connectors_write_off" } } as const;
