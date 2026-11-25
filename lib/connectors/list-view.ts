// The connectors LIST (C1): ONE pure decision from the page the server sends
// (ConnectorsPageView, lib/connectors/types.ts) to what each card and the
// "+ Ajouter un agent" card show. Pure and client-safe: type imports only, no
// env var, no database, no amount of its own (the extra-connector price is an
// INPUT, read from the catalogue by the caller).
// scripts/tests/connectors-list.test.ts pins the whole table.
//
//   empty  = no connector at all: ONE large card "Branchez votre premier
//            agent" (never an empty page). It opens the wizard when the
//            account may add one; otherwise it carries the same lock as the
//            add card (trial_limit / max_reached / orders_closed).
//            Its offer line: in a trial "Inclus dans votre essai"; paid, the
//            base offer from the catalogue "{price}/mois, numéro et
//            {minutes} minutes inclus" (basePrice INPUT; null → no line).
//   list   = one card per connector, in the server's order (oldest first),
//            then the add card LAST.
//
// A card:
//   number    = the connector's own number (large, copyable), or null;
//   numberLine= "main"  the derived legacy card: "Répond sur votre numéro
//                       principal" instead of a number;
//               "own"   its own number is shown;
//               "none"  a real connector whose number is not bought yet;
//   pill      = exactly one of online / off / unreachable / setup_incomplete,
//               or "unknown" for a state this build does not know (a newer
//               server): a neutral pill. unreachable adds the line "Tamara
//               répond seule en attendant." (red); setup_incomplete adds ONE
//               amber line picked by setupIssue (no_secret / secret_unreadable
//               / unsafe_url), the generic "Ouvrez « Modifier »…" for any
//               other or missing issue; "unknown" adds the generic line too;
//   derived   = the legacy card, on OR off (B7 sends it switched off too): it
//               is a normal card either way, never the empty state;
//   deletable = the "…" menu with "Supprimer" exists. Never for the derived
//               card. Read from ConnectorView.deletable (the server's one
//               rule, #444): never the first connector while the product
//               is active (only its switch).
// The add card:
//   add       = price line "+ {price} par agent, numéro inclus" (amount from
//               the catalogue; without an amount, no price line);
//   trial     = greyed, "1 agent pendant l'essai. Activez votre offre…";
//   max       = greyed, a plain line with the max;
//   soon      = "Bientôt" (the sidebar's word): orders are not open yet.
// The BE's canAdd is the source of truth for WHETHER adding is allowed; this
// view only picks the words. canAdd.ok → always "add", never "Bientôt" (a
// paid account's FIRST connector is included, so the BE says ok for it even
// with PRODUCT_ORDERS off: lib/connectors/entitlement.ts, count >= 1 only).

import type { CatalogueCurrency, ProductCatalogue } from "../product-catalogue";
import type { CanAddConnectorReason, ConnectorMode, ConnectorState, ConnectorsPageView, ConnectorView } from "./types";

/** The card's pill: a known state, or "unknown" for a value this build does not know. */
export type CardPill = ConnectorState | "unknown";

/** The issues the server names (ConnectorView.setupIssue). */
export type SetupIssue = NonNullable<ConnectorView["setupIssue"]>;

/** The line under an amber (or neutral) pill: a named issue, or the generic one. */
export type SetupLine = SetupIssue | "generic";

// `satisfies Record<Union, true>`: tsc fails when a value is added to the
// union and not here (or listed here and not in the union). The runtime
// lookup then maps anything else (a newer server's value) to the fallback.
const KNOWN_STATES = { online: true, off: true, unreachable: true, setup_incomplete: true } satisfies Record<ConnectorState, true>;
const KNOWN_ISSUES = { no_secret: true, secret_unreadable: true, unsafe_url: true } satisfies Record<SetupIssue, true>;

const has = (table: object, key: unknown): boolean => typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key);

/** A state as the card draws it: the known ones as is, anything else "unknown" (never a crash). */
export function cardPillOf(state: unknown): CardPill {
  return has(KNOWN_STATES, state) ? (state as ConnectorState) : "unknown";
}

/** The amber line for a setup issue: a named issue, else (other value, missing) the generic line. */
export function setupLineOf(issue: unknown): SetupLine {
  return has(KNOWN_ISSUES, issue) ? (issue as SetupIssue) : "generic";
}

/** The line under the pill, per pill. A switch: tsc fails here on a new state. */
function setupLineFor(pill: CardPill, issue: unknown): SetupLine | null {
  switch (pill) {
    case "setup_incomplete":
      return setupLineOf(issue);
    case "unknown":
      return "generic";
    case "online":
    case "off":
    case "unreachable":
      return null;
    default: {
      const never: never = pill;
      return never;
    }
  }
}

/** The monthly price of ONE extra connector, as read from the catalogue. */
export type ConnectorExtraPrice = { monthly: number; currency: CatalogueCurrency };

