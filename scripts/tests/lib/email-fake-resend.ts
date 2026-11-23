// Fake "resend" module for email-render-harness.ts: records, never sends.
export type SentEmail = { from: string; to: string[]; subject: string; text: string; html: string };
export const sentEmails: SentEmail[] = [];

// No constructor: `new Resend(key)` (lib/email.ts) passes the key, which a
// fake ignores; the implicit constructor accepts it at runtime.
export class Resend {
  emails = {
    send: async (payload: SentEmail) => {
      sentEmails.push(payload);
      return { data: { id: `mock-email-${sentEmails.length}` }, error: null };
    },
  };
}
