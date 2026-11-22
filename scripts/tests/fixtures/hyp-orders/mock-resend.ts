// Test double for the `resend` package: every send is recorded in
// globalThis.__sentEmails and answered OK. Nothing leaves the process.
export type SentEmail = { from: string; to: string[]; subject: string; text: string; html: string };
const g = globalThis as { __sentEmails?: SentEmail[] };
export class Resend {
  emails = {
    send: async (msg: SentEmail) => {
      (g.__sentEmails ??= []).push(JSON.parse(JSON.stringify(msg)) as SentEmail);
      return { data: { id: `mock-${g.__sentEmails.length}` }, error: null };
    },
  };
  constructor(_key?: string) {}
}
