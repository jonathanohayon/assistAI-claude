// TEST FIXTURES ONLY: typed mock pages for the connectors list (C1), one per
// state, until GET /api/dashboard/connectors is on main. Fictional numbers
// (+972 50-000-000x, +33 1 99 00 00 0x), no secret, no real account.
// NEVER imported by live code: scripts/tests/connectors-list.test.ts fails if
// any file under app/, components/ or lib/ (other than this one) imports it.

import type { ConnectorExtraPrice } from "./list-view";
import type { ConnectorsPageView, ConnectorView } from "./types";

/** A fixed "now" so relative dates are stable in tests and captures. */
export const MOCK_NOW = "2026-11-24T12:00:00.000Z";

/**
 * Stand-in for the catalogue's extra-connector price (VP grid: +19 € / +79 ₪),
 * which the catalogue does not carry yet. Fixture data, never a live default.
 */
export const MOCK_EXTRA_PRICE: Record<"EUR" | "ILS", ConnectorExtraPrice> = {
  EUR: { monthly: 19, currency: "EUR" },
  ILS: { monthly: 79, currency: "ILS" },
};

const base = {
  numberLabel: undefined,
  derived: false,
  lastTestAt: null,
  lastTestOk: null,
  secretSet: true,
  // Set per page by `page()` below, by the server's ONE rule (#444).
  deletable: false,
} as const;

export const MOCK_LEGACY: ConnectorView = {
  ...base,
  id: "legacy",
  // The server sends "" for the derived card: the FE shows its localized name.
  name: "",
  numberE164: null,
  mode: "lead",
  enabled: true,
  derived: true,
  state: "online",
  lastCallAt: "2026-11-24T09:30:00.000Z",
};

export const MOCK_ONLINE: ConnectorView = {
  ...base,
  id: "00000000-0000-4000-8000-000000000001",
  name: "Agent ventes",
  numberE164: "+972500000001",
  mode: "lead",
  enabled: true,
  state: "online",
  lastCallAt: "2026-11-24T10:00:00.000Z",
  lastTestAt: "2026-11-23T08:00:00.000Z",
  lastTestOk: true,
};

export const MOCK_OFF: ConnectorView = {
  ...base,
  id: "00000000-0000-4000-8000-000000000002",
  name: "Support FR",
  numberE164: "+33199000002",
  numberLabel: "Paris",
  mode: "voice",
  enabled: false,
  state: "off",
  lastCallAt: null,
};

export const MOCK_UNREACHABLE: ConnectorView = {
  ...base,
  id: "00000000-0000-4000-8000-000000000003",
  name: "Prise de RDV",
  numberE164: "+972500000003",
  mode: "voice",
  enabled: true,
  state: "unreachable",
  lastCallAt: "2026-11-20T16:45:00.000Z",
  lastTestAt: "2026-11-24T11:00:00.000Z",
  lastTestOk: false,
};

/** A real connector whose number is not bought yet. */
export const MOCK_NO_NUMBER: ConnectorView = {
  ...base,
  id: "00000000-0000-4000-8000-000000000004",
  name: "Agent sans numéro",
  numberE164: null,
  mode: "lead",
  enabled: false,
  state: "off",
  lastCallAt: null,
  secretSet: false,
};

const page = (
  connectors: ConnectorView[],
  limits: ConnectorsPageView["limits"],
  canAdd: ConnectorsPageView["canAdd"],
): ConnectorsPageView => ({ connectors: withServerDeletable(connectors), limits, canAdd });

/**
 * The server's rule (#444, lib/connectors): the derived legacy card is never
 * deletable; the FIRST connector (the legacy card when there is one, else the
 * oldest row) isn't while the product is active (every mock page is); the
 * others are. The mock mirrors it so fixtures look like real GET answers.
 */
function withServerDeletable(connectors: ConnectorView[]): ConnectorView[] {
  const hasLegacy = connectors.some((c) => c.derived);
  return connectors.map((c, i) => ({ ...c, deletable: !c.derived && (hasLegacy || i > 0) }));
}

/** Every state the list can be in. limits.used counts the derived card. */
export const MOCK_PAGES = {
  emptyTrial: page([], { max: 1, used: 0, inTrial: true }, { ok: true }),
  emptyPaid: page([], { max: 5, used: 0, inTrial: false }, { ok: true }),
  // Paid, 0 connectors, PRODUCT_ORDERS off: the FIRST connector is included,
  // so the BE still says ok (lib/connectors/entitlement.ts: count >= 1 only).
  emptyPaidOrdersOff: page([], { max: 5, used: 0, inTrial: false }, { ok: true }),
  derivedTrial: page([MOCK_LEGACY], { max: 1, used: 1, inTrial: true }, { ok: false, reason: "trial_limit" }),
  derivedPaid: page([MOCK_LEGACY], { max: 5, used: 1, inTrial: false }, { ok: true }),
  derivedPaidOrdersOff: page([MOCK_LEGACY], { max: 5, used: 1, inTrial: false }, { ok: false, reason: "orders_closed" }),
  threePaid: page([MOCK_ONLINE, MOCK_OFF, MOCK_UNREACHABLE], { max: 5, used: 3, inTrial: false }, { ok: true }),
  threeClosed: page([MOCK_ONLINE, MOCK_OFF, MOCK_UNREACHABLE], { max: 5, used: 3, inTrial: false }, { ok: false, reason: "orders_closed" }),
  oneTrialLocked: page([MOCK_ONLINE], { max: 1, used: 1, inTrial: true }, { ok: false, reason: "trial_limit" }),
  maxReached: page(
    [MOCK_ONLINE, MOCK_OFF, MOCK_UNREACHABLE, MOCK_NO_NUMBER, { ...MOCK_ONLINE, id: "00000000-0000-4000-8000-000000000005", name: "Agent 5", numberE164: "+972500000005" }],
    { max: 5, used: 5, inTrial: false },
    { ok: false, reason: "max_reached" },
  ),
} satisfies Record<string, ConnectorsPageView>;

export type MockPageName = keyof typeof MOCK_PAGES;
