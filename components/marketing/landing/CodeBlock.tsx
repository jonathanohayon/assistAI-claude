import { Fragment, type ReactNode } from "react";

const RTL_CHAR = /[֐-׿]/;

/** Wraps every quoted string holding Hebrew in <bdi>, so inside the LTR code
 *  its words and punctuation keep their Hebrew order and the quotes stay put. */
function isolateRtlStrings(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(/"([^"\n]*)"/g)) {
    const inner = m[1];
    if (!RTL_CHAR.test(inner)) continue;
    const start = m.index!;
    out.push(code.slice(last, start + 1));
    out.push(<bdi key={start}>{inner}</bdi>);
    last = start + 1 + inner.length;
  }
  out.push(code.slice(last));
  return out.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

/**
 * A code sample on a landing page: left-to-right and monospace in every
 * locale (dir="ltr", even inside a Hebrew page), scrolling inside its own box
 * so the page never scrolls sideways on a phone.
 */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#1e2937] shadow-[0_20px_50px_-24px_rgba(14,116,144,0.55)]">
      <figcaption className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-xs font-semibold text-white/70">
        <span aria-hidden className="h-2 w-2 rounded-full bg-[#22d3ee]" />
        {label}
      </figcaption>
      {/* tabIndex: a scrollable region must be reachable from the keyboard. */}
      <pre
        dir="ltr"
        tabIndex={0}
        className="max-w-full overflow-x-auto px-4 py-4 text-start font-mono text-[12.5px] leading-relaxed text-[#e2e8f0] focus-visible:outline-2 focus-visible:outline-[#22d3ee] sm:text-[13px]"
      >
        <code dir="ltr" className="font-mono">
          {isolateRtlStrings(code)}
        </code>
      </pre>
    </figure>
  );
}
