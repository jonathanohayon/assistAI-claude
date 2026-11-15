// Who a customer e-mail greets (tamaraVP, 15/11): the PERSON's first name when
// we have one, otherwise no name at all ("Bonjour," / "Hi," / "שלום,"). Never
// the business name: users.displayName is the company name typed in
// onboarding ("Salon Mock" used to become "Bonjour Salon,"). The account
// stores no person name today, so every caller passes none. Pure.

export interface GreetingNames {
  /** The person's own name, when the account ever stores one. */
  personName?: string | null;
  /** The business name (users.displayName): accepted, never used. */
  businessName?: string | null;
}

/** The first name to greet with, or null for a greeting with no name. */
export function greetingName(names: GreetingNames): string | null {
  const first = (names.personName ?? "").trim().split(/\s+/)[0];
  return first || null;
}
