// What an anonymous caller (mode "demo" in lib/google.ts) may do.
//
// Requests with neither INTERNAL_SECRET nor a session used to run against the
// env GOOGLE_CALENDAR_ID calendar with full rights: anyone on the internet
// could book or cancel events there, and /find matched a phone digit
// SUBSTRING against event descriptions (phone "0" ≈ every event's name).
//
// The public landing demo (components/VoiceAgent.tsx) still needs
// availability, booking and contact saving to feel real, so:
//   - read-only free slots: allowed (no personal data in the answer)
//   - book / save contact: simulated, nothing is written
//   - find / cancel / reschedule: refused (401)
// Unit-tested in scripts/tests/demo-sandbox.test.ts.

export type DemoRoute =
  | "availability"
  | "list-dates"
  | "book"
  | "sheets-contact"
  | "find"
  | "cancel"
  | "reschedule";

export type DemoPolicy = "allow" | "simulate" | "deny";

export function demoPolicy(route: DemoRoute): DemoPolicy {
  switch (route) {
    case "availability":
    case "list-dates":
      return "allow";
    case "book":
    case "sheets-contact":
      return "simulate";
    case "find":
    case "cancel":
    case "reschedule":
      return "deny";
  }
}

export const DEMO_DENIED_BODY = {
  error: "unauthorized",
  message: "Authentication required (x-internal-secret or a session).",
} as const;
