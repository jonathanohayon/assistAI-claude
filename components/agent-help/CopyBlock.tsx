"use client";

import { useState } from "react";

/**
 * One code sample of the agent help page, with its own copy button. The code
 * stays left-to-right inside Hebrew prose, and scrolls inside its box on a
 * narrow screen (scroll-visible + scroll-shadow-x, as in #421).
 */
export function CopyBlock({ title, code, copyLabel, copiedLabel }: { title: string; code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="m-0 min-w-0" data-copy-block>
      <div className="flex items-center justify-between gap-3">
        <figcaption className="text-sm font-semibold text-[var(--color-foreground)]">{title}</figcaption>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => {},
            );
          }}
          className="min-h-11 shrink-0 rounded-lg bg-[var(--color-foreground)] px-3 py-2 text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] focus-visible:ring-offset-2"
        >
          {copied ? copiedLabel : copyLabel}
        </button>
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? copiedLabel : ""}
        </span>
      </div>
      <pre
        dir="ltr"
        className="scroll-visible scroll-shadow-x mt-2 max-w-full overflow-x-auto rounded-lg bg-[var(--color-muted)] p-3 text-start font-mono text-[11px] leading-relaxed text-[var(--color-foreground)]"
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}