/** The connect product's base offer (1 connector + its number + minutes), from the catalogue. */
export type ConnectorBasePrice = { monthly: number; currency: CatalogueCurrency; minutes: number };

/**
 * The base offer as the pricing screens read it (lib/pricing-grid.ts gridCard:
 * the catalogue row cat[product][currency], monthly + minutes).
 */
export function connectorBasePrice(cat: ProductCatalogue, currency: CatalogueCurrency): ConnectorBasePrice {
  const row = cat.connect[currency];
  return { monthly: row.monthly, currency, minutes: row.minutes };
}

export type ConnectorsListInput = {
  page: ConnectorsPageView;
  /** null = the catalogue has no amount to show: the add card shows no price. */
  extraPrice: ConnectorExtraPrice | null;
  /** The base offer for the empty card; null = no price line. Ignored in a trial. */
  basePrice: ConnectorBasePrice | null;
};

export type ConnectorCardView = {
  id: string;
  /** The connector's name; null = show the localized default (the server sends "" for the derived card). */
  name: string | null;
  derived: boolean;
  /** E.164, only when numberLine is "own". */
  number: string | null;
  numberLabel: string | null;
  numberLine: "own" | "main" | "none";
  pill: CardPill;
  /** "Tamara répond seule en attendant." under the red pill. */
  unreachableNote: boolean;
  /** The one line under an amber setup_incomplete (or neutral unknown) pill; null otherwise. */
  setupLine: SetupLine | null;
  mode: ConnectorMode;
  enabled: boolean;
  /** ISO timestamp, or null: "Aucun appel pour l'instant". */
  lastCallAt: string | null;
  /** The "…" menu (with "Supprimer") renders only when true. */
  deletable: boolean;
};

export type AddCardView =
  | { kind: "add"; price: ConnectorExtraPrice | null }
  | { kind: "trial"; max: number }
  | { kind: "max"; max: number }
  | { kind: "soon" };

/** The empty card's offer line. */
export type EmptyOfferView = { kind: "trial" } | { kind: "price"; price: ConnectorBasePrice } | null;

export type ConnectorsListView =
  | { kind: "empty"; add: AddCardView; offer: EmptyOfferView }
  | { kind: "list"; cards: ConnectorCardView[]; add: AddCardView };

function addCard(page: ConnectorsPageView, extraPrice: ConnectorExtraPrice | null): AddCardView {
  if (page.canAdd.ok) return { kind: "add", price: extraPrice };
  const reason: CanAddConnectorReason | undefined = page.canAdd.reason;
  if (reason === "trial_limit") return { kind: "trial", max: page.limits.max };
  if (reason === "orders_closed") return { kind: "soon" };
  // max_reached, and any refusal without a reason: locked with the max (never "add").
  return { kind: "max", max: page.limits.max };
}

/**
 * Whether a connector can be deleted: the server's ONE rule (#444,
 * ConnectorView.deletable). The derived card never, whatever is sent.
 */
function deletableOf(c: ConnectorView): boolean {
  return !c.derived && c.deletable === true;
}

function card(c: ConnectorView): ConnectorCardView {
  const pill = cardPillOf(c.state);
  const numberLine = c.derived ? "main" : c.numberE164 ? "own" : "none";
  return {
    id: c.id,
    name: c.name.trim() === "" ? null : c.name,
    derived: c.derived,
    number: numberLine === "own" ? c.numberE164 : null,
    numberLabel: numberLine === "own" ? (c.numberLabel ?? null) : null,
    numberLine,
    pill,
    unreachableNote: pill === "unreachable",
    setupLine: setupLineFor(pill, c.setupIssue),
    mode: c.mode,
    enabled: c.enabled,
    lastCallAt: c.lastCallAt,
    deletable: deletableOf(c),
  };
}

export function connectorsListView({ page, extraPrice, basePrice }: ConnectorsListInput): ConnectorsListView {
  const add = addCard(page, extraPrice);
  if (page.connectors.length === 0) {
    const offer: EmptyOfferView = page.limits.inTrial ? { kind: "trial" } : basePrice ? { kind: "price", price: basePrice } : null;
    return { kind: "empty", add, offer };
  }
  return { kind: "list", cards: page.connectors.map(card), add };
}

// Same rule as the pricing screens (lib/pricing-grid.ts formatGridMoney:
// whole amounts without decimals, others with two), kept here so the list's
// client bundle does not pull the pricing grid's imports. The test pins the
// two to the same output for every currency × locale.
const NUMBER_LOCALE: Record<string, string> = { fr: "fr-FR", he: "he-IL", en: "en-US" };

/** A connector price (extra or base) as the pricing screens write it. */
export function formatConnectorPrice(price: { monthly: number; currency: CatalogueCurrency }, locale: string): string {
  const whole = Number.isInteger(price.monthly);
  return new Intl.NumberFormat(NUMBER_LOCALE[locale] ?? "fr-FR", {
    style: "currency",
    currency: price.currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(price.monthly);
}
