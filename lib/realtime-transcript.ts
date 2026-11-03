// Pure mapping from OpenAI Realtime data-channel events to the landing demo's
// transcript. Kept out of the component so it can be unit-tested
// (scripts/tests/realtime-transcript.test.ts).
//
// Robustness rules:
// - Tamara's line is built from the transcript DELTAS, keyed by item_id, so it
//   shows even when the matching `.done` never arrives (response cancelled by
//   a barge-in, another model/modality). `.done` then replaces the streamed
//   text with the final one.
// - Both event generations are accepted: GA `response.output_audio_transcript.*`
//   and beta `response.audio_transcript.*`, plus the text modality
//   `response.output_text.*` / `response.text.*`.
// - One bubble per item_id: a `.done` after deltas never duplicates a line.

/** Entries worth a bubble (reserved caller slots stay hidden until filled). */
export function visibleEntries(entries: DemoTranscriptEntry[]): DemoTranscriptEntry[] {
  return entries.filter((e) => e.text.length > 0);
}

export type DemoTranscriptEntry = {
  /** Realtime item_id (assistant or user item); synthetic when absent. */
  id: string;
  role: "user" | "assistant";
  text: string;
  /** false while the assistant line is still streaming. */
  final: boolean;
};

const ASSISTANT_DELTA = new Set([
  "response.output_audio_transcript.delta",
  "response.audio_transcript.delta",
  "response.output_text.delta",
  "response.text.delta",
]);

const ASSISTANT_DONE = new Set([
  "response.output_audio_transcript.done",
  "response.audio_transcript.done",
  "response.output_text.done",
  "response.text.done",
]);

const USER_DONE = "conversation.item.input_audio_transcription.completed";

type RealtimeEvent = { type?: unknown; [key: string]: unknown };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function upsert(
  entries: DemoTranscriptEntry[],
  id: string,
  role: DemoTranscriptEntry["role"],
  patch: (prev: DemoTranscriptEntry | undefined) => DemoTranscriptEntry | null,
): DemoTranscriptEntry[] {
  const i = entries.findIndex((e) => e.id === id && e.role === role);
  const next = patch(i >= 0 ? entries[i] : undefined);
  if (!next) return entries;
  if (i < 0) return [...entries, next];
  const copy = entries.slice();
  copy[i] = next;
  return copy;
}

/** What one event changes. `awaiting` drives the typing indicator. */
export function applyTranscriptEvent(
  entries: DemoTranscriptEntry[],
  event: RealtimeEvent,
): { entries: DemoTranscriptEntry[]; awaiting?: boolean } {
  const type = str(event.type);

  if (ASSISTANT_DELTA.has(type)) {
    const delta = str(event.delta);
    if (!delta) return { entries };
    const id = str(event.item_id) || str(event.response_id) || "assistant";
    return {
      entries: upsert(entries, id, "assistant", (prev) =>
        prev?.final
          ? null // a late delta after the final text: ignore
          : { id, role: "assistant", text: (prev?.text ?? "") + delta, final: false },
      ),
      awaiting: false,
    };
  }

  if (ASSISTANT_DONE.has(type)) {
    const text = str(event.transcript) || str(event.text);
    const id = str(event.item_id) || str(event.response_id) || "assistant";
    return {
      entries: upsert(entries, id, "assistant", (prev) => {
        const finalText = text || prev?.text || "";
        return finalText ? { id, role: "assistant", text: finalText, final: true } : null;
      }),
      awaiting: false,
    };
  }

  // The caller's audio is committed BEFORE Tamara starts answering, but its
  // transcription completes AFTER her reply has started streaming. Reserve
  // the caller's slot now (empty, not rendered) so their line lands above the
  // reply instead of below it.
  if (type === "input_audio_buffer.committed") {
    const id = str(event.item_id);
    if (!id) return { entries };
    return {
      entries: upsert(entries, id, "user", (prev) =>
        prev ? null : { id, role: "user", text: "", final: false },
      ),
    };
  }

  if (type === USER_DONE) {
    const text = str(event.transcript).trim();
    if (!text) {
      const id = str(event.item_id);
      const kept = entries.filter((e) => !(e.role === "user" && e.id === id && !e.text));
      return { entries: kept.length === entries.length ? entries : kept };
    }
    const id = str(event.item_id) || `user-${entries.length}`;
    return {
      entries: upsert(entries, id, "user", () => ({ id, role: "user", text, final: true })),
      awaiting: true,
    };
  }

  // A cancelled/interrupted response may never send `.done`: freeze what
  // streamed so far instead of leaving it half-open.
  if (type === "response.done") {
    if (!entries.some((e) => !e.final)) return { entries };
    return { entries: entries.map((e) => (e.final ? e : { ...e, final: true })) };
  }

  return { entries };
}

/** Typing indicator after this event: true once the user's line is in,
 *  false as soon as Tamara starts (or finishes) answering. */
export function awaitingAfterEvent(event: RealtimeEvent): boolean | undefined {
  const type = str(event.type);
  if (ASSISTANT_DELTA.has(type) || ASSISTANT_DONE.has(type)) return false;
  if (type === USER_DONE && str(event.transcript).trim()) return true;
  return undefined;
}
