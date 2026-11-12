import type { WordmarkTone } from "@/lib/marketing/nav-tone";

export function Logo({
  className,
  tone = "brand",
}: {
  className?: string;
  /** "onDark" renders the wordmark white, for a dark hero under the nav. */
  tone?: WordmarkTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className ?? ""}`}
      aria-label="Tamara"
    >
      <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#ec4899] to-[#8b5cf6] text-white shadow-[0_4px_12px_-2px_rgb(236_72_153_/_0.4)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            d="M12 3a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4Z"
            fill="currentColor"
          />
          <path
            d="M5 11a7 7 0 0 0 14 0M12 18v3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span
        className={`font-display text-xl leading-none tracking-tight transition-colors duration-300 ${
          tone === "onDark" ? "relative isolate text-white" : "text-[#8b5cf6]"
        }`}
      >
        {/* Over a dark hero, a soft dark halo keeps white >= 4.5:1 on the
         *  lightest pixel behind the wordmark: the home video's poster has
         *  bright bulbs there (white alone measured 2.42:1). */}
        {tone === "onDark" && (
          <span
            aria-hidden
            data-wordmark-halo=""
            className="pointer-events-none absolute -inset-x-4 -inset-y-2.5 -z-10 rounded-full bg-black/45 blur-[10px]"
          />
        )}
        Tamara
      </span>
    </span>
  );
}
