// A stored secret that can't be opened (E1, lib/crypto/secret-box.ts) —
// SERVER-ONLY. The caller treats it as ABSENT; the admins get ONE alert per
// kind (deduped here per process AND by alertAdmins' ledger). The alert is
// plain text: the kind and the failure code, never a value or ciphertext.
import { type OpenFailure, openSecret } from "@/lib/crypto/secret-box";

export type SecretKind = "agent_brain" | "client_agent" | "google";

const DEDUP_MS = 6 * 60 * 60 * 1000;

const WHAT: Record<SecretKind, string> = {
  agent_brain: "external agent webhook secret (the normal Tamara answers those calls)",
  client_agent: "client agent secret (the client agent is not served on those calls)",
  google: "Google connection (those accounts behave as not connected to Google)",
};

export interface UnreadableAlert {
  key: string;
  subject: string;
  body: string;
  dedupMs: number;
  severity: "critical";
}

export function unreadableAlert(kind: SecretKind, reason: OpenFailure): UnreadableAlert {
  return {
    key: `secret_unreadable:${kind}`,
    subject: "A stored secret can't be decrypted",
    body:
      `A sealed ${WHAT[kind]} could not be opened (${reason}). ` +
      "Check SECRETS_KEY / SECRETS_KEY_ID (and SECRETS_KEY_PREVIOUS / SECRETS_KEY_PREVIOUS_ID during a rotation) on the web service.",
    dedupMs: DEDUP_MS,
    severity: "critical",
  };
}

export type UnreadableReporter = (kind: SecretKind, reason: OpenFailure, now?: number) => void;

/** Fire-and-forget, never throws, at most one send per kind per DEDUP_MS in this process. */
export function createUnreadableReporter(send: (a: UnreadableAlert) => Promise<unknown>): UnreadableReporter {
  const last = new Map<SecretKind, number>();
  // Sends run one after the other: alertAdmins' ledger is one JSON value, two
  // concurrent sends for different kinds would overwrite each other's entry.
  let queue: Promise<unknown> = Promise.resolve();
  return (kind, reason, now = Date.now()) => {
    const prev = last.get(kind);
    if (prev !== undefined && now - prev < DEDUP_MS) return;
    last.set(kind, now);
    console.warn(`[secrets] unreadable ${kind} secret (${reason})`);
    const alert = unreadableAlert(kind, reason);
    // alerting must never break the call path: nothing here throws or rejects
    queue = queue.then(() => send(alert)).catch(() => {});
  };
}

export const reportUnreadableSecret: UnreadableReporter = createUnreadableReporter(async (a) => {
  const { alertAdmins } = await import("@/lib/alerts");
  return alertAdmins(a);
});

/**
 * The usable plain value of a stored secret: null when absent OR unreadable
 * (then reported). Never throws.
 */
export function openStoredSecret(
  kind: SecretKind,
  stored: string | null | undefined,
  report: UnreadableReporter = reportUnreadableSecret,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!stored) return null;
  const r = openSecret(stored, env);
  if (r.ok) return r.value;
  report(kind, r.reason);
  return null;
}
