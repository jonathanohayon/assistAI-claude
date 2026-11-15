// The `call_received` event of /api/calls/end. Pure, so the PII guard
// (scripts/tests/events-no-pii.test.ts) runs the exact shape the route stores.
//
// Readers: lib/calls/query.ts excludes web sessions by an EMPTY toNumber
// (key present, value ''), and the Monitoring view labels SIP calls with
// toNumber — the tenant's own dialled line, kept. The caller's number is
// never stored: fromHash correlates, fromLast4 displays ("…1234").

import { callerFields, last4 } from "@/lib/event-pii";

export function callReceivedEvent(input: {
  fromNumber: string;
  toNumber: string;
  callId: string;
  transcriptEntries?: number;
}) {
  const l4 = last4(input.fromNumber);
  return {
    message: l4 ? `Appel reçu (…${l4})` : "Appel reçu",
    metadata: {
      callId: input.callId,
      toNumber: input.toNumber,
      ...callerFields(input.fromNumber),
      ...(input.transcriptEntries !== undefined ? { transcriptEntries: input.transcriptEntries } : {}),
    },
  };
}
