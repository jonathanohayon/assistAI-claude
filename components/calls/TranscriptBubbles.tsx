/**
 * Transcript as chat bubbles: the agent on the start side, the caller on the
 * end side. Shared by the campaign analytics (ConversationRow) and the tenant
 * Calls page. `dir` follows the conversation's own text direction; the
 * optional speaker labels are read by screen readers only (no visual change).
 */

export interface BubbleTurn {
  fromAgent: boolean;
  text: string;
}

export function TranscriptBubbles({
  turns,
  dir,
  speakers,
  textSize = "text-[12px]",
}: {
  turns: BubbleTurn[];
  dir?: "rtl" | "ltr";
  /** Screen-reader prefix of each bubble, e.g. { agent: "Tamara", caller: "Client" }. */
  speakers?: { agent: string; caller: string };
  /** Bubble text size class (the campaign screen keeps 12 px). */
  textSize?: string;
}) {
  return (
    <div dir={dir} className="flex flex-col gap-1.5">
      {turns.map((m, i) => (
        <div
          key={i}
          className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${textSize} ${
            m.fromAgent ? "self-start bg-[#ede9fe] text-[#5b21b6]" : "self-end bg-[#e2e8f0] text-[#18181b]"
          }`}
        >
          {speakers && <span className="sr-only">{`${m.fromAgent ? speakers.agent : speakers.caller}: `}</span>}
          {m.text}
        </div>
      ))}
    </div>
  );
}
