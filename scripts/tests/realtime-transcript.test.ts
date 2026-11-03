// Event → transcript mapping of the landing demo (lib/realtime-transcript).
// Sequences mirror what the OpenAI Realtime data channel sends (captured on
// prod 2026-11-03, text replaced by mock sentences).
// Run : npx tsx scripts/tests/realtime-transcript.test.ts
import assert from "node:assert/strict";

import {
  applyTranscriptEvent,
  awaitingAfterEvent,
  visibleEntries,
  type DemoTranscriptEntry,
} from "../../lib/realtime-transcript";

let passed = 0;
const failures: string[] = [];
const group = (label: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`[${label}] ${e instanceof Error ? e.message : e}`);
  }
};

type Ev = Record<string, unknown>;
const run = (events: Ev[]) =>
  events.reduce<DemoTranscriptEntry[]>((acc, ev) => applyTranscriptEvent(acc, ev).entries, []);
const lines = (entries: DemoTranscriptEntry[]) => entries.map((e) => `${e.role}: ${e.text}`);

const deltas = (item: string, words: string[], type = "response.output_audio_transcript.delta") =>
  words.map((w) => ({ type, item_id: item, delta: w }));

group("GA events: greeting, caller, reply", () => {
  const out = run([
    { type: "session.created" },
    ...deltas("a1", ["Bonjour, ", "je suis Tamara."]),
    { type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Bonjour, je suis Tamara." },
    { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Un rendez-vous jeudi." },
    ...deltas("a2", ["Très ", "bien."]),
    { type: "response.output_audio_transcript.done", item_id: "a2", transcript: "Très bien." },
  ]);
  assert.deepStrictEqual(lines(out), [
    "assistant: Bonjour, je suis Tamara.",
    "user: Un rendez-vous jeudi.",
    "assistant: Très bien.",
  ]);
  assert.ok(out.every((e) => e.final));
});

group("beta event names still work", () => {
  const out = run([
    ...deltas("a1", ["Hello"], "response.audio_transcript.delta"),
    { type: "response.audio_transcript.done", item_id: "a1", transcript: "Hello there." },
  ]);
  assert.deepStrictEqual(lines(out), ["assistant: Hello there."]);
});

group("Tamara's line shows even when .done never arrives", () => {
  const out = run([...deltas("a1", ["Je regarde ", "les créneaux"]), { type: "response.done" }]);
  assert.deepStrictEqual(lines(out), ["assistant: Je regarde les créneaux"]);
  assert.equal(out[0]!.final, true, "response.done freezes the streamed line");
});

group("a .done-only response (no deltas) still shows", () => {
  const out = run([{ type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Oui." }]);
  assert.deepStrictEqual(lines(out), ["assistant: Oui."]);
});

group("text modality events", () => {
  const out = run([
    { type: "response.output_text.delta", item_id: "t1", delta: "Texte" },
    { type: "response.output_text.done", item_id: "t1", text: "Texte complet." },
  ]);
  assert.deepStrictEqual(lines(out), ["assistant: Texte complet."]);
});

group("no duplicate bubble when .done follows deltas", () => {
  const out = run([
    ...deltas("a1", ["A", "B"]),
    { type: "response.output_audio_transcript.done", item_id: "a1", transcript: "AB" },
    { type: "response.output_audio_transcript.done", item_id: "a1", transcript: "AB" },
  ]);
  assert.equal(out.length, 1);
});

group("barge-in: the interrupted greeting keeps its text, then the reply", () => {
  const out = run([
    ...deltas("a1", ["Bonjour, vous êtes ", "en ligne"]),
    { type: "input_audio_buffer.speech_started" },
    { type: "output_audio_buffer.cleared" },
    { type: "conversation.item.truncated", item_id: "a1" },
    { type: "response.done", response: { status: "cancelled" } },
    { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Jeudi ?" },
    ...deltas("a2", ["Jeudi, d'accord."]),
  ]);
  assert.deepStrictEqual(lines(out), [
    "assistant: Bonjour, vous êtes en ligne",
    "user: Jeudi ?",
    "assistant: Jeudi, d'accord.",
  ]);
});

group("a late delta after the final text is ignored", () => {
  const out = run([
    { type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Fin." },
    { type: "response.output_audio_transcript.delta", item_id: "a1", delta: " encore" },
  ]);
  assert.deepStrictEqual(lines(out), ["assistant: Fin."]);
});

group("empty or whitespace user transcription adds nothing", () => {
  const out = run([{ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "  " }]);
  assert.equal(out.length, 0);
});

group("unrelated events never change the transcript (same array)", () => {
  const start: DemoTranscriptEntry[] = [{ id: "a1", role: "assistant", text: "Bonjour.", final: true }];
  for (const type of ["rate_limits.updated", "response.created", "output_audio_buffer.started", "error"]) {
    assert.equal(applyTranscriptEvent(start, { type }).entries, start, type);
  }
});

group("caller's line stays above Tamara's reply when STT completes late", () => {
  const out = run([
    ...deltas("a1", ["Bonjour."]),
    { type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Bonjour." },
    { type: "input_audio_buffer.committed", item_id: "u1" },
    ...deltas("a2", ["Pour jeudi, ", "c'est noté."]),
    { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Jeudi svp." },
    { type: "response.output_audio_transcript.done", item_id: "a2", transcript: "Pour jeudi, c'est noté." },
  ]);
  assert.deepStrictEqual(lines(visibleEntries(out)), [
    "assistant: Bonjour.",
    "user: Jeudi svp.",
    "assistant: Pour jeudi, c'est noté.",
  ]);
});

group("a reserved caller slot is hidden until filled, dropped if empty", () => {
  const reserved = run([{ type: "input_audio_buffer.committed", item_id: "u1" }]);
  assert.equal(visibleEntries(reserved).length, 0);
  const dropped = applyTranscriptEvent(reserved, {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "u1",
    transcript: " ",
  }).entries;
  assert.equal(dropped.length, 0);
});

group("typing indicator", () => {
  assert.equal(awaitingAfterEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Oui" }), true);
  assert.equal(awaitingAfterEvent({ type: "response.output_audio_transcript.delta", delta: "B" }), false);
  assert.equal(awaitingAfterEvent({ type: "response.output_audio_transcript.done", transcript: "B" }), false);
  assert.equal(awaitingAfterEvent({ type: "rate_limits.updated" }), undefined);
});

console.log(`realtime-transcript: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
