// The welcome screen's two network actions, with the fetch injected so
// scripts/tests/onboarding-welcome.test.ts can prove exactly which calls are
// made. Client-safe: no server import.
//
// The welcome screen only ever calls:
//   POST /api/dashboard/products/notify  (when the notify-me row is missing)
//   POST /api/onboarding/profile         (before either button acts)
// Never the number search or purchase: those belong to the Réception wizard.

import { welcomeFormValid, type WelcomeDoor, type WelcomeLanguage } from "@/lib/onboarding-route";

export const NOTIFY_PATH = "/api/dashboard/products/notify";
export const PROFILE_PATH = "/api/onboarding/profile";

type Fetch = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status">>;

/**
 * Records the "prévenez-moi" row for the door's product. True only when the
 * route says it is stored (201 created, 200 already there); any other answer
 * or a network error is false, and the screen never claims it is recorded.
 */
export async function recordNotify(product: WelcomeDoor, fetchFn: Fetch): Promise<boolean> {
  try {
    const res = await fetchFn(NOTIFY_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
    return res.status === 200 || res.status === 201;
  } catch {
    return false;
  }
}

/**
 * Saves the company name and the agent's language (the wizard's own route and
 * body). "invalid" = a field is missing, nothing is sent; "failed" = the save
 * did not succeed, the screen stays and shows the wizard's error copy.
 */
export async function saveWelcomeProfile(
  form: { companyName: string; language: WelcomeLanguage | null },
  fetchFn: Fetch,
): Promise<"saved" | "invalid" | "failed"> {
  if (!welcomeFormValid(form.companyName, form.language)) return "invalid";
  try {
    const res = await fetchFn(PROFILE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: form.companyName.trim(), primaryLanguage: form.language }),
    });
    return res.ok ? "saved" : "failed";
  } catch {
    return "failed";
  }
}

export type WelcomeChoice = "preview" | "reception";

/**
 * Either button: save the profile first, then act. "preview" navigates to the
 * product's page in the dashboard; "reception" opens today's wizard in place.
 * Nothing happens when the save is refused or fails.
 */
export async function continueFromWelcome(
  choice: WelcomeChoice,
  form: { companyName: string; language: WelcomeLanguage | null },
  deps: { fetch: Fetch; navigate: (href: string) => void; openWizard: () => void; previewHref: string },
): Promise<"saved" | "invalid" | "failed"> {
  const r = await saveWelcomeProfile(form, deps.fetch);
  if (r !== "saved") return r;
  if (choice === "preview") deps.navigate(deps.previewHref);
  else deps.openWizard();
  return r;
}
