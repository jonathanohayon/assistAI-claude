// Connectors: the view types the dashboard renders (B1).
// CLIENT-SAFE: this module has zero imports on purpose, so a client component
// can import it without pulling server code (or a secret) into the bundle.
// A connector = one plugged-in agent with its own dedicated number. Zero
// connector rows = today's behaviour exactly (the account-level
// tools_config.clientAgent); that legacy setting is shown as a DERIVED card
// (id "legacy", derived: true) riding on the main number.

/** How the client's agent is used: Tamara leads the call, or only lends her voice. */
export type ConnectorMode = "lead" | "voice";

/**
 * The card's state pill. "unreachable" is computed in a later step (B7);
 * until then a card is "off" when disabled, else "online".
 */
export type ConnectorState = "online" | "off" | "unreachable" | "setup_incomplete";

export type ConnectorView = {
  /** The row's uuid, or "legacy" for the derived card. */
  id: string | "legacy";
  name: string;
  /** The connector's number in E.164, or null when it has none yet. */
  numberE164: string | null;
  /** The number's label (phone_numbers.label), when it has one. */
  numberLabel?: string;
  mode: ConnectorMode;
  enabled: boolean;
  /** True only for the legacy card derived from tools_config.clientAgent. */
  derived: boolean;
  state: ConnectorState;
  setupIssue?: "no_secret" | "secret_unreadable" | "unsafe_url";
  /** ISO timestamp of the last call on this connector, or null. */
  lastCallAt: string | null;
  /** ISO timestamp of the last "Test" run, or null. */
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  /** Whether a secret is stored. The secret itself is NEVER sent. */
  secretSet: boolean;
  /**
   * C1b: whether the card may be deleted (server-side rule,
   * lib/connectors/deletable.ts). The first connector is not while the
   * product is active; the derived legacy card never is.
   */
  deletable: boolean;
};

/** C1b: a monthly price in the account's currency. */
export type ConnectorPrice = { monthly: number; currency: "EUR" | "ILS" };

export type CanAddConnectorReason = "trial_limit" | "max_reached" | "orders_closed";

export type ConnectorsPageView = {
  connectors: ConnectorView[];
  limits: {
    /** Connectors allowed on this account right now. */
    max: number;
    /** Connectors counted against max (the derived legacy card counts as 1). */
    used: number;
    inTrial: boolean;
  };
  canAdd: {
    ok: boolean;
    reason?: CanAddConnectorReason;
    /**
     * C1b: the price of the NEXT connector when it would be a paid extra
     * (paid account, >= 1 connector incl. the derived legacy card), else null
     * (trial, or the first one, included in the product). Display only.
     */
    price?: ConnectorPrice | null;
  };
};
