// Copy for the admin "Vider la fiche entreprise" dialog
// (app/admin/users/[userId]/CompanySheetResetControl.tsx). Its own module, with
// no import: the control is a client component, so nothing server-side may
// come with it into the bundle.
//
// users.display_name is NOT part of the reset (it names the business in the
// greeting); the dialog says it stays. Empty → no line. The value is rendered
// as a React text node, so it is escaped.

/** "Le nom affiché reste : {name}", or null when the account has no display name. */
export function displayNameKeptLine(displayName: string | null | undefined): string | null {
  const name = (displayName ?? "").trim();
  return name ? `Le nom affiché reste : ${name}` : null;
}
