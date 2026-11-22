// Fake "resend" module for email-render-harness.ts: records, never sends.
export type SentEmail = { from: string; to: string[]; subject: string; text: string; html: string };
export const sentEmails: SentEmail[] = [];

export class Resend {
  constructor(_key?: string) {}
  emails = {
    send: async (payload: SentEmail) => {
      sentEmails.push(payload);
      return { data: { id: `mock-email-${sentEmails.length}` }, error: null };
    },
  };
}
