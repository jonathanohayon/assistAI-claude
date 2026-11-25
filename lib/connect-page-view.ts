// What the "Connecter vos agents" page shows: ONE pure decision, so the page
// can never be a title and nothing else (P1, 23/11: with CLIENT_AGENT unset an
// admin owns every entry, the brick was hidden, the page was empty).
//
//   brick    = the menu says OWNED and the "Votre agent IA" brick can be shown
//              for this viewer: the title, the trial line, the brick.
//   preview  = anything else: exactly what a NOT-owned account sees, the
//              product's header (sentence + CTA) and the sample preview
//              (ConnectPreview). Its CTA is the menu's when the menu says
//              preview; when the menu says owned but the brick can't be shown,
//              it is "soon" ("Bientôt disponible.", the product is closed for
//              this account).
//              notify    = "Prévenez-moi" is offered: never to an admin;
//              adminNote = the one admin line under the header (admins only).
//
// Pure and client-safe: no env var, no database. Its inputs are the server's
// results (lib/product-menu.ts, lib/tools/client-agent-switch.ts).
// scripts/tests/connect-page-view.test.ts pins the whole table.

import type { ProductCta, ProductEntryState } from "./product-menu";

export type ConnectPageInput = {
  /** menu.connect of the account shown (lib/product-gates.ts). */
  menu: ProductEntryState;
  /** The brick can be shown for this account (clientAgentEnabled). */
  showClientAgent: boolean;
  /** The VIEWER is an admin (their own dashboard, or the admin tenant view). */
  isAdmin: boolean;
};

export type ConnectPageView =
  | { kind: "brick" }
  | { kind: "preview"; cta: ProductCta; notify: boolean; adminNote: boolean };

export function connectPageView(input: ConnectPageInput): ConnectPageView {
  const { menu, showClientAgent, isAdmin } = input;
  if (menu.state === "owned" && showClientAgent) return { kind: "brick" };
  return {
    kind: "preview",
    cta: menu.state === "preview" ? menu.cta : "soon",
    notify: !isAdmin,
    adminNote: isAdmin,
  };
}
