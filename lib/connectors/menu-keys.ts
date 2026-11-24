// The card's "…" menu (C1), keyboard: what a key does, as a pure function
// (WAI-ARIA menu button pattern, one item today: "Supprimer").
//   on the button  Enter / Space / ArrowDown / ArrowUp open the menu (focus
//                  on its first item); Escape closes it when open;
//   in the menu    Escape closes it and focus returns to the button; Tab
//                  closes it (focus moves on as usual).
// Pure, zero imports. scripts/tests/connectors-list.test.ts pins it.

export type MenuKeyAction = "open" | "close" | null;

export function menuKeyAction(where: "button" | "menu", open: boolean, key: string): MenuKeyAction {
  if (key === "Escape") return open ? "close" : null;
  if (where === "button") {
    if (!open && (key === "Enter" || key === " " || key === "ArrowDown" || key === "ArrowUp")) return "open";
    return null;
  }
  if (key === "Tab") return "close";
  return null;
}
